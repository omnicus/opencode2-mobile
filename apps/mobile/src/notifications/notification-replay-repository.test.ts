import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  markNotificationEventHandled,
  wasNotificationEventHandled,
} from "./notification-replay-repository";

test("checks and records an encrypted notification event replay key", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));
  const db = {
    getFirstAsync: jest.fn(async () => ({ handled: 1 })),
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: SQLiteDatabase) => Promise<void>) =>
      task(db as unknown as SQLiteDatabase),
  } as unknown as SQLiteDatabase;

  await expect(wasNotificationEventHandled(db, "binding-1", "evt_1")).resolves.toBe(true);
  await markNotificationEventHandled(db, "binding-1", "evt_1", 40 * 24 * 60 * 60_000);

  expect(runAsync.mock.calls[0]).toEqual([
    expect.stringContaining("INSERT OR IGNORE INTO handled_notification_events"),
    "binding-1",
    "evt_1",
    40 * 24 * 60 * 60_000,
  ]);
  expect(runAsync.mock.calls[1]?.[0]).toContain("DELETE FROM handled_notification_events");
});
