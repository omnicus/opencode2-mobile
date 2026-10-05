import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  readArchivedSessionIds,
  readSessionArchivePreferences,
  setSessionArchived,
} from "./session-archive-repository";

test("reads and writes identity-only archives for the exact connection", async () => {
  const transaction = {
    getFirstAsync: jest.fn(async () => ({ updated_at_ms: 7 })),
    runAsync: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const getAllAsync = jest.fn(async (..._args: unknown[]) => [{ session_id: "ses_a" }]);
  const db = {
    getAllAsync,
    withExclusiveTransactionAsync: async (fn: (tx: typeof transaction) => Promise<void>) =>
      fn(transaction),
  } as unknown as SQLiteDatabase;
  expect(await readArchivedSessionIds(db, "connection-a")).toEqual(["ses_a"]);
  expect(getAllAsync).toHaveBeenCalledWith(
    expect.stringContaining("WHERE connection_id = ?"),
    "connection-a",
  );
  await setSessionArchived(db, "connection-b", "ses_a", true, 7);
  expect(transaction.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining("ON CONFLICT"),
    "connection-b",
    "ses_a",
    null,
  );
  await setSessionArchived(db, "connection-b", "ses_a", false, 7);
  expect(transaction.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining("restored_at_ms"),
    "connection-b",
    "ses_a",
    expect.any(Number),
  );
});

test("rejects writes after a profile changes and propagates disk failure", async () => {
  const runAsync = jest.fn(async () => {
    throw new Error("disk");
  });
  const db = {
    withExclusiveTransactionAsync: async (fn: (tx: unknown) => Promise<void>) =>
      fn({ getFirstAsync: async () => ({ updated_at_ms: 8 }), runAsync }),
  } as unknown as SQLiteDatabase;
  await expect(setSessionArchived(db, "connection", "ses_a", true, 7)).rejects.toThrow(
    "CONNECTION_PROFILE_CHANGED",
  );
  expect(runAsync).not.toHaveBeenCalled();
  await expect(setSessionArchived(db, "connection", "ses_a", true, 8)).rejects.toThrow("disk");
});

test("rejects malformed persisted identifiers", async () => {
  const db = { getAllAsync: async () => [{ session_id: "" }] } as unknown as SQLiteDatabase;
  await expect(readArchivedSessionIds(db, "connection")).rejects.toThrow(
    "INVALID_ARCHIVE_IDENTIFIER",
  );
  await expect(setSessionArchived(db, "", "ses_a", true)).rejects.toThrow(
    "INVALID_ARCHIVE_IDENTIFIER",
  );
});

test("reads manual archives separately from device-owned restoration timestamps", async () => {
  const db = {
    getAllAsync: async () => [
      { session_id: "ses_manual", restored_at_ms: null },
      { session_id: "ses_restored", restored_at_ms: 123 },
    ],
  } as unknown as SQLiteDatabase;
  expect(await readSessionArchivePreferences(db, "connection")).toEqual({
    ids: ["ses_manual"],
    restoredAt: { ses_restored: 123 },
  });
  expect(await readArchivedSessionIds(db, "connection")).toEqual(["ses_manual"]);
  const invalid = {
    getAllAsync: async () => [{ session_id: "ses_restored", restored_at_ms: -1 }],
  } as unknown as SQLiteDatabase;
  await expect(readSessionArchivePreferences(invalid, "connection")).rejects.toThrow(
    "INVALID_ARCHIVE_PREFERENCE",
  );
});
