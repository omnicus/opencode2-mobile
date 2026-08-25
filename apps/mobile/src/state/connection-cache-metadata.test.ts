import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";

jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///Library/Caches/" } },
}));

import {
  connectionCacheDatabaseDirectory,
  deleteConnectionCacheMetadata,
  maxConnectionCacheEntries,
  migrateConnectionCacheDatabase,
  readConnectionCacheMetadata,
  writeConnectionCacheMetadata,
} from "./connection-cache-metadata";

test("persists only bounded non-content snapshot metadata", async () => {
  const runAsync = jest.fn<(sql: string, ...parameters: unknown[]) => Promise<unknown>>(
    async () => undefined,
  );
  const db = { runAsync } as unknown as SQLiteDatabase;

  await writeConnectionCacheMetadata(
    "connection-1",
    5,
    {
      activeSessions: { "session-private-id": { type: "running" } },
      health: { healthy: true, pid: 42, version: "test" },
      projects: [
        {
          canonical: "/private/project",
          id: "project-private-id",
          sandboxes: [],
          time: { created: 1, updated: 1 },
        },
      ],
    },
    db,
  );

  const serializedWrites = JSON.stringify(runAsync.mock.calls);
  expect(serializedWrites).not.toContain("session-private-id");
  expect(serializedWrites).not.toContain("project-private-id");
  expect(serializedWrites).not.toContain("/private/project");
  expect(runAsync.mock.calls[0]?.slice(4)).toEqual(["test", 1, 1]);
  expect(runAsync.mock.calls[1]?.[1]).toBe(maxConnectionCacheEntries);
});

test("reads cached counts without server content", async () => {
  const getFirstAsync = jest.fn(async () => ({
    active_session_count: 2,
    project_count: 3,
    server_version: "test",
    synced_at_ms: 10,
  }));
  const db = {
    getFirstAsync,
  } as unknown as SQLiteDatabase;

  await expect(readConnectionCacheMetadata("connection-1", 5, db)).resolves.toEqual({
    activeSessionCount: 2,
    projectCount: 3,
    serverVersion: "test",
    syncedAtMs: 10,
  });
  expect(getFirstAsync).toHaveBeenCalledWith(expect.any(String), "connection-1", 5);
});

test("stores the cache database outside the backed-up documents directory", async () => {
  expect(connectionCacheDatabaseDirectory).toContain("/Caches/");
  const execAsync = jest.fn<(sql: string) => Promise<void>>(async () => undefined);
  const db = {
    execAsync,
    getFirstAsync: jest.fn(async () => ({ user_version: 0 })),
  } as unknown as SQLiteDatabase;
  await migrateConnectionCacheDatabase(db);

  expect(execAsync.mock.calls[0]?.[0]).toContain("connection_cache_metadata");
  expect(execAsync.mock.calls[0]?.[0]).toContain("profile_updated_at_ms");
  expect(execAsync.mock.calls[0]?.[0]).toContain("length(server_version) <= 128");
});

test("deletes metadata by local connection ID", async () => {
  const runAsync = jest.fn(async () => undefined);
  await deleteConnectionCacheMetadata("connection-1", { runAsync } as unknown as SQLiteDatabase);

  expect(runAsync).toHaveBeenCalledWith(
    "DELETE FROM connection_cache_metadata WHERE connection_id = ?",
    "connection-1",
  );
});
