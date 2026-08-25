import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import {
  decodeNotificationBytes,
  encodeNotificationBytes,
  type NotificationConnectionBootstrap,
  type NotificationPairingCode,
  type NotificationPairingResponse,
  type NotificationPluginEvent,
  type NotificationRoutingEnvelope,
  notificationBootstrapAdditionalData,
  notificationDeviceKeyBytes,
  notificationNonceBytes,
  notificationPairingLifetimeMs,
  notificationPushAdditionalData,
  parseNotificationConnectionBootstrap,
  parseNotificationDeviceCommand,
  parseNotificationPairingRegistration,
  parseNotificationPluginEvent,
  sealNotificationJson,
} from "@opencode2-mobile/notification-protocol";

import { decryptBrokerValue, encryptBrokerValue } from "./crypto.js";

type ChallengeRow = {
  binding_id: string | null;
  bootstrap_ciphertext: Uint8Array;
  bootstrap_nonce: Uint8Array;
  consumed_at_ms: number | null;
  expires_at_ms: number;
  paired_at_ms: number | null;
  secret_ciphertext: Uint8Array;
  secret_nonce: Uint8Array;
};

type DeviceRow = {
  binding_id: string;
  created_at_ms: number;
  device_key_ciphertext: Uint8Array;
  device_key_nonce: Uint8Array;
  disabled_at_ms: number | null;
  expo_token_ciphertext: Uint8Array;
  expo_token_nonce: Uint8Array;
};

export class BrokerDatabase {
  readonly database: DatabaseSync;

  constructor(
    path: string,
    private readonly masterKey: Uint8Array,
  ) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { mode: 0o700, recursive: true });
      chmodSync(dirname(path), 0o700);
    }
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA trusted_schema = OFF;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS pairing_challenges (
        id TEXT PRIMARY KEY NOT NULL,
        secret_nonce BLOB NOT NULL,
        secret_ciphertext BLOB NOT NULL,
        bootstrap_nonce BLOB NOT NULL,
        bootstrap_ciphertext BLOB NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        consumed_at_ms INTEGER,
        paired_at_ms INTEGER,
        binding_id TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS devices (
        binding_id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
        device_key_nonce BLOB NOT NULL,
        device_key_ciphertext BLOB NOT NULL,
        expo_token_nonce BLOB NOT NULL,
        expo_token_ciphertext BLOB NOT NULL,
        created_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        disabled_at_ms INTEGER,
        disabled_reason TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS plugin_events (
        event_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'resolved')),
        observed_at_ms INTEGER NOT NULL,
        PRIMARY KEY (event_id, state)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY NOT NULL,
        binding_id TEXT NOT NULL REFERENCES devices(binding_id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        interaction_key TEXT,
        push_data_json TEXT NOT NULL,
        collapse_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('queued', 'ticketed', 'delivered', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at_ms INTEGER NOT NULL,
        ticket_id TEXT,
        receipt_due_at_ms INTEGER,
        created_at_ms INTEGER NOT NULL,
        last_error_code TEXT,
        UNIQUE (binding_id, event_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS outbox_due ON outbox(state, next_attempt_at_ms);
      CREATE TABLE IF NOT EXISTS replay_nonces (
        binding_id TEXT NOT NULL REFERENCES devices(binding_id) ON DELETE CASCADE,
        nonce_id TEXT NOT NULL,
        used_at_ms INTEGER NOT NULL,
        PRIMARY KEY (binding_id, nonce_id)
      ) STRICT;
    `);
    this.migratePreReleaseSchema();
    if (path !== ":memory:") {
      for (const databasePath of [path, `${path}-wal`, `${path}-shm`]) {
        if (existsSync(databasePath)) chmodSync(databasePath, 0o600);
      }
    }
  }

  close() {
    this.database.close();
  }

  private migratePreReleaseSchema() {
    const additions = [
      ["pairing_challenges", "paired_at_ms", "INTEGER"],
      ["pairing_challenges", "binding_id", "TEXT"],
      ["outbox", "interaction_key", "TEXT"],
    ] as const;
    const missing = additions.filter(([table, column]) => {
      const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>;
      return !columns.some((candidate) => candidate.name === column);
    });
    if (missing.length === 0) return;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const [table, column, type] of missing) {
        this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createPairing(
    input: Omit<NotificationPairingCode, "challengeID" | "expiresAtMs" | "pairingSecret" | "v">,
    bootstrap: NotificationConnectionBootstrap,
    now = Date.now(),
  ) {
    const challengeID = randomUUID();
    const secret = randomBytes(notificationDeviceKeyBytes);
    const secretEncrypted = encryptBrokerValue(this.masterKey, secret);
    const bootstrapNonce = randomBytes(notificationNonceBytes);
    const bootstrapCiphertext = sealNotificationJson(
      secret,
      bootstrapNonce,
      parseNotificationConnectionBootstrap(bootstrap),
      notificationBootstrapAdditionalData(challengeID),
    );
    const expiresAtMs = now + notificationPairingLifetimeMs;
    this.database
      .prepare(
        `INSERT INTO pairing_challenges (
          id, secret_nonce, secret_ciphertext, bootstrap_nonce, bootstrap_ciphertext, expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        challengeID,
        secretEncrypted.nonce,
        secretEncrypted.ciphertext,
        bootstrapNonce,
        Buffer.from(bootstrapCiphertext, "utf8"),
        expiresAtMs,
      );
    return {
      ...input,
      challengeID,
      expiresAtMs,
      pairingSecret: encodeNotificationBytes(secret),
      v: 1,
    } satisfies NotificationPairingCode;
  }

  completePairing(
    challengeID: string,
    registrationValue: unknown,
    brokerID: string,
    now = Date.now(),
  ): Omit<NotificationPairingResponse, "metadataCiphertext" | "metadataNonce"> {
    const challenge = this.database
      .prepare("SELECT * FROM pairing_challenges WHERE id = ?")
      .get(challengeID) as ChallengeRow | undefined;
    if (
      !challenge ||
      (challenge.consumed_at_ms === null && challenge.expires_at_ms < now) ||
      (challenge.consumed_at_ms !== null && challenge.consumed_at_ms + 24 * 60 * 60_000 < now)
    ) {
      throw new Error("PAIRING_UNAVAILABLE");
    }
    const registration = parseNotificationPairingRegistration(registrationValue);
    const pairedAtMs = challenge.paired_at_ms ?? now;
    if (challenge.consumed_at_ms !== null) {
      if (challenge.binding_id !== registration.bindingID) throw new Error("PAIRING_UNAVAILABLE");
      const existingDevice = this.database
        .prepare("SELECT * FROM devices WHERE binding_id = ?")
        .get(registration.bindingID) as DeviceRow | undefined;
      if (!existingDevice) throw new Error("PAIRING_UNAVAILABLE");
      const suppliedKey = decodeNotificationBytes(
        registration.deviceKey,
        notificationDeviceKeyBytes,
      );
      const storedKey = this.getDeviceKey(existingDevice);
      if (
        suppliedKey.byteLength !== storedKey.byteLength ||
        !timingSafeEqual(suppliedKey, storedKey)
      ) {
        throw new Error("PAIRING_UNAVAILABLE");
      }
      const wasDisabled = existingDevice.disabled_at_ms !== null;
      const tokenEncrypted = encryptBrokerValue(
        this.masterKey,
        new TextEncoder().encode(registration.expoPushToken),
      );
      this.database
        .prepare(
          `UPDATE devices SET expo_token_nonce = ?, expo_token_ciphertext = ?,
           last_seen_at_ms = ?, disabled_at_ms = NULL, disabled_reason = NULL
           WHERE binding_id = ?`,
        )
        .run(tokenEncrypted.nonce, tokenEncrypted.ciphertext, now, registration.bindingID);
      if (wasDisabled) this.enqueueTest(registration.bindingID, now);
      return {
        bootstrapCiphertext: Buffer.from(challenge.bootstrap_ciphertext).toString("utf8"),
        bootstrapNonce: encodeNotificationBytes(challenge.bootstrap_nonce),
        brokerID,
        pairedAtMs,
        v: 1,
      };
    }
    if (
      this.database
        .prepare("SELECT 1 FROM devices WHERE binding_id = ?")
        .get(registration.bindingID)
    ) {
      throw new Error("PAIRING_UNAVAILABLE");
    }
    const deviceKey = decodeNotificationBytes(registration.deviceKey, notificationDeviceKeyBytes);
    const tokenEncrypted = encryptBrokerValue(
      this.masterKey,
      new TextEncoder().encode(registration.expoPushToken),
    );
    const keyEncrypted = encryptBrokerValue(this.masterKey, deviceKey);
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO devices (
            binding_id, name, platform, device_key_nonce, device_key_ciphertext,
            expo_token_nonce, expo_token_ciphertext, created_at_ms, last_seen_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          registration.bindingID,
          registration.deviceName,
          registration.platform,
          keyEncrypted.nonce,
          keyEncrypted.ciphertext,
          tokenEncrypted.nonce,
          tokenEncrypted.ciphertext,
          now,
          now,
        );
      const result = this.database
        .prepare(
          `UPDATE pairing_challenges
           SET consumed_at_ms = COALESCE(consumed_at_ms, ?),
               paired_at_ms = COALESCE(paired_at_ms, ?),
               binding_id = ?
           WHERE id = ?`,
        )
        .run(now, pairedAtMs, registration.bindingID, challengeID);
      if (result.changes !== 1) throw new Error("PAIRING_UNAVAILABLE");
    });
    this.enqueueTest(registration.bindingID, now);
    return {
      bootstrapCiphertext: Buffer.from(challenge.bootstrap_ciphertext).toString("utf8"),
      bootstrapNonce: encodeNotificationBytes(challenge.bootstrap_nonce),
      brokerID,
      pairedAtMs,
      v: 1,
    };
  }

  readPairingSecret(challengeID: string, now = Date.now()) {
    const challenge = this.database
      .prepare("SELECT * FROM pairing_challenges WHERE id = ?")
      .get(challengeID) as ChallengeRow | undefined;
    if (
      !challenge ||
      (challenge.consumed_at_ms === null && challenge.expires_at_ms < now) ||
      (challenge.consumed_at_ms !== null && challenge.consumed_at_ms + 24 * 60 * 60_000 < now)
    ) {
      throw new Error("PAIRING_UNAVAILABLE");
    }
    return decryptBrokerValue(this.masterKey, challenge.secret_nonce, challenge.secret_ciphertext);
  }

  acceptPluginEvent(value: unknown) {
    const event = parseNotificationPluginEvent(value);
    this.transaction(() => {
      const inserted = this.database
        .prepare(
          "INSERT OR IGNORE INTO plugin_events(event_id, state, observed_at_ms) VALUES (?, ?, ?)",
        )
        .run(event.eventID, event.state, event.observedAtMs);
      if (inserted.changes === 0 || event.state === "resolved") return;
      const devices = this.database
        .prepare(
          `SELECT * FROM devices
           WHERE disabled_at_ms IS NULL AND created_at_ms <= ?
           ORDER BY created_at_ms ASC LIMIT 32`,
        )
        .all(event.observedAtMs) as unknown as DeviceRow[];
      for (const device of devices) this.enqueueInteraction(device, event);
    });
    if (event.state === "resolved") {
      this.database
        .prepare(
          `UPDATE outbox SET state = 'failed', push_data_json = '{}', last_error_code = 'RESOLVED'
           WHERE interaction_key = ? AND state = 'queued'`,
        )
        .run(interactionKey(event));
    }
    return event;
  }

  authenticateDeviceCommand(bindingID: string, value: unknown, now = Date.now()) {
    const device = this.getEnabledDevice(bindingID);
    const command = parseNotificationDeviceCommand(value);
    if (Math.abs(now - command.atMs) > 5 * 60_000) throw new Error("DEVICE_REQUEST_EXPIRED");
    const inserted = this.database
      .prepare(
        "INSERT OR IGNORE INTO replay_nonces(binding_id, nonce_id, used_at_ms) VALUES (?, ?, ?)",
      )
      .run(bindingID, command.nonceID, now);
    if (inserted.changes !== 1) throw new Error("DEVICE_REQUEST_REPLAYED");
    this.database.prepare("DELETE FROM replay_nonces WHERE used_at_ms < ?").run(now - 10 * 60_000);
    this.database
      .prepare("UPDATE devices SET last_seen_at_ms = ? WHERE binding_id = ?")
      .run(now, bindingID);
    return { command, device };
  }

  getDeviceKey(device: DeviceRow) {
    return decryptBrokerValue(
      this.masterKey,
      device.device_key_nonce,
      device.device_key_ciphertext,
    );
  }

  getDeviceForCommand(bindingID: string) {
    return this.database
      .prepare("SELECT * FROM devices WHERE binding_id = ? AND disabled_at_ms IS NULL")
      .get(bindingID) as DeviceRow | undefined;
  }

  updateDeviceToken(bindingID: string, token: string, now = Date.now()) {
    const encrypted = encryptBrokerValue(this.masterKey, new TextEncoder().encode(token));
    this.database
      .prepare(
        `UPDATE devices SET expo_token_nonce = ?, expo_token_ciphertext = ?,
         last_seen_at_ms = ? WHERE binding_id = ? AND disabled_at_ms IS NULL`,
      )
      .run(encrypted.nonce, encrypted.ciphertext, now, bindingID);
  }

  revokeDevice(bindingID: string, now = Date.now()) {
    this.database
      .prepare(
        "UPDATE devices SET disabled_at_ms = ?, disabled_reason = 'revoked' WHERE binding_id = ?",
      )
      .run(now, bindingID);
  }

  enqueueTest(bindingID: string, now = Date.now()) {
    const device = this.getEnabledDevice(bindingID);
    const route: NotificationRoutingEnvelope = {
      bindingID,
      expiresAtMs: now + 24 * 60 * 60_000,
      issuedAtMs: now,
      kind: "test",
      v: 1,
    };
    this.enqueueRoute(device, `test:${randomUUID()}`, route, now);
  }

  listDevices() {
    return this.database
      .prepare(
        `SELECT binding_id, name, platform, created_at_ms, last_seen_at_ms,
         disabled_at_ms, disabled_reason FROM devices ORDER BY created_at_ms ASC`,
      )
      .all();
  }

  nextQueued(limit = 25, now = Date.now()) {
    return this.database
      .prepare(
        `SELECT o.*, d.expo_token_nonce, d.expo_token_ciphertext
         FROM outbox o JOIN devices d ON d.binding_id = o.binding_id
         WHERE o.state = 'queued' AND o.next_attempt_at_ms <= ? AND d.disabled_at_ms IS NULL
         ORDER BY o.created_at_ms ASC LIMIT ?`,
      )
      .all(now, limit) as Array<Record<string, SQLInputValue>>;
  }

  nextReceipts(limit = 100, now = Date.now()) {
    return this.database
      .prepare(
        `SELECT id, binding_id, ticket_id, created_at_ms FROM outbox
         WHERE state = 'ticketed' AND receipt_due_at_ms <= ? AND ticket_id IS NOT NULL
         ORDER BY receipt_due_at_ms ASC LIMIT ?`,
      )
      .all(now, limit) as Array<Record<string, SQLInputValue>>;
  }

  decryptExpoToken(row: Record<string, SQLInputValue>) {
    return new TextDecoder().decode(
      decryptBrokerValue(
        this.masterKey,
        asBytes(row.expo_token_nonce),
        asBytes(row.expo_token_ciphertext),
      ),
    );
  }

  markTicketed(id: string, ticketID: string, now = Date.now()) {
    this.database
      .prepare(
        `UPDATE outbox SET state = 'ticketed', ticket_id = ?, receipt_due_at_ms = ?,
         attempts = attempts + 1 WHERE id = ?`,
      )
      .run(ticketID, now + 15 * 60_000, id);
  }

  markDelivered(id: string) {
    this.database.prepare("DELETE FROM outbox WHERE id = ?").run(id);
  }

  deferReceipt(id: string, delayMs: number, now = Date.now()) {
    this.database
      .prepare("UPDATE outbox SET receipt_due_at_ms = ? WHERE id = ? AND state = 'ticketed'")
      .run(now + delayMs, id);
  }

  markRetry(id: string, errorCode: string, now = Date.now()) {
    const row = this.database.prepare("SELECT attempts FROM outbox WHERE id = ?").get(id) as
      | { attempts: number }
      | undefined;
    const attempts = (row?.attempts ?? 0) + 1;
    const delay = Math.min(15 * 60_000, 2 ** Math.min(attempts, 8) * 1_000);
    this.database
      .prepare(
        `UPDATE outbox SET state = 'queued', attempts = ?, next_attempt_at_ms = ?,
         last_error_code = ? WHERE id = ?`,
      )
      .run(attempts, now + delay, errorCode, id);
  }

  markFailed(id: string, errorCode: string) {
    this.database
      .prepare(
        "UPDATE outbox SET state = 'failed', push_data_json = '{}', last_error_code = ? WHERE id = ?",
      )
      .run(errorCode, id);
  }

  prune(now = Date.now()) {
    this.database
      .prepare("DELETE FROM outbox WHERE state = 'failed' AND created_at_ms < ?")
      .run(now - 7 * 24 * 60 * 60_000);
    this.database
      .prepare("DELETE FROM plugin_events WHERE observed_at_ms < ?")
      .run(now - 30 * 24 * 60 * 60_000);
    this.database
      .prepare(
        `DELETE FROM pairing_challenges
         WHERE (consumed_at_ms IS NULL AND expires_at_ms < ?)
            OR (consumed_at_ms IS NOT NULL AND consumed_at_ms < ?)`,
      )
      .run(now, now - 24 * 60 * 60_000);
  }

  disableDevice(bindingID: string, reason: string, now = Date.now()) {
    this.database
      .prepare("UPDATE devices SET disabled_at_ms = ?, disabled_reason = ? WHERE binding_id = ?")
      .run(now, reason, bindingID);
  }

  health() {
    const devices = this.database
      .prepare("SELECT COUNT(*) AS count FROM devices WHERE disabled_at_ms IS NULL")
      .get() as { count: number };
    const queued = this.database
      .prepare("SELECT COUNT(*) AS count FROM outbox WHERE state = 'queued'")
      .get() as { count: number };
    return { devices: devices.count, queued: queued.count };
  }

  private getEnabledDevice(bindingID: string) {
    const device = this.database
      .prepare("SELECT * FROM devices WHERE binding_id = ? AND disabled_at_ms IS NULL")
      .get(bindingID) as DeviceRow | undefined;
    if (!device) throw new Error("DEVICE_NOT_FOUND");
    return device;
  }

  private enqueueInteraction(device: DeviceRow, event: NotificationPluginEvent) {
    const route: NotificationRoutingEnvelope = {
      bindingID: device.binding_id,
      eventID: event.eventID,
      expiresAtMs: event.observedAtMs + 7 * 24 * 60 * 60_000,
      interaction: event.interaction,
      issuedAtMs: event.observedAtMs,
      kind: "interaction",
      ...(event.location ? { location: event.location } : {}),
      requestID: event.requestID,
      sessionID: event.sessionID,
      v: 1,
    };
    this.enqueueRoute(device, event.eventID, route, event.observedAtMs, interactionKey(event));
  }

  private enqueueRoute(
    device: DeviceRow,
    eventID: string,
    route: NotificationRoutingEnvelope,
    now: number,
    interactionKeyValue?: string,
  ) {
    const nonce = randomBytes(notificationNonceBytes);
    const pushData = {
      bindingID: device.binding_id,
      ciphertext: sealNotificationJson(
        this.getDeviceKey(device),
        nonce,
        route,
        notificationPushAdditionalData(device.binding_id),
      ),
      nonce: encodeNotificationBytes(nonce),
      v: 1,
    };
    const collapseID = Buffer.from(eventID).toString("base64url").slice(0, 64);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO outbox (
          id, binding_id, event_id, interaction_key, push_data_json, collapse_id, state,
          next_attempt_at_ms, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      )
      .run(
        randomUUID(),
        device.binding_id,
        eventID,
        interactionKeyValue ?? null,
        JSON.stringify(pushData),
        collapseID,
        now,
        now,
      );
  }

  private transaction<T>(run: () => T) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function interactionKey(event: NotificationPluginEvent) {
  return `${event.interaction}\u0000${event.sessionID}\u0000${event.requestID}`;
}

function asBytes(value: SQLInputValue | undefined) {
  if (!(value instanceof Uint8Array)) throw new Error("INVALID_BROKER_DATA");
  return value;
}
