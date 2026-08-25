import { Paths } from "expo-file-system";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import type { ConnectionSnapshot } from "./connection-transport-coordinator";

export type ConnectionCacheMetadata = {
  activeSessionCount: number;
  projectCount: number;
  serverVersion: string;
  syncedAtMs: number;
};

export const connectionCacheDatabaseDirectory = Paths.cache.uri;
export const connectionCacheDatabaseName = "opencode-mobile-cache.db";
export const maxConnectionCacheEntries = 20;

let cacheDatabasePromise: Promise<SQLiteDatabase> | undefined;

type ConnectionCacheMetadataRow = {
  active_session_count: number;
  project_count: number;
  server_version: string;
  synced_at_ms: number;
};

export async function readConnectionCacheMetadata(
  connectionId: string,
  profileUpdatedAtMs: number,
  database?: SQLiteDatabase,
) {
  const db = database ?? (await getConnectionCacheDatabase());
  const row = await db.getFirstAsync<ConnectionCacheMetadataRow>(
    `SELECT synced_at_ms, server_version, project_count, active_session_count
     FROM connection_cache_metadata
     WHERE connection_id = ? AND profile_updated_at_ms = ?`,
    connectionId,
    profileUpdatedAtMs,
  );
  if (!row) return undefined;
  return {
    activeSessionCount: row.active_session_count,
    projectCount: row.project_count,
    serverVersion: row.server_version,
    syncedAtMs: row.synced_at_ms,
  } satisfies ConnectionCacheMetadata;
}

export async function writeConnectionCacheMetadata(
  connectionId: string,
  profileUpdatedAtMs: number,
  snapshot: ConnectionSnapshot,
  database?: SQLiteDatabase,
) {
  const db = database ?? (await getConnectionCacheDatabase());
  const metadata: ConnectionCacheMetadata = {
    activeSessionCount: Object.keys(snapshot.activeSessions).length,
    projectCount: snapshot.projects.length,
    serverVersion: snapshot.health.version.slice(0, 128),
    syncedAtMs: Date.now(),
  };
  await db.runAsync(
    `INSERT INTO connection_cache_metadata (
      connection_id, profile_updated_at_ms, synced_at_ms, server_version,
      project_count, active_session_count
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_id) DO UPDATE SET
      profile_updated_at_ms = excluded.profile_updated_at_ms,
      synced_at_ms = excluded.synced_at_ms,
      server_version = excluded.server_version,
      project_count = excluded.project_count,
      active_session_count = excluded.active_session_count`,
    connectionId,
    profileUpdatedAtMs,
    metadata.syncedAtMs,
    metadata.serverVersion,
    metadata.projectCount,
    metadata.activeSessionCount,
  );
  await db.runAsync(
    `DELETE FROM connection_cache_metadata
     WHERE connection_id NOT IN (
       SELECT connection_id FROM connection_cache_metadata
       ORDER BY synced_at_ms DESC LIMIT ?
     )`,
    maxConnectionCacheEntries,
  );
  return metadata;
}

export async function deleteConnectionCacheMetadata(
  connectionId: string,
  database?: SQLiteDatabase,
) {
  const db = database ?? (await getConnectionCacheDatabase());
  await db.runAsync("DELETE FROM connection_cache_metadata WHERE connection_id = ?", connectionId);
}

export async function migrateConnectionCacheDatabase(db: SQLiteDatabase) {
  const current = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const version = current?.user_version ?? 0;
  if (version > 1) throw new Error("CACHE_DATABASE_VERSION_TOO_NEW");
  if (version === 1) return;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    DROP TABLE IF EXISTS connection_cache_metadata;
    CREATE TABLE IF NOT EXISTS connection_cache_metadata (
      connection_id TEXT PRIMARY KEY NOT NULL,
      profile_updated_at_ms INTEGER NOT NULL,
      synced_at_ms INTEGER NOT NULL,
      server_version TEXT NOT NULL CHECK (length(server_version) <= 128),
      project_count INTEGER NOT NULL CHECK (project_count >= 0),
      active_session_count INTEGER NOT NULL CHECK (active_session_count >= 0)
    );
    PRAGMA user_version = 1;
  `);
}

async function getConnectionCacheDatabase() {
  cacheDatabasePromise ??= openDatabaseAsync(
    connectionCacheDatabaseName,
    {},
    connectionCacheDatabaseDirectory,
  )
    .then(async (db) => {
      await migrateConnectionCacheDatabase(db);
      return db;
    })
    .catch((error: unknown) => {
      cacheDatabasePromise = undefined;
      throw error;
    });
  return cacheDatabasePromise;
}
