import type { SQLiteDatabase } from "expo-sqlite";

import {
  deleteConnectionDraftKey,
  getOrCreateConnectionDraftKey,
  readConnectionDraftKey,
} from "../security/draft-key-store";
import { decryptSessionDraft, encryptSessionDraft } from "./draft-crypto";

const draftSchemaVersion = 1;
const draftPayloadVersion = 2;

type SessionDraftRow = {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  payload_version: number;
  revision: number;
  schema_version: number;
  updated_at_ms: number;
};

export type SessionDraft = {
  content: string;
  mentions: SessionDraftMention[];
  revision: number;
  updatedAtMs: number;
};

export type SessionDraftMention =
  | { mention: { end: number; start: number; text: string }; path: string; type: "file" }
  | { mention: { end: number; start: number; text: string }; name: string; type: "agent" }
  | { id: string; mention: { end: number; start: number; text: string }; type: "skill" };

export type WriteSessionDraftInput = {
  connectionId: string;
  content: string;
  mentions?: SessionDraftMention[];
  revision: number;
  sessionId: string;
};

export async function writeSessionDraft(db: SQLiteDatabase, input: WriteSessionDraftInput) {
  const profile = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM connection_profiles WHERE id = ?",
    input.connectionId,
  );
  if (!profile) throw new Error("CONNECTION_PROFILE_NOT_FOUND");

  const key = await getOrCreateConnectionDraftKey(input.connectionId);
  const encrypted = encryptSessionDraft(
    encodeDraftPayload(input.content, input.mentions ?? []),
    key,
    input.connectionId,
    input.sessionId,
  );
  const result = await db.runAsync(
    `INSERT INTO session_drafts (
      connection_id, session_id, schema_version, payload_version, revision, nonce, ciphertext,
      updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_id, session_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      payload_version = excluded.payload_version,
      revision = excluded.revision,
      nonce = excluded.nonce,
      ciphertext = excluded.ciphertext,
      updated_at_ms = excluded.updated_at_ms
    WHERE excluded.revision >= session_drafts.revision`,
    input.connectionId,
    input.sessionId,
    draftSchemaVersion,
    draftPayloadVersion,
    input.revision,
    encrypted.nonce,
    encrypted.ciphertext,
    Date.now(),
  );
  if (result.changes !== 1) throw new Error("STALE_DRAFT_REVISION");
  await db.runAsync(
    `DELETE FROM session_drafts
     WHERE connection_id = ? AND session_id NOT IN (
       SELECT session_id FROM session_drafts
       WHERE connection_id = ?
       ORDER BY updated_at_ms DESC
       LIMIT 100
     )`,
    input.connectionId,
    input.connectionId,
  );
}

export async function readSessionDraft(
  db: SQLiteDatabase,
  connectionId: string,
  sessionId: string,
): Promise<SessionDraft | undefined> {
  const row = await db.getFirstAsync<SessionDraftRow>(
    `SELECT schema_version, payload_version, revision, nonce, ciphertext, updated_at_ms
     FROM session_drafts WHERE connection_id = ? AND session_id = ?`,
    connectionId,
    sessionId,
  );
  if (!row) return undefined;
  if (
    row.schema_version !== draftSchemaVersion ||
    (row.payload_version !== 1 && row.payload_version !== draftPayloadVersion) ||
    !Number.isInteger(row.revision) ||
    row.revision < 0 ||
    !(row.nonce instanceof Uint8Array) ||
    !(row.ciphertext instanceof Uint8Array)
  ) {
    throw new Error("INVALID_STORED_DRAFT");
  }

  const key = await readConnectionDraftKey(connectionId);
  const plaintext = decryptSessionDraft(
    { ciphertext: row.ciphertext, nonce: row.nonce },
    key,
    connectionId,
    sessionId,
  );
  const payload =
    row.payload_version === draftPayloadVersion
      ? decodeDraftPayload(plaintext)
      : { content: plaintext, mentions: [] };
  return {
    content: payload.content,
    mentions: payload.mentions,
    revision: row.revision,
    updatedAtMs: row.updated_at_ms,
  };
}

function encodeDraftPayload(content: string, mentions: SessionDraftMention[]) {
  return JSON.stringify({ content, mentions });
}

function decodeDraftPayload(value: string): { content: string; mentions: SessionDraftMention[] } {
  try {
    const decoded: unknown = JSON.parse(value);
    if (
      !isRecord(decoded) ||
      typeof decoded.content !== "string" ||
      !Array.isArray(decoded.mentions) ||
      !decoded.mentions.every(isDraftMention)
    ) {
      throw new Error("INVALID_STORED_DRAFT");
    }
    return { content: decoded.content, mentions: decoded.mentions };
  } catch (caught) {
    if (caught instanceof Error && caught.message === "INVALID_STORED_DRAFT") throw caught;
    throw new Error("INVALID_STORED_DRAFT");
  }
}

function isDraftMention(value: unknown): value is SessionDraftMention {
  if (!isRecord(value) || !isRecord(value.mention)) return false;
  const start = value.mention.start;
  const end = value.mention.end;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    typeof value.mention.text !== "string"
  ) {
    return false;
  }
  if (value.type === "file") return typeof value.path === "string" && Boolean(value.path);
  if (value.type === "agent") return typeof value.name === "string" && Boolean(value.name);
  if (value.type === "skill") return typeof value.id === "string" && Boolean(value.id);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function deleteSessionDraft(
  db: SQLiteDatabase,
  connectionId: string,
  sessionId: string,
) {
  await db.runAsync(
    "DELETE FROM session_drafts WHERE connection_id = ? AND session_id = ?",
    connectionId,
    sessionId,
  );
}

export async function stageConnectionDraftDeletion(
  db: Pick<SQLiteDatabase, "runAsync">,
  connectionId: string,
) {
  await db.runAsync(
    "INSERT OR IGNORE INTO pending_draft_key_deletions(connection_id) VALUES (?)",
    connectionId,
  );
}

export async function finishConnectionDraftDeletion(db: SQLiteDatabase, connectionId: string) {
  await deleteConnectionDraftKey(connectionId);
  await db.runAsync(
    "DELETE FROM pending_draft_key_deletions WHERE connection_id = ?",
    connectionId,
  );
}

export async function cleanupPendingDraftKeyDeletions(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ connection_id: string }>(
    "SELECT connection_id FROM pending_draft_key_deletions",
  );
  for (const row of rows) {
    await finishConnectionDraftDeletion(db, row.connection_id).catch(() => undefined);
  }
}
