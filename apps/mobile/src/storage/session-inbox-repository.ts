import type { SQLiteDatabase } from "expo-sqlite";

// The inbox sections whose headers collapse and expand them.
export type CollapsibleInboxSection = "archived" | "working";

// Device-owned inbox state: when this device started its inbox, and whether the Working and
// Archived sections are open. Archive and read state live on the server instead.
export type SessionInboxPreferences = {
  archivedExpanded: boolean;
  sinceMs: number;
  workingExpanded: boolean;
};

type StoredPreferences = { archived_expanded: number; since_ms: number; working_expanded: number };

const expandedColumns = {
  archived: "archived_expanded",
  working: "working_expanded",
} as const satisfies Record<CollapsibleInboxSection, string>;

// Recent lists only sessions that finished a run after `sinceMs`, as on OpenCode desktop. The
// first read starts the inbox at `nowMs`, so it starts empty and fills as sessions finish.
export async function startSessionInbox(
  db: SQLiteDatabase,
  connectionID: string,
  updatedAt: number,
  nowMs: number,
): Promise<SessionInboxPreferences> {
  assertConnectionID(connectionID);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("INVALID_SESSION_INBOX_START");
  let row: StoredPreferences | null = null;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await assertProfileUnchanged(transaction, connectionID, updatedAt);
    await transaction.runAsync(
      `INSERT INTO session_inbox_preferences(connection_id, since_ms) VALUES (?, ?)
       ON CONFLICT(connection_id) DO NOTHING`,
      connectionID,
      nowMs,
    );
    row = await transaction.getFirstAsync<StoredPreferences>(
      `SELECT since_ms, working_expanded, archived_expanded
       FROM session_inbox_preferences WHERE connection_id = ?`,
      connectionID,
    );
  });
  const stored = row as StoredPreferences | null;
  if (!stored || !Number.isSafeInteger(stored.since_ms)) {
    throw new Error("SESSION_INBOX_NOT_STARTED");
  }
  return {
    archivedExpanded: stored.archived_expanded !== 0,
    sinceMs: stored.since_ms,
    workingExpanded: stored.working_expanded !== 0,
  };
}

export async function writeInboxSectionExpanded(
  db: SQLiteDatabase,
  connectionID: string,
  updatedAt: number,
  section: CollapsibleInboxSection,
  expanded: boolean,
) {
  assertConnectionID(connectionID);
  // The column comes from this fixed map, never from the caller's string.
  const column = Object.hasOwn(expandedColumns, section) ? expandedColumns[section] : undefined;
  if (!column) throw new Error("INVALID_SESSION_INBOX_SECTION");
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await assertProfileUnchanged(transaction, connectionID, updatedAt);
    await transaction.runAsync(
      `UPDATE session_inbox_preferences SET ${column} = ? WHERE connection_id = ?`,
      expanded ? 1 : 0,
      connectionID,
    );
  });
}

function assertConnectionID(connectionID: string) {
  if (!connectionID.trim() || connectionID.includes("\u0000")) {
    throw new Error("INVALID_SESSION_INBOX_CONNECTION");
  }
}

async function assertProfileUnchanged(
  transaction: Pick<SQLiteDatabase, "getFirstAsync">,
  connectionID: string,
  updatedAt: number,
) {
  const profile = await transaction.getFirstAsync<{ updated_at_ms: number }>(
    "SELECT updated_at_ms FROM connection_profiles WHERE id = ?",
    connectionID,
  );
  if (profile?.updated_at_ms !== updatedAt) throw new Error("CONNECTION_PROFILE_CHANGED");
}
