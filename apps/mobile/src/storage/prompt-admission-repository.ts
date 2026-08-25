import type { SQLiteDatabase } from "expo-sqlite";

export type PersistedPromptAdmission = {
  delivery?: "queue" | "steer";
  draftRevision: number;
  durable: false;
  id: string;
  status: "submitting" | "unknown-delivery";
  submittedAtMs: number;
};

type PromptAdmissionRow = {
  admission_id: string;
  delivery: "queue" | "steer" | null;
  draft_revision: number;
  status: "submitting" | "unknown-delivery";
  submitted_at_ms: number;
};

export async function listUnresolvedPromptAdmissions(
  db: SQLiteDatabase,
  connectionId: string,
  sessionId: string,
): Promise<PersistedPromptAdmission[]> {
  const rows = await db.getAllAsync<PromptAdmissionRow>(
    `SELECT admission_id, delivery, draft_revision, status, submitted_at_ms
     FROM unresolved_prompt_admissions
     WHERE connection_id = ? AND session_id = ?
     ORDER BY submitted_at_ms ASC
     LIMIT 20`,
    connectionId,
    sessionId,
  );
  return rows.map((row) => ({
    ...(row.delivery ? { delivery: row.delivery } : {}),
    draftRevision: row.draft_revision,
    durable: false,
    id: row.admission_id,
    status: "unknown-delivery",
    submittedAtMs: row.submitted_at_ms,
  }));
}

export async function writeUnresolvedPromptAdmission(
  db: SQLiteDatabase,
  connectionId: string,
  sessionId: string,
  admission: PersistedPromptAdmission,
) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO unresolved_prompt_admissions (
        connection_id, session_id, admission_id, schema_version, status,
        delivery, draft_revision, submitted_at_ms
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(connection_id, session_id, admission_id) DO UPDATE SET
        status = excluded.status,
        delivery = excluded.delivery,
        draft_revision = excluded.draft_revision,
        submitted_at_ms = excluded.submitted_at_ms`,
      connectionId,
      sessionId,
      admission.id,
      admission.status,
      admission.delivery ?? null,
      admission.draftRevision,
      admission.submittedAtMs,
    );
    await txn.runAsync(
      `DELETE FROM unresolved_prompt_admissions
       WHERE connection_id = ? AND session_id = ? AND admission_id NOT IN (
         SELECT admission_id FROM unresolved_prompt_admissions
         WHERE connection_id = ? AND session_id = ?
         ORDER BY submitted_at_ms DESC
         LIMIT 20
       )`,
      connectionId,
      sessionId,
      connectionId,
      sessionId,
    );
  });
}

export async function deleteUnresolvedPromptAdmission(
  db: Pick<SQLiteDatabase, "runAsync">,
  connectionId: string,
  sessionId: string,
  admissionId: string,
) {
  await db.runAsync(
    `DELETE FROM unresolved_prompt_admissions
     WHERE connection_id = ? AND session_id = ? AND admission_id = ?`,
    connectionId,
    sessionId,
    admissionId,
  );
}

export async function deleteSessionLocalState(
  db: SQLiteDatabase,
  connectionId: string,
  sessionIds: string[],
) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const sessionId of sessionIds) {
      await txn.runAsync(
        "DELETE FROM session_drafts WHERE connection_id = ? AND session_id = ?",
        connectionId,
        sessionId,
      );
      await txn.runAsync(
        "DELETE FROM unresolved_prompt_admissions WHERE connection_id = ? AND session_id = ?",
        connectionId,
        sessionId,
      );
    }
  });
}
