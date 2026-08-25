import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";

import { migrateMobileDatabase } from "./database";

test("creates the current mobile database schema", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 0 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(9);
  expect(execAsync.mock.calls[1]?.[0]).toContain("CREATE TABLE IF NOT EXISTS connection_profiles");
  expect(execAsync.mock.calls[2]?.[0]).toContain("CREATE TABLE IF NOT EXISTS app_preferences");
  expect(execAsync.mock.calls[3]?.[0]).toContain("CREATE TABLE IF NOT EXISTS session_drafts");
  expect(execAsync.mock.calls[3]?.[0]).toContain("pending_draft_key_deletions");
  expect(execAsync.mock.calls[3]?.[0]).toContain("PRAGMA user_version = 3");
  expect(execAsync.mock.calls[4]?.[0]).toContain("unresolved_prompt_admissions");
  expect(execAsync.mock.calls[4]?.[0]).toContain("ADD COLUMN revision");
  expect(execAsync.mock.calls[4]?.[0]).toContain("BEGIN IMMEDIATE");
  expect(execAsync.mock.calls[4]?.[0]).toContain("COMMIT");
  expect(execAsync.mock.calls[4]?.[0]).toContain("PRAGMA user_version = 4");
  expect(execAsync.mock.calls[5]?.[0]).toContain("CREATE TABLE IF NOT EXISTS followed_projects");
  expect(execAsync.mock.calls[5]?.[0]).toContain("PRAGMA user_version = 5");
  expect(execAsync.mock.calls[6]?.[0]).toContain("notification_pairings");
  expect(execAsync.mock.calls[6]?.[0]).toContain("PRAGMA user_version = 6");
  expect(execAsync.mock.calls[7]?.[0]).toContain("handled_notification_events");
  expect(execAsync.mock.calls[7]?.[0]).toContain("PRAGMA user_version = 7");
  expect(execAsync.mock.calls[8]?.[0]).toContain("pending_notification_revocations");
  expect(execAsync.mock.calls[8]?.[0]).toContain("PRAGMA user_version = 8");
});

test("migrates an existing profile database to app-lock preferences", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 1 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(8);
  expect(execAsync.mock.calls[1]?.[0]).toContain("CREATE TABLE IF NOT EXISTS app_preferences");
  expect(execAsync.mock.calls[1]?.[0]).not.toContain("connection_profiles");
  expect(execAsync.mock.calls[2]?.[0]).toContain("CREATE TABLE IF NOT EXISTS session_drafts");
  expect(execAsync.mock.calls[3]?.[0]).toContain("unresolved_prompt_admissions");
  expect(execAsync.mock.calls[3]?.[0]).toContain("ADD COLUMN revision");
  expect(execAsync.mock.calls[4]?.[0]).toContain("followed_projects");
  expect(execAsync.mock.calls[5]?.[0]).toContain("notification_pairings");
});

test("migrates app-lock databases to encrypted draft storage", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 2 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(7);
  expect(execAsync.mock.calls[1]?.[0]).toContain("ciphertext BLOB NOT NULL");
  expect(execAsync.mock.calls[1]?.[0]).toContain("ON DELETE CASCADE");
  expect(execAsync.mock.calls[1]?.[0]).not.toContain("app_preferences");
  expect(execAsync.mock.calls[2]?.[0]).toContain("unresolved_prompt_admissions");
  expect(execAsync.mock.calls[2]?.[0]).toContain("ADD COLUMN revision");
  expect(execAsync.mock.calls[3]?.[0]).toContain("followed_projects");
  expect(execAsync.mock.calls[4]?.[0]).toContain("notification_pairings");
});

test("migrates encrypted draft databases to unresolved admission storage", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 3 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(6);
  expect(execAsync.mock.calls[1]?.[0]).toContain("status IN ('submitting', 'unknown-delivery')");
  expect(execAsync.mock.calls[1]?.[0]).toContain("ADD COLUMN revision");
  expect(execAsync.mock.calls[2]?.[0]).toContain("followed_projects");
  expect(execAsync.mock.calls[3]?.[0]).toContain("notification_pairings");
});

test("migrates admission databases to followed project preferences", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 4 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(5);
  expect(execAsync.mock.calls[1]?.[0]).toContain("followed_project_preferences");
  expect(execAsync.mock.calls[1]?.[0]).toContain("PRIMARY KEY (connection_id, project_id)");
  expect(execAsync.mock.calls[1]?.[0]).toContain("UNIQUE (connection_id, position)");
  expect(execAsync.mock.calls[2]?.[0]).toContain("notification_pairings");
});

test("migrates followed project databases to notification pairing storage", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 5 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(4);
  expect(execAsync.mock.calls[1]?.[0]).toContain("pending_notification_secret_deletions");
  expect(execAsync.mock.calls[1]?.[0]).toContain("BEGIN IMMEDIATE");
  expect(execAsync.mock.calls[1]?.[0]).toContain("COMMIT");
  expect(execAsync.mock.calls[2]?.[0]).toContain("handled_notification_events");
});

test("migrates notification pairings to handled event replay storage", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 6 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(3);
  expect(execAsync.mock.calls[1]?.[0]).toContain("handled_notification_events");
  expect(execAsync.mock.calls[1]?.[0]).toContain("ON DELETE CASCADE");
  expect(execAsync.mock.calls[1]?.[0]).toContain("COMMIT");
  expect(execAsync.mock.calls[2]?.[0]).toContain("pending_notification_revocations");
});

test("migrates handled events to pending notification revocation storage", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 7 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(2);
  expect(execAsync.mock.calls[1]?.[0]).toContain("pending_notification_revocations");
  expect(execAsync.mock.calls[1]?.[0]).toContain("PRAGMA user_version = 8");
  expect(execAsync.mock.calls[1]?.[0]).toContain("COMMIT");
});

test("rejects a database created by a newer app", async () => {
  const db = {
    execAsync: jest.fn(async () => undefined),
    getFirstAsync: jest.fn(async () => ({ user_version: 9 })),
  } as unknown as SQLiteDatabase;

  await expect(migrateMobileDatabase(db)).rejects.toThrow("DATABASE_VERSION_TOO_NEW");
});

test("rolls back an interrupted revision and admission migration", async () => {
  const execAsync = jest
    .fn<(source: string) => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("interrupted"))
    .mockResolvedValueOnce(undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 3 })),
  } as unknown as SQLiteDatabase;

  await expect(migrateMobileDatabase(db)).rejects.toThrow("interrupted");

  expect(execAsync).toHaveBeenLastCalledWith("ROLLBACK;");
});
