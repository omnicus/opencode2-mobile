import type { SQLiteDatabase } from "expo-sqlite";

export const mobileDatabaseName = "opencode-mobile.db";
export const mobileDatabaseSchemaVersion = 8;

const maxDraftCiphertextBytes = 256 * 1024 + 16;

export async function migrateMobileDatabase(db: SQLiteDatabase) {
  await db.execAsync("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  const current = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const version = current?.user_version ?? 0;
  if (version > mobileDatabaseSchemaVersion) throw new Error("DATABASE_VERSION_TOO_NEW");
  if (version === mobileDatabaseSchemaVersion) return;

  if (version < 1) {
    await db.execAsync(`
    CREATE TABLE IF NOT EXISTS connection_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      auth_mode TEXT NOT NULL CHECK (auth_mode IN ('basic', 'bearer', 'none')),
      credential_ref TEXT UNIQUE,
      allow_development_http INTEGER NOT NULL DEFAULT 0 CHECK (allow_development_http IN (0, 1)),
      last_health_at_ms INTEGER,
      last_health_pid INTEGER,
      last_server_version TEXT,
      last_used_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      CHECK (
        (auth_mode = 'none' AND credential_ref IS NULL) OR
        (auth_mode != 'none' AND credential_ref IS NOT NULL)
      )
    );
    CREATE TABLE IF NOT EXISTS connection_selection (
      singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
      selected_connection_id TEXT REFERENCES connection_profiles(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS pending_secure_store_writes (
      credential_ref TEXT PRIMARY KEY NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pending_secure_store_deletions (
      credential_ref TEXT PRIMARY KEY NOT NULL
    );
    INSERT OR IGNORE INTO connection_selection(singleton, selected_connection_id) VALUES (1, NULL);
    PRAGMA user_version = 1;
  `);
  }

  if (version < 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS app_preferences (
        singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
        app_lock_enabled INTEGER NOT NULL DEFAULT 0 CHECK (app_lock_enabled IN (0, 1))
      );
      INSERT OR IGNORE INTO app_preferences(singleton, app_lock_enabled) VALUES (1, 0);
      PRAGMA user_version = 2;
    `);
  }

  if (version < 3) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS session_drafts (
        connection_id TEXT NOT NULL REFERENCES connection_profiles(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        nonce BLOB NOT NULL CHECK (typeof(nonce) = 'blob' AND length(nonce) = 24),
        ciphertext BLOB NOT NULL CHECK (
          typeof(ciphertext) = 'blob' AND
          length(ciphertext) BETWEEN 16 AND ${maxDraftCiphertextBytes}
        ),
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (connection_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS pending_draft_key_deletions (
        connection_id TEXT PRIMARY KEY NOT NULL
      );
      PRAGMA user_version = 3;
    `);
  }

  if (version < 4) {
    try {
      await db.execAsync(`
        BEGIN IMMEDIATE;
        ALTER TABLE session_drafts
        ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
        CREATE TABLE IF NOT EXISTS unresolved_prompt_admissions (
          connection_id TEXT NOT NULL REFERENCES connection_profiles(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          admission_id TEXT NOT NULL CHECK (admission_id GLOB 'msg_*'),
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          status TEXT NOT NULL CHECK (status IN ('submitting', 'unknown-delivery')),
          delivery TEXT CHECK (delivery IN ('steer', 'queue')),
          draft_revision INTEGER NOT NULL CHECK (draft_revision >= 0),
          submitted_at_ms INTEGER NOT NULL,
          PRIMARY KEY (connection_id, session_id, admission_id)
        );
        PRAGMA user_version = 4;
        COMMIT;
      `);
    } catch (caught) {
      await db.execAsync("ROLLBACK;").catch(() => undefined);
      throw caught;
    }
  }

  if (version < 5) {
    try {
      await db.execAsync(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS followed_project_preferences (
          connection_id TEXT PRIMARY KEY NOT NULL
            REFERENCES connection_profiles(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS followed_projects (
          connection_id TEXT NOT NULL REFERENCES connection_profiles(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL CHECK (length(project_id) > 0),
          position INTEGER NOT NULL CHECK (position >= 0),
          PRIMARY KEY (connection_id, project_id),
          UNIQUE (connection_id, position)
        );
        PRAGMA user_version = 5;
        COMMIT;
      `);
    } catch (caught) {
      await db.execAsync("ROLLBACK;").catch(() => undefined);
      throw caught;
    }
  }

  if (version < 6) {
    try {
      await db.execAsync(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS notification_pairings (
          connection_id TEXT PRIMARY KEY NOT NULL
            REFERENCES connection_profiles(id) ON DELETE CASCADE,
          binding_id TEXT UNIQUE NOT NULL,
          broker_id TEXT NOT NULL,
          broker_origin TEXT NOT NULL,
          secret_ref TEXT UNIQUE NOT NULL,
          created_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_notification_secret_writes (
          secret_ref TEXT PRIMARY KEY NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_notification_secret_deletions (
          secret_ref TEXT PRIMARY KEY NOT NULL
        );
        PRAGMA user_version = 6;
        COMMIT;
      `);
    } catch (caught) {
      await db.execAsync("ROLLBACK;").catch(() => undefined);
      throw caught;
    }
  }

  if (version < 7) {
    try {
      await db.execAsync(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS handled_notification_events (
          binding_id TEXT NOT NULL
            REFERENCES notification_pairings(binding_id) ON DELETE CASCADE,
          event_id TEXT NOT NULL,
          handled_at_ms INTEGER NOT NULL,
          PRIMARY KEY (binding_id, event_id)
        );
        PRAGMA user_version = 7;
        COMMIT;
      `);
    } catch (caught) {
      await db.execAsync("ROLLBACK;").catch(() => undefined);
      throw caught;
    }
  }

  if (version < 8) {
    try {
      await db.execAsync(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS pending_notification_revocations (
          binding_id TEXT PRIMARY KEY NOT NULL,
          broker_origin TEXT NOT NULL,
          secret_ref TEXT UNIQUE NOT NULL,
          created_at_ms INTEGER NOT NULL
        );
        PRAGMA user_version = 8;
        COMMIT;
      `);
    } catch (caught) {
      await db.execAsync("ROLLBACK;").catch(() => undefined);
      throw caught;
    }
  }
}
