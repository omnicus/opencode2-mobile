import type { SQLiteDatabase } from "expo-sqlite";

export const pullRequestStatusFilters = [
  "all",
  "ready",
  "draft",
  "review-required",
  "approved",
  "changes-requested",
] as const;

export type PullRequestStatusFilter = (typeof pullRequestStatusFilters)[number];

// Device-owned preferences only: a status keyword and a server project ID, never paths or titles.
export type PullRequestFilter = { projectID?: string; status: PullRequestStatusFilter };

export const defaultPullRequestFilter: PullRequestFilter = { status: "all" };

export async function readPullRequestFilter(
  db: SQLiteDatabase,
  connectionID: string,
): Promise<PullRequestFilter> {
  const row = await db.getFirstAsync<{ project_id: string | null; status: string }>(
    "SELECT status, project_id FROM pull_request_filters WHERE connection_id = ?",
    connectionID,
  );
  if (!row) return defaultPullRequestFilter;
  const status = pullRequestStatusFilters.find((value) => value === row.status) ?? "all";
  return { status, ...(row.project_id ? { projectID: row.project_id } : {}) };
}

export async function writePullRequestFilter(
  db: SQLiteDatabase,
  connectionID: string,
  updatedAt: number,
  filter: PullRequestFilter,
) {
  if (
    !connectionID.trim() ||
    connectionID.includes("\u0000") ||
    !pullRequestStatusFilters.includes(filter.status) ||
    (filter.projectID !== undefined &&
      (!filter.projectID.trim() || filter.projectID.includes("\u0000")))
  ) {
    throw new Error("INVALID_PULL_REQUEST_FILTER");
  }
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const profile = await transaction.getFirstAsync<{ updated_at_ms: number }>(
      "SELECT updated_at_ms FROM connection_profiles WHERE id = ?",
      connectionID,
    );
    if (profile?.updated_at_ms !== updatedAt) throw new Error("CONNECTION_PROFILE_CHANGED");
    await transaction.runAsync(
      `INSERT INTO pull_request_filters(connection_id, status, project_id) VALUES (?, ?, ?)
       ON CONFLICT(connection_id) DO UPDATE SET status = excluded.status, project_id = excluded.project_id`,
      connectionID,
      filter.status,
      filter.projectID ?? null,
    );
  });
}
