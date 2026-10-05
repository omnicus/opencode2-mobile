import type { SQLiteDatabase } from "expo-sqlite";

export async function readArchivedSessionIds(db: SQLiteDatabase, connectionId: string) {
  return (await readSessionArchivePreferences(db, connectionId)).ids;
}

export async function readSessionArchivePreferences(db: SQLiteDatabase, connectionId: string) {
  assertIdentifier(connectionId);
  const rows = await db.getAllAsync<{ session_id: string; restored_at_ms?: number | null }>(
    "SELECT session_id, restored_at_ms FROM session_archives WHERE connection_id = ? ORDER BY session_id",
    connectionId,
  );
  for (const row of rows) {
    assertIdentifier(row.session_id);
    if (
      row.restored_at_ms != null &&
      (!Number.isFinite(row.restored_at_ms) || row.restored_at_ms < 0)
    )
      throw new Error("INVALID_ARCHIVE_PREFERENCE");
  }
  return {
    ids: rows.filter((row) => row.restored_at_ms == null).map((row) => row.session_id),
    restoredAt: Object.fromEntries(
      rows.flatMap((row) =>
        row.restored_at_ms == null ? [] : [[row.session_id, row.restored_at_ms]],
      ),
    ),
  };
}

export async function setSessionArchived(
  db: SQLiteDatabase,
  connectionId: string,
  sessionId: string,
  archived: boolean,
  expectedConnectionUpdatedAtMs?: number,
) {
  assertIdentifier(connectionId);
  assertIdentifier(sessionId);
  await db.withExclusiveTransactionAsync(async (transaction) => {
    if (expectedConnectionUpdatedAtMs !== undefined) {
      const profile = await transaction.getFirstAsync<{ updated_at_ms: number }>(
        "SELECT updated_at_ms FROM connection_profiles WHERE id = ?",
        connectionId,
      );
      if (profile?.updated_at_ms !== expectedConnectionUpdatedAtMs) {
        throw new Error("CONNECTION_PROFILE_CHANGED");
      }
    }
    await transaction.runAsync(
      `INSERT INTO session_archives(connection_id, session_id, restored_at_ms) VALUES (?, ?, ?)
         ON CONFLICT(connection_id, session_id) DO UPDATE SET restored_at_ms = excluded.restored_at_ms`,
      connectionId,
      sessionId,
      archived ? null : Date.now(),
    );
  });
}

function assertIdentifier(value: string) {
  if (typeof value !== "string" || !value.trim() || value.includes("\u0000")) {
    throw new Error("INVALID_ARCHIVE_IDENTIFIER");
  }
}
