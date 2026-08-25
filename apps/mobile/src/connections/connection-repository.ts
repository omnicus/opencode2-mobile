import { normalizeOpenCodeBaseUrl } from "@opencode2-mobile/opencode-adapter";
import * as Crypto from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  finishNotificationSecretDeletion,
  stageNotificationPairingRemoval,
} from "../notifications/notification-pairing-repository";
import {
  finishConnectionDraftDeletion,
  stageConnectionDraftDeletion,
} from "../storage/draft-repository";
import {
  type ConnectionCredential,
  type ConnectionHealth,
  type ConnectionProfileDraft,
  type ConnectionProfileRow,
  connectionProfileSchemaVersion,
  decodeConnectionProfile,
  normalizeConnectionName,
} from "./connection-profile";
import {
  createCredentialReference,
  deleteConnectionCredential,
  writeConnectionCredential,
} from "./credential-store";

export type SaveConnectionProfileInput = {
  credential?: ConnectionCredential;
  draft: ConnectionProfileDraft;
  health: ConnectionHealth;
};

export async function listConnectionProfiles(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<ConnectionProfileRow>(`
    SELECT * FROM connection_profiles
    ORDER BY COALESCE(last_used_at_ms, 0) DESC, name COLLATE NOCASE ASC
  `);
  return rows.map(decodeConnectionProfile);
}

export async function getSelectedConnectionId(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ selected_connection_id: string | null }>(
    "SELECT selected_connection_id FROM connection_selection WHERE singleton = 1",
  );
  return row?.selected_connection_id ?? undefined;
}

export async function selectConnectionProfile(db: SQLiteDatabase, profileId: string) {
  const now = Date.now();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const profile = await txn.getFirstAsync<{ id: string }>(
      "SELECT id FROM connection_profiles WHERE id = ?",
      profileId,
    );
    if (!profile) throw new Error("CONNECTION_PROFILE_NOT_FOUND");
    await txn.runAsync(
      "UPDATE connection_selection SET selected_connection_id = ? WHERE singleton = 1",
      profileId,
    );
    await txn.runAsync(
      "UPDATE connection_profiles SET last_used_at_ms = ? WHERE id = ?",
      now,
      profileId,
    );
  });
}

export async function saveConnectionProfile(db: SQLiteDatabase, input: SaveConnectionProfileInput) {
  const name = normalizeConnectionName(input.draft.name);
  const baseUrl = normalizeOpenCodeBaseUrl(input.draft.baseUrl);
  if (baseUrl.startsWith("http:") && !input.draft.allowDevelopmentHttp) {
    throw new Error("DEVELOPMENT_HTTP_NOT_APPROVED");
  }
  if (input.draft.authMode === "none" && input.credential) {
    throw new Error("UNEXPECTED_CONNECTION_CREDENTIAL");
  }
  if (input.draft.authMode !== "none" && input.credential?.mode !== input.draft.authMode) {
    throw new Error("CONNECTION_CREDENTIAL_REQUIRED");
  }

  const id = input.draft.id ?? Crypto.randomUUID();
  const existing = input.draft.id
    ? await db.getFirstAsync<
        Pick<
          ConnectionProfileRow,
          "base_url" | "created_at_ms" | "credential_ref" | "updated_at_ms"
        >
      >(
        `SELECT base_url, created_at_ms, credential_ref, updated_at_ms
         FROM connection_profiles WHERE id = ?`,
        id,
      )
    : null;
  if (input.draft.id && !existing) throw new Error("CONNECTION_PROFILE_NOT_FOUND");

  const now = Math.max(Date.now(), (existing?.updated_at_ms ?? -1) + 1);
  const credentialRef = input.credential ? createCredentialReference() : undefined;
  let notificationSecretRef: string | undefined;
  if (credentialRef && input.credential) {
    await db.runAsync(
      "INSERT INTO pending_secure_store_writes(credential_ref) VALUES (?)",
      credentialRef,
    );
    try {
      await writeConnectionCredential(credentialRef, input.credential);
    } catch (error) {
      await cleanupFailedCredentialWrite(db, credentialRef);
      throw error;
    }
  }

  try {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(
        `INSERT INTO connection_profiles (
          id, schema_version, name, base_url, auth_mode, credential_ref,
          allow_development_http, last_health_at_ms, last_health_pid,
          last_server_version, last_used_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          schema_version = excluded.schema_version,
          name = excluded.name,
          base_url = excluded.base_url,
          auth_mode = excluded.auth_mode,
          credential_ref = excluded.credential_ref,
          allow_development_http = excluded.allow_development_http,
          last_health_at_ms = excluded.last_health_at_ms,
          last_health_pid = excluded.last_health_pid,
          last_server_version = excluded.last_server_version,
          last_used_at_ms = excluded.last_used_at_ms,
          updated_at_ms = excluded.updated_at_ms`,
        id,
        connectionProfileSchemaVersion,
        name,
        baseUrl,
        input.draft.authMode,
        credentialRef ?? null,
        input.draft.allowDevelopmentHttp ? 1 : 0,
        input.health.checkedAtMs,
        input.health.pid,
        input.health.version,
        now,
        existing?.created_at_ms ?? now,
        now,
      );
      await txn.runAsync(
        "UPDATE connection_selection SET selected_connection_id = ? WHERE singleton = 1",
        id,
      );
      if (credentialRef) {
        await txn.runAsync(
          "DELETE FROM pending_secure_store_writes WHERE credential_ref = ?",
          credentialRef,
        );
      }
      if (existing?.credential_ref && existing.credential_ref !== credentialRef) {
        await txn.runAsync(
          "INSERT OR IGNORE INTO pending_secure_store_deletions(credential_ref) VALUES (?)",
          existing.credential_ref,
        );
      }
      if (existing && existing.base_url !== baseUrl) {
        notificationSecretRef = await stageNotificationPairingRemoval(txn, id);
        await txn.runAsync("DELETE FROM session_drafts WHERE connection_id = ?", id);
        await txn.runAsync("DELETE FROM unresolved_prompt_admissions WHERE connection_id = ?", id);
        await txn.runAsync("DELETE FROM followed_projects WHERE connection_id = ?", id);
        await txn.runAsync("DELETE FROM followed_project_preferences WHERE connection_id = ?", id);
      }
    });
  } catch (error) {
    if (credentialRef) await cleanupFailedCredentialWrite(db, credentialRef);
    throw error;
  }

  if (existing?.credential_ref && existing.credential_ref !== credentialRef) {
    await finishCredentialDeletion(db, existing.credential_ref).catch(() => undefined);
  }
  if (notificationSecretRef) {
    await finishNotificationSecretDeletion(db, notificationSecretRef).catch(() => undefined);
  }
  return id;
}

export async function removeConnectionProfile(db: SQLiteDatabase, profileId: string) {
  let credentialRef: string | undefined;
  let notificationSecretRef: string | undefined;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const profile = await txn.getFirstAsync<{ credential_ref: string | null }>(
      "SELECT credential_ref FROM connection_profiles WHERE id = ?",
      profileId,
    );
    if (!profile) throw new Error("CONNECTION_PROFILE_NOT_FOUND");
    credentialRef = profile.credential_ref ?? undefined;
    if (credentialRef) {
      await txn.runAsync(
        "INSERT OR IGNORE INTO pending_secure_store_deletions(credential_ref) VALUES (?)",
        credentialRef,
      );
    }
    notificationSecretRef = await stageNotificationPairingRemoval(txn, profileId);
    await stageConnectionDraftDeletion(txn, profileId);
    await txn.runAsync("DELETE FROM connection_profiles WHERE id = ?", profileId);
  });

  if (credentialRef) await finishCredentialDeletion(db, credentialRef).catch(() => undefined);
  if (notificationSecretRef) {
    await finishNotificationSecretDeletion(db, notificationSecretRef).catch(() => undefined);
  }
  await finishConnectionDraftDeletion(db, profileId).catch(() => undefined);
}

async function cleanupFailedCredentialWrite(db: SQLiteDatabase, credentialRef: string) {
  await deleteConnectionCredential(credentialRef).catch(() => undefined);
  await db
    .runAsync("DELETE FROM pending_secure_store_writes WHERE credential_ref = ?", credentialRef)
    .catch(() => undefined);
}

async function finishCredentialDeletion(db: SQLiteDatabase, credentialRef: string) {
  await deleteConnectionCredential(credentialRef);
  await db.runAsync(
    "DELETE FROM pending_secure_store_deletions WHERE credential_ref = ?",
    credentialRef,
  );
}
