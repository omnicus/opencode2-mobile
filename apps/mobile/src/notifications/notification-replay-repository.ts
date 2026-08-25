import type { SQLiteDatabase } from "expo-sqlite";

const replayRetentionMs = 30 * 24 * 60 * 60_000;

export async function wasNotificationEventHandled(
  db: SQLiteDatabase,
  bindingID: string,
  eventID: string,
) {
  const row = await db.getFirstAsync<{ handled: number }>(
    `SELECT 1 AS handled FROM handled_notification_events
     WHERE binding_id = ? AND event_id = ?`,
    bindingID,
    eventID,
  );
  return row?.handled === 1;
}

export async function markNotificationEventHandled(
  db: SQLiteDatabase,
  bindingID: string,
  eventID: string,
  now = Date.now(),
) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT OR IGNORE INTO handled_notification_events(binding_id, event_id, handled_at_ms)
       VALUES (?, ?, ?)`,
      bindingID,
      eventID,
      now,
    );
    await txn.runAsync(
      "DELETE FROM handled_notification_events WHERE handled_at_ms < ?",
      now - replayRetentionMs,
    );
  });
}
