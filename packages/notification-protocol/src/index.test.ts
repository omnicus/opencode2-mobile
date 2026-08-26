import { describe, expect, it } from "vitest";

import {
  decodeNotificationBytes,
  encodeNotificationBytes,
  notificationPushAdditionalData,
  openNotificationJson,
  parseNotificationConnectionBootstrap,
  parseNotificationDeliveryState,
  parseNotificationPairingCode,
  parseNotificationPairingIssueRequest,
  parseNotificationPluginEvent,
  parseNotificationRoutingEnvelope,
  parseOpenCodeDevicePairingCode,
  sealNotificationJson,
} from "./index.js";

describe("notification protocol", () => {
  it("round trips an authenticated routing envelope", () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const nonce = Uint8Array.from({ length: 24 }, (_, index) => index + 32);
    const route = {
      bindingID: "binding-1",
      eventID: "evt_1",
      expiresAtMs: 2_000,
      interaction: "permission",
      issuedAtMs: 1_000,
      kind: "interaction",
      requestID: "per_1",
      sessionID: "ses_1",
      v: 1,
    } as const;
    const ciphertext = sealNotificationJson(
      key,
      nonce,
      route,
      notificationPushAdditionalData(route.bindingID),
    );

    expect(
      parseNotificationRoutingEnvelope(
        openNotificationJson(
          key,
          nonce,
          ciphertext,
          notificationPushAdditionalData(route.bindingID),
        ),
      ),
    ).toEqual(route);
    expect(() =>
      openNotificationJson(
        key,
        nonce,
        ciphertext,
        notificationPushAdditionalData("another-binding"),
      ),
    ).toThrow("INVALID_NOTIFICATION_CIPHERTEXT");
  });

  it("requires a location for global forms", () => {
    expect(() =>
      parseNotificationRoutingEnvelope({
        bindingID: "binding-1",
        eventID: "evt_1",
        expiresAtMs: 2_000,
        interaction: "form",
        issuedAtMs: 1_000,
        kind: "interaction",
        requestID: "frm_1",
        sessionID: "global",
        v: 1,
      }),
    ).toThrow("INVALID_NOTIFICATION_ROUTE");
  });

  it("parses session completion routes and plugin events", () => {
    expect(
      parseNotificationRoutingEnvelope({
        bindingID: "binding-1",
        eventID: "evt_done",
        expiresAtMs: 2_000,
        issuedAtMs: 1_000,
        kind: "session-done",
        sessionID: "ses_1",
        v: 1,
      }),
    ).toMatchObject({ kind: "session-done", sessionID: "ses_1" });
    expect(
      parseNotificationPluginEvent({
        category: "session-done",
        eventID: "evt_done",
        kind: "session-done",
        observedAtMs: 1_000,
        sessionID: "ses_1",
        v: 1,
      }),
    ).toMatchObject({ category: "session-done", kind: "session-done" });
  });

  it("defaults old queued interactions safely and rejects arbitrary categories", () => {
    expect(
      parseNotificationPluginEvent({
        eventID: "evt_old",
        interaction: "permission",
        observedAtMs: 1_000,
        requestID: "per_1",
        sessionID: "ses_1",
        state: "pending",
        v: 1,
      }),
    ).toMatchObject({ category: "permission-other", kind: "interaction" });
    expect(() =>
      parseNotificationPluginEvent({
        category: "permission-private-action",
        eventID: "evt_1",
        interaction: "permission",
        observedAtMs: 1_000,
        requestID: "per_1",
        sessionID: "ses_1",
        state: "pending",
        v: 1,
      }),
    ).toThrow("INVALID_PLUGIN_EVENT");
    expect(() =>
      parseNotificationPluginEvent({
        category: "permission-shell",
        eventID: "evt_done",
        kind: "session-done",
        observedAtMs: 1_000,
        sessionID: "ses_1",
        v: 1,
      }),
    ).toThrow("INVALID_PLUGIN_EVENT");
  });

  it("validates pairing origins and key sizes", () => {
    const pairingSecret = encodeNotificationBytes(new Uint8Array(32).fill(7));
    expect(
      parseNotificationPairingCode({
        allowDevelopmentHttp: true,
        authMode: "none",
        brokerOrigin: "http://broker.example",
        challengeID: "challenge-1",
        expiresAtMs: 2_000,
        name: "Workstation",
        openCodeOrigin: "http://server.example:4096",
        pairingSecret,
        v: 1,
      }),
    ).toMatchObject({ challengeID: "challenge-1", pairingSecret });
    expect(() => decodeNotificationBytes("bad", 32)).toThrow("INVALID_NOTIFICATION_BYTES");
  });

  it("parses OpenCode device pairing codes", () => {
    expect(
      parseOpenCodeDevicePairingCode(
        JSON.stringify({
          password: "secret",
          urls: ["http://100.64.0.10:4096", "https://code.example.test"],
          username: "opencode",
        }),
      ),
    ).toEqual({
      password: "secret",
      urls: ["http://100.64.0.10:4096", "https://code.example.test"],
      username: "opencode",
    });
    expect(() =>
      parseOpenCodeDevicePairingCode({
        password: "secret",
        urls: ["http://user:secret@server.test"],
        username: "opencode",
      }),
    ).toThrow("INVALID_OPENCODE_PAIRING_CODE");
    expect(
      parseOpenCodeDevicePairingCode({
        password: "  exact password  ",
        urls: ["https://server.test"],
        username: " opencode ",
      }),
    ).toMatchObject({ password: "  exact password  ", username: " opencode " });
    expect(() =>
      parseOpenCodeDevicePairingCode({
        password: "secret",
        urls: ["https://server.test"],
        username: "open:code",
      }),
    ).toThrow("INVALID_OPENCODE_PAIRING_CODE");
  });

  it("requires explicit approval for HTTP pairing issue requests", () => {
    expect(() =>
      parseNotificationPairingIssueRequest({
        allowDevelopmentHttp: false,
        name: "Workstation",
        openCodeOrigin: "http://100.64.0.10:4096",
        password: "secret",
        username: "opencode",
        v: 1,
      }),
    ).toThrow("INVALID_PAIRING_ISSUE_REQUEST");
  });

  it("preserves credentials through pairing issue and bootstrap parsing", () => {
    expect(
      parseNotificationPairingIssueRequest({
        allowDevelopmentHttp: false,
        name: "Workstation",
        openCodeOrigin: "https://server.test",
        password: "  exact password  ",
        username: " opencode ",
        v: 1,
      }),
    ).toMatchObject({ password: "  exact password  ", username: " opencode " });
    expect(
      parseNotificationConnectionBootstrap({
        allowDevelopmentHttp: false,
        auth: { mode: "bearer", token: "  exact token  " },
        baseUrl: "https://server.test",
        name: "Workstation",
        v: 1,
      }),
    ).toMatchObject({ auth: { mode: "bearer", token: "  exact token  " } });
  });

  it("validates shared notification delivery state", () => {
    expect(parseNotificationDeliveryState({ enabled: false, updatedAtMs: 1_000, v: 1 })).toEqual({
      enabled: false,
      updatedAtMs: 1_000,
      v: 1,
    });
    expect(() =>
      parseNotificationDeliveryState({ enabled: "false", updatedAtMs: 1_000, v: 1 }),
    ).toThrow("INVALID_NOTIFICATION_STATE");
  });
});
