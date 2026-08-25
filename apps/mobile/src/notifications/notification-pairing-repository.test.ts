import { beforeEach, expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  cleanupPendingNotificationSecretOperations,
  finishPendingNotificationRevocation,
  installNotificationPairing,
  readNotificationPairingSecret,
  stagePendingNotificationRevocation,
} from "./notification-pairing-repository";

const mockDeleteItem = jest.fn<(key: string) => Promise<void>>(async () => undefined);
const mockGetItem = jest.fn<(key: string) => Promise<string | null>>(async () => null);
const mockSetItem = jest.fn<(key: string, value: string) => Promise<void>>(async () => undefined);

jest.mock("expo-crypto", () => ({ randomUUID: () => "secret-id" }));
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
  deleteItemAsync: (key: string) => mockDeleteItem(key),
  getItemAsync: (key: string) => mockGetItem(key),
  isAvailableAsync: async () => true,
  setItemAsync: (key: string, value: string) => mockSetItem(key, value),
}));

beforeEach(() => {
  mockDeleteItem.mockClear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
});

test("keeps the device key in SecureStore and only opaque metadata in SQLite", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));
  const db = {
    getFirstAsync: jest.fn(async (sql: string) =>
      sql.includes("connection_profiles") ? { id: "connection-1" } : null,
    ),
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: SQLiteDatabase) => Promise<void>) =>
      task(db as unknown as SQLiteDatabase),
  } as unknown as SQLiteDatabase;
  const deviceKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

  await installNotificationPairing(db, {
    bindingID: "binding-1",
    brokerID: "broker-1",
    brokerOrigin: "https://push.test",
    connectionId: "connection-1",
    deviceKey,
  });

  expect(mockSetItem).toHaveBeenCalledWith(
    "opencode.notification.pairing.v1.secret-id",
    JSON.stringify({ bindingID: "binding-1", deviceKey, v: 1 }),
  );
  expect(JSON.stringify(runAsync.mock.calls)).not.toContain(deviceKey);
  expect(JSON.stringify(runAsync.mock.calls)).not.toContain("ExponentPushToken");
});

test("deletes orphaned writes after an interrupted install", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));
  const db = {
    getAllAsync: jest.fn(async (sql: string) =>
      sql.includes("writes") ? [{ secret_ref: "orphan-ref" }] : [],
    ),
    runAsync,
  } as unknown as SQLiteDatabase;

  await cleanupPendingNotificationSecretOperations(db);

  expect(mockDeleteItem).toHaveBeenCalledWith("orphan-ref");
  expect(runAsync).toHaveBeenCalledWith(
    "DELETE FROM pending_notification_secret_writes WHERE secret_ref = ?",
    "orphan-ref",
  );
});

test("rejects a keychain value belonging to another binding", async () => {
  mockGetItem.mockResolvedValueOnce(
    JSON.stringify({
      bindingID: "binding-2",
      deviceKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      v: 1,
    }),
  );

  await expect(
    readNotificationPairingSecret({
      bindingID: "binding-1",
      brokerID: "broker-1",
      brokerOrigin: "https://push.test",
      connectionId: "connection-1",
      createdAtMs: 1,
      secretRef: "opencode.notification.pairing.v1.secret-id",
    }),
  ).rejects.toThrow("NOTIFICATION_PAIRING_BINDING_MISMATCH");
});

test("stages broker revocation before registration can become active", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));
  const db = {
    getFirstAsync: jest.fn(async () => null),
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: SQLiteDatabase) => Promise<void>) =>
      task(db as unknown as SQLiteDatabase),
  } as unknown as SQLiteDatabase;
  const deviceKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

  const pending = await stagePendingNotificationRevocation(db, {
    bindingID: "binding-1",
    brokerOrigin: "https://push.test",
    deviceKey,
  });

  expect(pending.secretRef).toBe("opencode.notification.revocation.v1.secret-id");
  expect(mockSetItem).toHaveBeenCalledWith(
    pending.secretRef,
    JSON.stringify({ bindingID: "binding-1", deviceKey, v: 1 }),
  );
  expect(JSON.stringify(runAsync.mock.calls)).not.toContain(deviceKey);

  await finishPendingNotificationRevocation(db, pending);
  expect(mockDeleteItem).toHaveBeenCalledWith(pending.secretRef);
});

test("does not reuse pending revocation material for another broker", async () => {
  const db = {
    getFirstAsync: jest.fn(async () => ({
      binding_id: "binding-1",
      broker_origin: "https://push-a.test",
      created_at_ms: 1,
      secret_ref: "opencode.notification.revocation.v1.secret-ref",
    })),
  } as unknown as SQLiteDatabase;

  await expect(
    stagePendingNotificationRevocation(db, {
      bindingID: "binding-1",
      brokerOrigin: "https://push-b.test",
      deviceKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    }),
  ).rejects.toThrow("PENDING_NOTIFICATION_REVOCATION_MISMATCH");
});
