import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  defaultPullRequestFilter,
  readPullRequestFilter,
  writePullRequestFilter,
} from "./pull-request-filter-repository";

test("reads the exact connection's filter and falls back to the default", async () => {
  const getFirstAsync = jest
    .fn(async (..._args: unknown[]): Promise<unknown> => null)
    .mockResolvedValueOnce({ project_id: "project-1", status: "draft" })
    .mockResolvedValueOnce({ project_id: null, status: "unknown" });
  const db = { getFirstAsync } as unknown as SQLiteDatabase;
  expect(await readPullRequestFilter(db, "connection-a")).toEqual({
    projectID: "project-1",
    status: "draft",
  });
  expect(getFirstAsync).toHaveBeenCalledWith(
    expect.stringContaining("WHERE connection_id = ?"),
    "connection-a",
  );
  // An unknown stored status reads as All instead of failing the tab.
  expect(await readPullRequestFilter(db, "connection-a")).toEqual({ status: "all" });
  expect(await readPullRequestFilter(db, "connection-b")).toBe(defaultPullRequestFilter);
});

test("upserts with parameters after checking the connection profile", async () => {
  const transaction = {
    getFirstAsync: jest.fn(async () => ({ updated_at_ms: 7 })),
    runAsync: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const db = {
    withExclusiveTransactionAsync: async (fn: (txn: typeof transaction) => Promise<void>) =>
      fn(transaction),
  } as unknown as SQLiteDatabase;
  await writePullRequestFilter(db, "connection-a", 7, {
    projectID: "project-1",
    status: "approved",
  });
  expect(transaction.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining("ON CONFLICT(connection_id) DO UPDATE"),
    "connection-a",
    "approved",
    "project-1",
  );
  await writePullRequestFilter(db, "connection-a", 7, { status: "all" });
  expect(transaction.runAsync).toHaveBeenLastCalledWith(
    expect.any(String),
    "connection-a",
    "all",
    null,
  );
});

test("rejects invalid filters and writes after the profile changed", async () => {
  const runAsync = jest.fn();
  const db = {
    withExclusiveTransactionAsync: async (fn: (txn: unknown) => Promise<void>) =>
      fn({ getFirstAsync: async () => ({ updated_at_ms: 8 }), runAsync }),
  } as unknown as SQLiteDatabase;
  await expect(writePullRequestFilter(db, "connection", 7, { status: "all" })).rejects.toThrow(
    "CONNECTION_PROFILE_CHANGED",
  );
  await expect(
    writePullRequestFilter(db, "connection", 8, { status: "merged" as never }),
  ).rejects.toThrow("INVALID_PULL_REQUEST_FILTER");
  await expect(
    writePullRequestFilter(db, "connection", 8, { projectID: " ", status: "all" }),
  ).rejects.toThrow("INVALID_PULL_REQUEST_FILTER");
  expect(runAsync).not.toHaveBeenCalled();
});
