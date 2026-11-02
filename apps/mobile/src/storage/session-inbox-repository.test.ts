import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  type CollapsibleInboxSection,
  startSessionInbox,
  writeInboxSectionExpanded,
} from "./session-inbox-repository";

type Stored = { archived_expanded: number; since_ms: number; working_expanded: number };

function fakeDb(stored: Stored | null, updatedAt = 7) {
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
  const { db, transaction } = fakeDb({
    archived_expanded: 1,
    since_ms: 1_000,
    working_expanded: 1,
  });
  await expect(startSessionInbox(db, "connection-a", 7, 5_000)).resolves.toEqual({
    archivedExpanded: true,
    sinceMs: 1_000,
    workingExpanded: true,
  });
  expect(transaction.runAsync).toHaveBeenCalledWith(
    expect.stringContaining("ON CONFLICT(connection_id) DO NOTHING"),
    "connection-a",
    5_000,
  );
});

test("reads collapsed Working and Archived sections", async () => {
  const { db } = fakeDb({ archived_expanded: 0, since_ms: 1_000, working_expanded: 0 });
  await expect(startSessionInbox(db, "connection-a", 7, 5_000)).resolves.toEqual({
    archivedExpanded: false,
    sinceMs: 1_000,
    workingExpanded: false,
  });
});

test("writes each section's state after checking the connection profile", async () => {
  const { db, transaction } = fakeDb(null);
  await writeInboxSectionExpanded(db, "connection-a", 7, "working", false);
  expect(transaction.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining("SET working_expanded = ?"),
    0,
    "connection-a",
  );
  await writeInboxSectionExpanded(db, "connection-a", 7, "archived", true);
  expect(transaction.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining("SET archived_expanded = ?"),
    1,
    "connection-a",
  );
});

test("rejects invalid input and writes after the profile changed", async () => {
  const { db, transaction } = fakeDb({ archived_expanded: 1, since_ms: 1, working_expanded: 1 }, 8);
  await expect(startSessionInbox(db, "connection-a", 7, 5_000)).rejects.toThrow(
    "CONNECTION_PROFILE_CHANGED",
  );
  await expect(writeInboxSectionExpanded(db, "connection-a", 7, "working", true)).rejects.toThrow(
    "CONNECTION_PROFILE_CHANGED",
  );
  await expect(
    writeInboxSectionExpanded(db, "connection-a", 8, "since_ms" as CollapsibleInboxSection, true),
  ).rejects.toThrow("INVALID_SESSION_INBOX_SECTION");
  await expect(startSessionInbox(db, " ", 8, 5_000)).rejects.toThrow(
    "INVALID_SESSION_INBOX_CONNECTION",
  );
  await expect(startSessionInbox(db, "connection-a", 8, -1)).rejects.toThrow(
    "INVALID_SESSION_INBOX_START",
  );
  expect(transaction.runAsync).not.toHaveBeenCalled();
});
