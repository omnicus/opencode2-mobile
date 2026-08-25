import type { SQLiteDatabase } from "expo-sqlite";

const maximumFollowedProjects = 1_000;

export async function readFollowedProjectIds(db: SQLiteDatabase, connectionId: string) {
  assertIdentifier(connectionId, "CONNECTION_ID_REQUIRED");
  const rows = await db.getAllAsync<{ project_id: string }>(
    `SELECT project_id FROM followed_projects
     WHERE connection_id = ? ORDER BY position ASC`,
    connectionId,
  );
  if (!rows.every((row) => typeof row.project_id === "string" && row.project_id.length > 0)) {
    throw new Error("INVALID_FOLLOWED_PROJECTS");
  }
  return rows.map((row) => row.project_id);
}

export async function hasFollowedProjectPreference(db: SQLiteDatabase, connectionId: string) {
  assertIdentifier(connectionId, "CONNECTION_ID_REQUIRED");
  return Boolean(
    await db.getFirstAsync<{ connection_id: string }>(
      "SELECT connection_id FROM followed_project_preferences WHERE connection_id = ?",
      connectionId,
    ),
  );
}

export async function replaceFollowedProjectIds(
  db: SQLiteDatabase,
  connectionId: string,
  projectIds: readonly string[],
  expectedConnectionUpdatedAtMs?: number,
) {
  assertIdentifier(connectionId, "CONNECTION_ID_REQUIRED");
  if (projectIds.length > maximumFollowedProjects) throw new Error("TOO_MANY_FOLLOWED_PROJECTS");
  const unique = [...new Set(projectIds)];
  if (unique.length !== projectIds.length) throw new Error("DUPLICATE_FOLLOWED_PROJECT");
  for (const projectId of unique) assertIdentifier(projectId, "PROJECT_ID_REQUIRED");

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
      "INSERT OR IGNORE INTO followed_project_preferences(connection_id) VALUES (?)",
      connectionId,
    );
    await transaction.runAsync(
      "DELETE FROM followed_projects WHERE connection_id = ?",
      connectionId,
    );
    for (const [position, projectId] of unique.entries()) {
      await transaction.runAsync(
        `INSERT INTO followed_projects(connection_id, project_id, position)
         VALUES (?, ?, ?)`,
        connectionId,
        projectId,
        position,
      );
    }
  });
}

function assertIdentifier(value: string, error: string) {
  if (!value.trim() || value.includes("\u0000")) throw new Error(error);
}
