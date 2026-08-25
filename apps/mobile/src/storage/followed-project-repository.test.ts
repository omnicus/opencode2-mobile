import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  hasFollowedProjectPreference,
  readFollowedProjectIds,
  replaceFollowedProjectIds,
} from "./followed-project-repository";

test("reads followed projects in user order", async () => {
  const getAllAsync = jest.fn(async () => [
    { project_id: "project-b" },
    { project_id: "project-a" },
  ]);
  const db = { getAllAsync } as unknown as SQLiteDatabase;

  await expect(readFollowedProjectIds(db, "connection-1")).resolves.toEqual([
    "project-b",
    "project-a",
  ]);
  expect(getAllAsync).toHaveBeenCalledWith(
    expect.stringContaining("ORDER BY position ASC"),
    "connection-1",
  );
});

test("distinguishes an empty saved set from first use", async () => {
  const getFirstAsync = jest
    .fn<() => Promise<{ connection_id: string } | undefined>>()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ connection_id: "connection-1" });
  const db = { getFirstAsync } as unknown as SQLiteDatabase;

  await expect(hasFollowedProjectPreference(db, "connection-1")).resolves.toBe(false);
  await expect(hasFollowedProjectPreference(db, "connection-1")).resolves.toBe(true);
});

test("replaces followed projects atomically without copying project records", async () => {
  const runAsync = jest.fn(async () => ({ changes: 1, lastInsertRowId: 0 }));
  const db = {
    withExclusiveTransactionAsync: jest.fn(async (task: (transaction: unknown) => Promise<void>) =>
      task({ runAsync }),
    ),
  } as unknown as SQLiteDatabase;

  await replaceFollowedProjectIds(db, "connection-1", ["project-b", "project-a"]);

  expect(runAsync).toHaveBeenNthCalledWith(
    1,
    "INSERT OR IGNORE INTO followed_project_preferences(connection_id) VALUES (?)",
    "connection-1",
  );
  expect(runAsync).toHaveBeenNthCalledWith(
    2,
    "DELETE FROM followed_projects WHERE connection_id = ?",
    "connection-1",
  );
  expect(runAsync).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining("INSERT INTO followed_projects"),
    "connection-1",
    "project-b",
    0,
  );
  expect(runAsync).toHaveBeenNthCalledWith(
    4,
    expect.stringContaining("INSERT INTO followed_projects"),
    "connection-1",
    "project-a",
    1,
  );
});

test("rejects duplicate and malformed project IDs", async () => {
  const db = { withExclusiveTransactionAsync: jest.fn() } as unknown as SQLiteDatabase;

  await expect(
    replaceFollowedProjectIds(db, "connection-1", ["project-a", "project-a"]),
  ).rejects.toThrow("DUPLICATE_FOLLOWED_PROJECT");
  await expect(replaceFollowedProjectIds(db, "connection-1", [""])).rejects.toThrow(
    "PROJECT_ID_REQUIRED",
  );
  expect(db.withExclusiveTransactionAsync).not.toHaveBeenCalled();
});

test("does not write IDs after the connection profile changes server", async () => {
  const runAsync = jest.fn();
  const transaction = {
    getFirstAsync: jest.fn(async () => ({ updated_at_ms: 2 })),
    runAsync,
  };
  const db = {
    withExclusiveTransactionAsync: jest.fn(
      async (task: (value: typeof transaction) => Promise<void>) => task(transaction),
    ),
  } as unknown as SQLiteDatabase;

  await expect(replaceFollowedProjectIds(db, "connection-1", ["project-a"], 1)).rejects.toThrow(
    "CONNECTION_PROFILE_CHANGED",
  );
  expect(runAsync).not.toHaveBeenCalled();
});
