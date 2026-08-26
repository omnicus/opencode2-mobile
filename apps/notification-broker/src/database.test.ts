import { randomBytes } from "node:crypto";
import { decodeNotificationBytes } from "@opencode2-mobile/notification-protocol";
import { describe, expect, it } from "vitest";

import { BrokerDatabase } from "./database.js";

describe("BrokerDatabase", () => {
  it("completes a one-use encrypted pairing and queues a test", () => {
    const database = new BrokerDatabase(":memory:", randomBytes(32));
    const code = database.createPairing(
      {
        allowDevelopmentHttp: true,
        authMode: "none",
        brokerOrigin: "http://broker.test:37100",
        name: "Test server",
        openCodeOrigin: "http://server.test:4096",
      },
      {
        allowDevelopmentHttp: true,
        auth: { mode: "none" },
        baseUrl: "http://server.test:4096",
        name: "Test server",
        v: 1,
      },
      1_000,
    );
    const secret = decodeNotificationBytes(code.pairingSecret, 32);
    const registration = {
      bindingID: "binding-1",
      deviceKey: Buffer.from(randomBytes(32)).toString("base64url"),
      deviceName: "Test phone",
      expoPushToken: "ExponentPushToken[test-token]",
      platform: "ios",
      v: 1,
    };
    const result = database.completePairing(code.challengeID, registration, "broker-1", 1_001);

    expect(result.brokerID).toBe("broker-1");
    expect(database.health()).toEqual({ devices: 1, queued: 1 });
    expect(database.completePairing(code.challengeID, registration, "broker-1", 1_002)).toEqual(
      result,
    );
    expect(database.listDevices()).toHaveLength(1);
    expect(() =>
      database.completePairing(
        code.challengeID,
        { ...registration, bindingID: "binding-2" },
        "broker-1",
        1_003,
      ),
    ).toThrow("PAIRING_UNAVAILABLE");
    const secondCode = createPairingCode(database, 2_000);
    expect(() =>
      database.completePairing(secondCode.challengeID, registration, "broker-1", 2_001),
    ).toThrow("PAIRING_UNAVAILABLE");
    expect(secret).toHaveLength(32);
    database.close();
  });

  it("deduplicates plugin events", () => {
    const database = new BrokerDatabase(":memory:", randomBytes(32));
    const event = {
      eventID: "evt_1",
      interaction: "permission",
      observedAtMs: 1_000,
      requestID: "per_1",
      sessionID: "ses_1",
      state: "pending",
      v: 1,
    };
    database.acceptPluginEvent(event);
    database.acceptPluginEvent(event);
    const count = database.database
      .prepare("SELECT COUNT(*) AS count FROM plugin_events")
      .get() as {
      count: number;
    };
    expect(count.count).toBe(1);
    database.close();
  });

  it("pauses delivery without replaying interactions after resume", () => {
    const database = new BrokerDatabase(":memory:", randomBytes(32));
    pairDevice(database, "binding-1", 500);
    expect(database.deliveryState()).toEqual({ enabled: true, updatedAtMs: 0, v: 1 });

    expect(database.setDeliveryEnabled(false, 900)).toEqual({
      enabled: false,
      updatedAtMs: 900,
      v: 1,
    });
    expect(database.nextQueued()).toHaveLength(0);
    database.acceptPluginEvent({
      eventID: "evt_paused",
      interaction: "permission",
      observedAtMs: 1_000,
      requestID: "per_paused",
      sessionID: "ses_1",
      state: "pending",
      v: 1,
    });
    database.setDeliveryEnabled(true, 1_100);
    expect(database.nextQueued()).toHaveLength(0);

    database.acceptPluginEvent({
      eventID: "evt_resumed",
      interaction: "permission",
      observedAtMs: 1_200,
      requestID: "per_resumed",
      sessionID: "ses_1",
      state: "pending",
      v: 1,
    });
    expect(database.nextQueued()).toHaveLength(1);
    database.close();
  });

  it("cancels a queued interaction when OpenCode resolves it", () => {
    const database = new BrokerDatabase(":memory:", randomBytes(32));
    pairDevice(database, "binding-1", 500);
    database.acceptPluginEvent({
      eventID: "evt_pending",
      interaction: "permission",
      observedAtMs: 1_000,
      requestID: "per_1",
      sessionID: "ses_1",
      state: "pending",
      v: 1,
    });

    database.acceptPluginEvent({
      eventID: "evt_resolved",
      interaction: "permission",
      observedAtMs: 1_100,
      requestID: "per_1",
      sessionID: "ses_1",
      state: "resolved",
      v: 1,
    });

    expect(
      database.database
        .prepare("SELECT state, last_error_code FROM outbox WHERE event_id = 'evt_pending'")
        .get(),
    ).toEqual({ last_error_code: "RESOLVED", state: "failed" });
    database.close();
  });

  it("does not replay interactions observed before a device paired", () => {
    const database = new BrokerDatabase(":memory:", randomBytes(32));
    database.acceptPluginEvent({
      eventID: "evt_before_pairing",
      interaction: "form",
      observedAtMs: 1_000,
      requestID: "frm_1",
      sessionID: "ses_1",
      state: "pending",
      v: 1,
    });

    pairDevice(database, "binding-1", 1_100);

    const row = database.database
      .prepare("SELECT COUNT(*) AS count FROM outbox WHERE event_id = 'evt_before_pairing'")
      .get() as { count: number };
    expect(row.count).toBe(0);
    database.close();
  });

  it("queues and deduplicates successful session completion", () => {
    const database = new BrokerDatabase(":memory:", randomBytes(32));
    pairDevice(database, "binding-1", 500);
    const event = {
      category: "session-done",
      eventID: "evt_done",
      kind: "session-done",
      observedAtMs: 1_000,
      sessionID: "ses_1",
      v: 1,
    };

    database.acceptPluginEvent(event);
    database.acceptPluginEvent(event);

    expect(
      database.database
        .prepare("SELECT notification_category, state FROM outbox WHERE event_id = 'evt_done'")
        .get(),
    ).toEqual({ notification_category: "session-done", state: "queued" });
    expect(
      database.database
        .prepare("SELECT state FROM plugin_events WHERE event_id = 'evt_done'")
        .get(),
    ).toEqual({ state: "emitted" });
    database.close();
  });

  it("stores only the allowlisted visible category", () => {
    const database = new BrokerDatabase(":memory:", randomBytes(32));
    pairDevice(database, "binding-1", 500);
    database.acceptPluginEvent({
      category: "permission-shell",
      eventID: "evt_shell",
      interaction: "permission",
      kind: "interaction",
      observedAtMs: 1_000,
      requestID: "per_1",
      sessionID: "ses_1",
      state: "pending",
      v: 1,
    });

    expect(
      database.database
        .prepare("SELECT notification_category FROM outbox WHERE event_id = 'evt_shell'")
        .get(),
    ).toEqual({ notification_category: "permission-shell" });
    database.close();
  });

  it("prunes expired unused challenges without removing the retry window", () => {
    const database = new BrokerDatabase(":memory:", randomBytes(32));
    const consumed = createPairingCode(database, 1_000);
    database.completePairing(
      consumed.challengeID,
      {
        bindingID: "binding-1",
        deviceKey: Buffer.from(randomBytes(32)).toString("base64url"),
        deviceName: "Test phone",
        expoPushToken: "ExponentPushToken[test-token]",
        platform: "ios",
        v: 1,
      },
      "broker-1",
      1_001,
    );
    const unused = createPairingCode(database, 2_000);

    database.prune(122_001);

    const remaining = database.database
      .prepare("SELECT id FROM pairing_challenges ORDER BY id")
      .all() as Array<{ id: string }>;
    expect(remaining.map((row) => row.id)).toContain(consumed.challengeID);
    expect(remaining.map((row) => row.id)).not.toContain(unused.challengeID);

    database.prune(1_001 + 24 * 60 * 60_000 + 1);
    expect(
      database.database.prepare("SELECT COUNT(*) AS count FROM pairing_challenges").get(),
    ).toEqual({ count: 0 });
    database.close();
  });
});

function pairDevice(database: BrokerDatabase, bindingID: string, now: number) {
  const code = createPairingCode(database, now);
  database.completePairing(
    code.challengeID,
    {
      bindingID,
      deviceKey: Buffer.from(randomBytes(32)).toString("base64url"),
      deviceName: "Test phone",
      expoPushToken: "ExponentPushToken[test-token]",
      platform: "ios",
      v: 1,
    },
    "broker-1",
    now + 1,
  );
}

function createPairingCode(database: BrokerDatabase, now: number) {
  return database.createPairing(
    {
      allowDevelopmentHttp: true,
      authMode: "none",
      brokerOrigin: "http://broker.test:37100",
      name: "Test server",
      openCodeOrigin: "http://server.test:4096",
    },
    {
      allowDevelopmentHttp: true,
      auth: { mode: "none" },
      baseUrl: "http://server.test:4096",
      name: "Test server",
      v: 1,
    },
    now,
  );
}
