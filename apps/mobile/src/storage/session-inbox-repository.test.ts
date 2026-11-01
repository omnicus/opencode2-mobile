import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";
import { startSessionInbox, writeWorkingShelfExpanded } from "./session-inbox-repository";

function fakeDb(stored: { since_ms: number; working_expanded: number } | null, updatedAt = 7) {
  const transaction = {
    getFirstAsync: jest.fn(async (sql: string) =>
      sql.includes("connection_profiles") ? { updated_at_ms: updatedAt } : stored,
    ),
    runAsync: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const db = {
    withExclusiveTransactionAsync: async (fn: (txn: typeof transaction) => Promise<void>) =>
      fn(transaction),
  } as unknown as SQLiteDatabase;
  return { db, transaction };
}

test("starts the inbox once and keeps the first start time", async () => {
  const { db, transaction } = fakeDb({ since_ms: 1_000, working_expanded: 1 });
  await expect(startSessionInbox(db, "connection-a", 7, 5_000)).resolves.toEqual({
    sinceMs: 1_000,
    workingExpanded: true,
  });
  expect(transaction.runAsync).toHaveBeenCalledWith(
    expect.stringContaining("ON CONFLICT(connection_id) DO NOTHING"),
    "connection-a",
    5_000,
  );
});

test("reads a collapsed Working shelf", async () => {
  const { db } = fakeDb({ since_ms: 1_000, working_expanded: 0 });
  await expect(startSessionInbox(db, "connection-a", 7, 5_000)).resolves.toEqual({
    sinceMs: 1_000,
    workingExpanded: false,
  });
});

test("writes the Working shelf state after checking the connection profile", async () => {
  const { db, transaction } = fakeDb(null);
  await writeWorkingShelfExpanded(db, "connection-a", 7, false);
  expect(transaction.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining("SET working_expanded = ?"),
    0,
    "connection-a",
  );
});

test("rejects invalid input and writes after the profile changed", async () => {
  const { db, transaction } = fakeDb({ since_ms: 1, working_expanded: 1 }, 8);
  await expect(startSessionInbox(db, "connection-a", 7, 5_000)).rejects.toThrow(
    "CONNECTION_PROFILE_CHANGED",
  );
  await expect(writeWorkingShelfExpanded(db, "connection-a", 7, true)).rejects.toThrow(
    "CONNECTION_PROFILE_CHANGED",
  );
  await expect(startSessionInbox(db, " ", 8, 5_000)).rejects.toThrow(
    "INVALID_SESSION_INBOX_CONNECTION",
  );
  await expect(startSessionInbox(db, "connection-a", 8, -1)).rejects.toThrow(
    "INVALID_SESSION_INBOX_START",
  );
  expect(transaction.runAsync).not.toHaveBeenCalled();
});
