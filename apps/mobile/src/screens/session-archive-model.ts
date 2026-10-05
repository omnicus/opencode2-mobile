import type { SessionInfo } from "@opencode2-mobile/opencode-adapter";
import type { FollowedInboxSections } from "../state/followed-project-inbox";

export const sessionAutoArchiveAgeMs = 30 * 24 * 60 * 60 * 1_000;

export function resolveSessionArchiveIds(
  inbox: FollowedInboxSections,
  manualIds: readonly string[],
  restoredAt: Readonly<Record<string, number>>,
  now: number,
) {
  const archived = new Set(manualIds);
  for (const row of [...inbox.needsYou, ...inbox.working, ...inbox.recent]) {
    if (row.active || row.activeChildCount > 0 || row.attentionCount > 0 || row.session.parentID)
      continue;
    const lastActivity = Math.max(row.session.time.updated, restoredAt[row.session.id] ?? 0);
    if (
      Number.isFinite(lastActivity) &&
      lastActivity > 0 &&
      lastActivity < now - sessionAutoArchiveAgeMs
    )
      archived.add(row.session.id);
  }
  return [...archived];
}

export function selectSessionArchiveView(
  inbox: FollowedInboxSections,
  archivedIds: readonly string[],
  archivedView: boolean,
  restoredAt: Readonly<Record<string, number>> = {},
) {
  const archived = new Set(archivedIds);
  const visible = (row: FollowedInboxSections["recent"][number]) =>
    archivedView
      ? archived.has(row.session.id)
      : !archived.has(row.session.id) || row.active || row.attentionCount > 0;
  return {
    ...inbox,
    needsYou: inbox.needsYou.filter(visible),
    working: inbox.working.filter(visible),
    recent: inbox.recent
      .filter(visible)
      .sort(
        (a, b) =>
          Math.max(b.session.time.updated, restoredAt[b.session.id] ?? 0) -
          Math.max(a.session.time.updated, restoredAt[a.session.id] ?? 0),
      ),
  };
}

export function addArchivedSessions(
  inbox: FollowedInboxSections,
  sessions: readonly SessionInfo[],
  projectLabels: Map<string, string>,
  search: string,
): FollowedInboxSections {
  const known = new Set(
    [...inbox.needsYou, ...inbox.working, ...inbox.recent].map((row) => row.session.id),
  );
  const extra = sessions
    .filter(
      (session) =>
        !known.has(session.id) &&
        !session.parentID &&
        projectLabels.has(session.projectID) &&
        (!search || (session.title ?? "").toLocaleLowerCase().includes(search.toLocaleLowerCase())),
    )
    .map((session) => ({
      active: false,
      activeChildCount: 0,
      attentionCount: 0,
      children: [],
      projectLabel: projectLabels.get(session.projectID) ?? "Project",
      section: "recent" as const,
      session,
      targetLocation: session.location,
      targetSessionID: session.id,
    }));
  return {
    ...inbox,
    recent: [...inbox.recent, ...extra].sort(
      (a, b) => b.session.time.updated - a.session.time.updated,
    ),
  };
}
