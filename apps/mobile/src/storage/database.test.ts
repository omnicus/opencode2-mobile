import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";

import { migrateMobileDatabase } from "./database";

test("version 14 preserves manual archives and adds restoration timestamps", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  await migrateMobileDatabase({
    execAsync,
    getFirstAsync: async () => ({ user_version: 14 }),
  } as unknown as SQLiteDatabase);
  expect(execAsync).toHaveBeenCalledTimes(2);
  const sql = execAsync.mock.calls[1]?.[0];
  expect(sql).toContain("ALTER TABLE session_archives");
  expect(sql).toContain("restored_at_ms INTEGER");
  expect(sql).toContain("PRAGMA user_version = 15");
  expect(sql).toContain("BEGIN IMMEDIATE");
  expect(sql).toContain("COMMIT");
  expect(sql).not.toContain("DELETE");
});

test("restoration migration rolls back on failure", async () => {
  const execAsync = jest
    .fn<(source: string) => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("disk"))
    .mockResolvedValueOnce(undefined);
  await expect(
    migrateMobileDatabase({
      execAsync,
      getFirstAsync: async () => ({ user_version: 14 }),
    } as unknown as SQLiteDatabase),
  ).rejects.toThrow("disk");
  expect(execAsync).toHaveBeenLastCalledWith("ROLLBACK;");
});

test("version 13 adds identity-only device archives scoped to connections", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  await migrateMobileDatabase({
    execAsync,
    getFirstAsync: async () => ({ user_version: 13 }),
  } as unknown as SQLiteDatabase);
  expect(execAsync).toHaveBeenCalledTimes(3);
  const sql = execAsync.mock.calls[1]?.[0];
  expect(sql).toContain("CREATE TABLE session_archives");
  expect(sql).toContain("PRIMARY KEY (connection_id, session_id)");
  expect(sql).toContain("ON DELETE CASCADE");
  expect(sql).toContain("PRAGMA user_version = 14");
  expect(sql).toContain("BEGIN IMMEDIATE");
  expect(sql).toContain("COMMIT");
  expect(sql).not.toContain("title");
  expect(sql).not.toContain("directory");
});

test("rolls back a failed archive migration", async () => {
  const execAsync = jest
    .fn<(source: string) => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("disk"))
    .mockResolvedValueOnce(undefined);
  await expect(
    migrateMobileDatabase({
      execAsync,
      getFirstAsync: async () => ({ user_version: 13 }),
    } as unknown as SQLiteDatabase),
  ).rejects.toThrow("disk");
  expect(execAsync).toHaveBeenLastCalledWith("ROLLBACK;");
});

test("version 12 upgrades default delivery to steer without rewriting existing preferences", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 12 })),
  } as unknown as SQLiteDatabase;
  await migrateMobileDatabase(db);
  expect(execAsync).toHaveBeenCalledTimes(4);
  const migration = execAsync.mock.calls[1]?.[0];
  expect(migration).toContain("ALTER TABLE transcript_preferences");
  expect(migration).toContain("DEFAULT 'steer'");
  expect(migration).toContain("CHECK (default_delivery IN ('steer', 'queue'))");
  expect(migration).toContain("PRAGMA user_version = 13");
  expect(migration).not.toContain("CREATE TABLE");
});

test("delivery preference migration rolls back on failure", async () => {
  const failure = new Error("disk");
  const execAsync = jest
    .fn<(source: string) => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 12 })),
  } as unknown as SQLiteDatabase;
  await expect(migrateMobileDatabase(db)).rejects.toThrow(failure);
  expect(execAsync).toHaveBeenLastCalledWith("ROLLBACK;");
});

test("creates the current mobile database schema", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 0 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(16);
  expect(execAsync.mock.calls[15]?.[0]).toContain("restored_at_ms");
  expect(execAsync.mock.calls[14]?.[0]).toContain("CREATE TABLE session_archives");
  expect(execAsync.mock.calls[13]?.[0]).toContain("DEFAULT 'steer'");
  expect(execAsync.mock.calls[12]?.[0]).toContain("CREATE TABLE model_favorites");
  expect(execAsync.mock.calls[11]?.[0]).toContain("CREATE TABLE transcript_preferences");
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
  expect(execAsync.mock.calls[9]?.[0]).toContain("ADD COLUMN payload_version");
  expect(execAsync.mock.calls[9]?.[0]).toContain("PRAGMA user_version = 9");
  expect(execAsync.mock.calls[10]?.[0]).toContain("ADD COLUMN submission_kind");
  expect(execAsync.mock.calls[10]?.[0]).toContain("PRAGMA user_version = 10");
});

test("migrates an existing profile database to app-lock preferences", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 1 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(15);
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

  expect(execAsync).toHaveBeenCalledTimes(14);
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

  expect(execAsync).toHaveBeenCalledTimes(13);
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

  expect(execAsync).toHaveBeenCalledTimes(12);
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

  expect(execAsync).toHaveBeenCalledTimes(11);
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

  expect(execAsync).toHaveBeenCalledTimes(10);
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

  expect(execAsync).toHaveBeenCalledTimes(9);
  expect(execAsync.mock.calls[1]?.[0]).toContain("pending_notification_revocations");
  expect(execAsync.mock.calls[1]?.[0]).toContain("PRAGMA user_version = 8");
  expect(execAsync.mock.calls[1]?.[0]).toContain("COMMIT");
});

test("migrates legacy encrypted drafts to explicit payload versioning", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 8 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(8);
  expect(execAsync.mock.calls[1]?.[0]).toContain("ADD COLUMN payload_version");
  expect(execAsync.mock.calls[1]?.[0]).toContain("DEFAULT 1");
  expect(execAsync.mock.calls[1]?.[0]).toContain("BEGIN IMMEDIATE");
  expect(execAsync.mock.calls[1]?.[0]).toContain("PRAGMA user_version = 9");
  expect(execAsync.mock.calls[1]?.[0]).toContain("COMMIT");
});

test("migrates admission recovery metadata to distinguish commands", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 9 })),
  } as unknown as SQLiteDatabase;

  await migrateMobileDatabase(db);

  expect(execAsync).toHaveBeenCalledTimes(7);
  expect(execAsync.mock.calls[1]?.[0]).toContain("ADD COLUMN submission_kind");
  expect(execAsync.mock.calls[1]?.[0]).toContain("DEFAULT 'prompt'");
  expect(execAsync.mock.calls[1]?.[0]).toContain("BEGIN IMMEDIATE");
  expect(execAsync.mock.calls[1]?.[0]).toContain("PRAGMA user_version = 10");
  expect(execAsync.mock.calls[1]?.[0]).toContain("COMMIT");
});

test("rejects a database created by a newer app", async () => {
  const db = {
    execAsync: jest.fn(async () => undefined),
    getFirstAsync: jest.fn(async () => ({ user_version: 16 })),
  } as unknown as SQLiteDatabase;

  await expect(migrateMobileDatabase(db)).rejects.toThrow("DATABASE_VERSION_TOO_NEW");
});

test("upgrades version 10 with compact transcript defaults", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  await migrateMobileDatabase({
    execAsync,
    getFirstAsync: async () => ({ user_version: 10 }),
  } as unknown as SQLiteDatabase);
  expect(execAsync).toHaveBeenCalledTimes(6);
  expect(execAsync.mock.calls[1]?.[0]).toContain("CREATE TABLE transcript_preferences");
  expect(execAsync.mock.calls[1]?.[0]).toContain("reasoning INTEGER NOT NULL DEFAULT 0");
  expect(execAsync.mock.calls[1]?.[0]).toContain("PRAGMA user_version = 11");
});

test("upgrades version 11 with identity-only connection-scoped model favorites", async () => {
  const execAsync = jest.fn<(source: string) => Promise<void>>(async () => undefined);
  await migrateMobileDatabase({
    execAsync,
    getFirstAsync: async () => ({ user_version: 11 }),
  } as unknown as SQLiteDatabase);
  expect(execAsync).toHaveBeenCalledTimes(5);
  const sql = execAsync.mock.calls[1]?.[0];
  expect(sql).toContain("PRIMARY KEY (connection_id, provider_id, model_id)");
  expect(sql).toContain("ON DELETE CASCADE");
  expect(sql).toContain("BEGIN IMMEDIATE");
  expect(sql).toContain("PRAGMA user_version = 12");
  expect(sql).toContain("COMMIT");
  expect(sql).not.toContain("ALTER TABLE");
});

test("rolls back failed model favorites migration", async () => {
  const execAsync = jest
    .fn<(source: string) => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("interrupted"))
    .mockResolvedValueOnce(undefined);
  await expect(
    migrateMobileDatabase({
      execAsync,
      getFirstAsync: async () => ({ user_version: 11 }),
    } as unknown as SQLiteDatabase),
  ).rejects.toThrow("interrupted");
  expect(execAsync).toHaveBeenLastCalledWith("ROLLBACK;");
});

test("rolls back failed transcript preference migration", async () => {
  const execAsync = jest
    .fn<(source: string) => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("interrupted"))
    .mockResolvedValueOnce(undefined);
  await expect(
    migrateMobileDatabase({
      execAsync,
      getFirstAsync: async () => ({ user_version: 10 }),
    } as unknown as SQLiteDatabase),
  ).rejects.toThrow("interrupted");
  expect(execAsync).toHaveBeenLastCalledWith("ROLLBACK;");
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
