import {
  decodeNotificationBytes,
  notificationDeviceKeyBytes,
} from "@opencode2-mobile/notification-protocol";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { SQLiteDatabase } from "expo-sqlite";

import { secureStoreService } from "../security/secure-store-service";

export type NotificationPairing = {
  bindingID: string;
  brokerID: string;
  brokerOrigin: string;
  connectionId: string;
  createdAtMs: number;
  secretRef: string;
};

export type NotificationPairingSecret = {
  bindingID: string;
  deviceKey: string;
  v: 1;
};

type NotificationPairingRow = {
  binding_id: string;
  broker_id: string;
  broker_origin: string;
  connection_id: string;
  created_at_ms: number;
  secret_ref: string;
};

type PendingNotificationRevocationRow = {
  binding_id: string;
  broker_origin: string;
  created_at_ms: number;
  secret_ref: string;
};

const notificationSecretStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: secureStoreService("notifications"),
} satisfies SecureStore.SecureStoreOptions;

export async function installNotificationPairing(
  db: SQLiteDatabase,
  input: Omit<NotificationPairing, "createdAtMs" | "secretRef"> & {
    deviceKey: string;
  },
) {
  parseNotificationPairingSecret({ bindingID: input.bindingID, deviceKey: input.deviceKey, v: 1 });
  const brokerOrigin = parseBrokerOrigin(input.brokerOrigin);
  const secretRef = `opencode.notification.pairing.v1.${Crypto.randomUUID()}`;
  await db.runAsync(
    "INSERT INTO pending_notification_secret_writes(secret_ref) VALUES (?)",
    secretRef,
  );
  try {
    await writeSecret(secretRef, {
      bindingID: input.bindingID,
      deviceKey: input.deviceKey,
      v: 1,
    });
  } catch (error) {
    await cleanupFailedWrite(db, secretRef);
    throw error;
  }

  let previousSecretRef: string | undefined;
  let pendingRevocationSecretRef: string | undefined;
  try {
    await db.withExclusiveTransactionAsync(async (txn) => {
      const profile = await txn.getFirstAsync<{ id: string }>(
        "SELECT id FROM connection_profiles WHERE id = ?",
        input.connectionId,
      );
      if (!profile) throw new Error("CONNECTION_PROFILE_NOT_FOUND");
      const previous = await txn.getFirstAsync<{ secret_ref: string }>(
        "SELECT secret_ref FROM notification_pairings WHERE connection_id = ?",
        input.connectionId,
      );
      previousSecretRef = previous?.secret_ref;
      const pendingRevocation = await txn.getFirstAsync<{ secret_ref: string }>(
        "SELECT secret_ref FROM pending_notification_revocations WHERE binding_id = ?",
        input.bindingID,
      );
      pendingRevocationSecretRef = pendingRevocation?.secret_ref;
      await txn.runAsync(
        `INSERT INTO notification_pairings (
          connection_id, binding_id, broker_id, broker_origin, secret_ref, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET
          binding_id = excluded.binding_id,
          broker_id = excluded.broker_id,
          broker_origin = excluded.broker_origin,
          secret_ref = excluded.secret_ref,
          created_at_ms = excluded.created_at_ms`,
        input.connectionId,
        input.bindingID,
        input.brokerID,
        brokerOrigin,
        secretRef,
        Date.now(),
      );
      await txn.runAsync(
        "DELETE FROM pending_notification_secret_writes WHERE secret_ref = ?",
        secretRef,
      );
      if (previousSecretRef && previousSecretRef !== secretRef) {
        await txn.runAsync(
          "INSERT OR IGNORE INTO pending_notification_secret_deletions(secret_ref) VALUES (?)",
          previousSecretRef,
        );
      }
      if (pendingRevocationSecretRef) {
        await txn.runAsync(
          "DELETE FROM pending_notification_revocations WHERE binding_id = ?",
          input.bindingID,
        );
        await txn.runAsync(
          "INSERT OR IGNORE INTO pending_notification_secret_deletions(secret_ref) VALUES (?)",
          pendingRevocationSecretRef,
        );
      }
    });
  } catch (error) {
    await cleanupFailedWrite(db, secretRef);
    throw error;
  }
  if (previousSecretRef && previousSecretRef !== secretRef) {
    await finishSecretDeletion(db, previousSecretRef).catch(() => undefined);
  }
  if (pendingRevocationSecretRef) {
    await finishSecretDeletion(db, pendingRevocationSecretRef).catch(() => undefined);
  }
}

export async function stagePendingNotificationRevocation(
  db: SQLiteDatabase,
  input: { bindingID: string; brokerOrigin: string; deviceKey: string },
) {
  const existing = await db.getFirstAsync<PendingNotificationRevocationRow>(
    "SELECT * FROM pending_notification_revocations WHERE binding_id = ?",
    input.bindingID,
  );
  if (existing) {
    const pending = decodePendingRevocation(existing);
    if (pending.brokerOrigin !== parseBrokerOrigin(input.brokerOrigin)) {
      throw new Error("PENDING_NOTIFICATION_REVOCATION_MISMATCH");
    }
    return pending;
  }
  const secret = parseNotificationPairingSecret({
    bindingID: input.bindingID,
    deviceKey: input.deviceKey,
    v: 1,
  });
  const secretRef = `opencode.notification.revocation.v1.${Crypto.randomUUID()}`;
  await db.runAsync(
    "INSERT INTO pending_notification_secret_writes(secret_ref) VALUES (?)",
    secretRef,
  );
  try {
    await writeSecret(secretRef, secret);
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(
        `INSERT INTO pending_notification_revocations(
          binding_id, broker_origin, secret_ref, created_at_ms
        ) VALUES (?, ?, ?, ?)`,
        input.bindingID,
        parseBrokerOrigin(input.brokerOrigin),
        secretRef,
        Date.now(),
      );
      await txn.runAsync(
        "DELETE FROM pending_notification_secret_writes WHERE secret_ref = ?",
        secretRef,
      );
    });
  } catch (error) {
    await cleanupFailedWrite(db, secretRef);
    throw error;
  }
  return {
    bindingID: input.bindingID,
    brokerOrigin: parseBrokerOrigin(input.brokerOrigin),
    createdAtMs: Date.now(),
    secretRef,
  };
}

export async function listPendingNotificationRevocations(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<PendingNotificationRevocationRow>(
    "SELECT * FROM pending_notification_revocations ORDER BY created_at_ms ASC",
  );
  return rows.map(decodePendingRevocation);
}

export async function readPendingNotificationRevocationSecret(
  pending: ReturnType<typeof decodePendingRevocation>,
) {
  if (!(await SecureStore.isAvailableAsync())) throw new Error("SECURE_STORE_UNAVAILABLE");
  const value = await SecureStore.getItemAsync(pending.secretRef, notificationSecretStoreOptions);
  if (value === null) throw new Error("NOTIFICATION_PAIRING_SECRET_MISSING");
  const secret = parseNotificationPairingSecret(JSON.parse(value));
  if (secret.bindingID !== pending.bindingID) {
    throw new Error("NOTIFICATION_PAIRING_BINDING_MISMATCH");
  }
  return secret;
}

export async function finishPendingNotificationRevocation(
  db: SQLiteDatabase,
  pending: ReturnType<typeof decodePendingRevocation>,
) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      "DELETE FROM pending_notification_revocations WHERE binding_id = ?",
      pending.bindingID,
    );
    await txn.runAsync(
      "INSERT OR IGNORE INTO pending_notification_secret_deletions(secret_ref) VALUES (?)",
      pending.secretRef,
    );
  });
  await finishSecretDeletion(db, pending.secretRef).catch(() => undefined);
}

export async function listNotificationPairings(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<NotificationPairingRow>(
    "SELECT * FROM notification_pairings ORDER BY created_at_ms ASC",
  );
  return rows.map(decodePairing);
}

export async function getNotificationPairingByBindingID(db: SQLiteDatabase, bindingID: string) {
  const row = await db.getFirstAsync<NotificationPairingRow>(
    "SELECT * FROM notification_pairings WHERE binding_id = ?",
    bindingID,
  );
  return row ? decodePairing(row) : undefined;
}

export async function getNotificationPairingByConnectionID(
  db: SQLiteDatabase,
  connectionId: string,
) {
  const row = await db.getFirstAsync<NotificationPairingRow>(
    "SELECT * FROM notification_pairings WHERE connection_id = ?",
    connectionId,
  );
  return row ? decodePairing(row) : undefined;
}

export async function readNotificationPairingSecret(pairing: NotificationPairing) {
  if (!(await SecureStore.isAvailableAsync())) throw new Error("SECURE_STORE_UNAVAILABLE");
  const value = await SecureStore.getItemAsync(pairing.secretRef, notificationSecretStoreOptions);
  if (value === null) throw new Error("NOTIFICATION_PAIRING_SECRET_MISSING");
  const secret = parseNotificationPairingSecret(JSON.parse(value));
  if (secret.bindingID !== pairing.bindingID) {
    throw new Error("NOTIFICATION_PAIRING_BINDING_MISMATCH");
  }
  return secret;
}

export async function cleanupPendingNotificationSecretOperations(db: SQLiteDatabase) {
  const writes = await db.getAllAsync<{ secret_ref: string }>(
    "SELECT secret_ref FROM pending_notification_secret_writes",
  );
  for (const row of writes) {
    await deleteSecret(row.secret_ref)
      .then(() =>
        db.runAsync(
          "DELETE FROM pending_notification_secret_writes WHERE secret_ref = ?",
          row.secret_ref,
        ),
      )
      .catch(() => undefined);
  }
  const deletions = await db.getAllAsync<{ secret_ref: string }>(
    "SELECT secret_ref FROM pending_notification_secret_deletions",
  );
  for (const row of deletions) {
    await finishSecretDeletion(db, row.secret_ref).catch(() => undefined);
  }
}

export async function removeNotificationPairing(db: SQLiteDatabase, connectionId: string) {
  let secretRef: string | undefined;
  await db.withExclusiveTransactionAsync(async (txn) => {
    secretRef = await stageNotificationPairingRemoval(txn, connectionId);
  });
  if (secretRef) await finishNotificationSecretDeletion(db, secretRef).catch(() => undefined);
}

export async function stageNotificationPairingRemoval(db: SQLiteDatabase, connectionId: string) {
  const row = await db.getFirstAsync<{ secret_ref: string }>(
    "SELECT secret_ref FROM notification_pairings WHERE connection_id = ?",
    connectionId,
  );
  const secretRef = row?.secret_ref;
  if (secretRef) {
    await db.runAsync(
      "INSERT OR IGNORE INTO pending_notification_secret_deletions(secret_ref) VALUES (?)",
      secretRef,
    );
  }
  await db.runAsync("DELETE FROM notification_pairings WHERE connection_id = ?", connectionId);
  return secretRef;
}

export async function finishNotificationSecretDeletion(db: SQLiteDatabase, secretRef: string) {
  await finishSecretDeletion(db, secretRef);
}

async function writeSecret(reference: string, secret: NotificationPairingSecret) {
  if (!(await SecureStore.isAvailableAsync())) throw new Error("SECURE_STORE_UNAVAILABLE");
  await SecureStore.setItemAsync(reference, JSON.stringify(secret), notificationSecretStoreOptions);
}

async function deleteSecret(reference: string) {
  if (!(await SecureStore.isAvailableAsync())) throw new Error("SECURE_STORE_UNAVAILABLE");
  await SecureStore.deleteItemAsync(reference, notificationSecretStoreOptions);
}

async function cleanupFailedWrite(db: SQLiteDatabase, secretRef: string) {
  await deleteSecret(secretRef).catch(() => undefined);
  await db
    .runAsync("DELETE FROM pending_notification_secret_writes WHERE secret_ref = ?", secretRef)
    .catch(() => undefined);
}

async function finishSecretDeletion(db: SQLiteDatabase, secretRef: string) {
  await deleteSecret(secretRef);
  await db.runAsync(
    "DELETE FROM pending_notification_secret_deletions WHERE secret_ref = ?",
    secretRef,
  );
}

function decodePairing(row: NotificationPairingRow): NotificationPairing {
  return {
    bindingID: parseIdentifier(row.binding_id),
    brokerID: parseIdentifier(row.broker_id),
    brokerOrigin: parseBrokerOrigin(row.broker_origin),
    connectionId: parseIdentifier(row.connection_id),
    createdAtMs: parseTimestamp(row.created_at_ms),
    secretRef: parseSecretReference(row.secret_ref),
  };
}

function decodePendingRevocation(row: PendingNotificationRevocationRow) {
  const secretRef = parseIdentifier(row.secret_ref);
  if (!secretRef.startsWith("opencode.notification.revocation.v1.")) {
    throw new Error("INVALID_NOTIFICATION_PAIRING");
  }
  return {
    bindingID: parseIdentifier(row.binding_id),
    brokerOrigin: parseBrokerOrigin(row.broker_origin),
    createdAtMs: parseTimestamp(row.created_at_ms),
    secretRef,
  };
}

function parseNotificationPairingSecret(value: unknown): NotificationPairingSecret {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_NOTIFICATION_PAIRING_SECRET");
  const bindingID = parseIdentifier(value.bindingID);
  if (typeof value.deviceKey !== "string") throw new Error("INVALID_NOTIFICATION_PAIRING_SECRET");
  decodeNotificationBytes(value.deviceKey, notificationDeviceKeyBytes);
  return { bindingID, deviceKey: value.deviceKey, v: 1 };
}

function parseBrokerOrigin(value: unknown) {
  if (typeof value !== "string") throw new Error("INVALID_NOTIFICATION_PAIRING");
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("INVALID_NOTIFICATION_PAIRING");
  }
  return url.origin;
}

function parseIdentifier(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 160 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new Error("INVALID_NOTIFICATION_PAIRING");
  }
  return value;
}

function parseTimestamp(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("INVALID_NOTIFICATION_PAIRING");
  }
  return Number(value);
}

function parseSecretReference(value: unknown) {
  const reference = parseIdentifier(value);
  if (!reference.startsWith("opencode.notification.pairing.v1.")) {
    throw new Error("INVALID_NOTIFICATION_PAIRING");
  }
  return reference;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
