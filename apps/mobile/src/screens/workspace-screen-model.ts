import type {
  ProjectListOutput,
  SessionInfo,
  SessionsResponse,
} from "@opencode2-mobile/opencode-adapter";
import type { FollowedInboxRow, FollowedInboxSections } from "../state/followed-project-inbox";

type Project = ProjectListOutput[number];

export function formatSessionTime(value: number) {
  const elapsedMs = Date.now() - value;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "Now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  try {
    return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return "Earlier";
  }
}

export function sessionTimeDescription(value: number) {
  const elapsedMs = Date.now() - value;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) return "Updated just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `Updated ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
  try {
    return `Updated ${new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
  } catch {
    return "Updated earlier";
  }
}

export function needsComposerDockMeasurement(
  measuredScreenHeight: number | undefined,
  screenHeight: number,
  keyboardVisible: boolean,
) {
  return !keyboardVisible && measuredScreenHeight !== screenHeight;
}

export function getComposerDockKeyboardOffset(
  dockScreenBottom: number,
  keyboardScreenY: number,
  transparentTopInset = 0,
) {
  return Math.max(0, dockScreenBottom - keyboardScreenY - transparentTopInset);
}

export function flattenSessionPages(pages: SessionsResponse[] | undefined) {
  const seen = new Set<string>();
  const sessions: SessionInfo[] = [];
  for (const page of pages ?? []) {
    for (const session of page.data) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      sessions.push(session);
    }
  }
  return sessions;
}

export function projectDirectories(
  project: Project | undefined,
  defaultProjectId?: string,
  defaultDirectory?: string,
) {
  if (!project) return [];
  return [
    ...new Set([
      project.canonical,
      ...(project.id === defaultProjectId && defaultDirectory ? [defaultDirectory] : []),
      ...project.sandboxes,
    ]),
  ];
}

export type WorkspaceGroup = "finished" | "needs-you" | "working";

export const workspaceGroupLabels: Record<WorkspaceGroup, string> = {
  finished: "Finished",
  "needs-you": "Needs you",
  working: "Working",
};

export type WorkspaceInboxItem =
  | { collapsed: boolean; count: number; group: WorkspaceGroup; key: string; type: "group" }
  | { key: string; row: FollowedInboxRow; type: "session" };

function sessionItem(row: FollowedInboxRow): WorkspaceInboxItem {
  return { key: row.session.id, row, type: "session" };
}

// Every ongoing row, then the newest finished rows up to the limit, each group under its own
// separator. Rows keep the stabilized order from the inbox so they do not jump while sessions
// stream.
export function workspaceInboxItems(
  inbox: FollowedInboxSections,
  limit: number,
  collapsed: ReadonlySet<WorkspaceGroup> = new Set(),
): WorkspaceInboxItem[] {
  const ongoingCount = inbox.needsYou.length + inbox.working.length;
  const finishedIDs = new Set(
    [...inbox.recent]
      .sort((first, second) => second.session.time.updated - first.session.time.updated)
      .slice(0, Math.max(0, limit - ongoingCount))
      .map((row) => row.session.id),
  );
  const groups: [WorkspaceGroup, FollowedInboxRow[]][] = [
    ["needs-you", inbox.needsYou],
    ["working", inbox.working],
    ["finished", inbox.recent.filter((row) => finishedIDs.has(row.session.id))],
  ];
  return groups.flatMap(([group, rows]) => {
    if (rows.length === 0) return [];
    const groupCollapsed = collapsed.has(group);
    return [
      {
        collapsed: groupCollapsed,
        count: rows.length,
        group,
        key: `group:${group}`,
        type: "group" as const,
      },
      ...(groupCollapsed ? [] : rows.map(sessionItem)),
    ];
  });
}

export function searchResultItems(inbox: FollowedInboxSections) {
  return [...inbox.needsYou, ...inbox.working, ...inbox.recent]
    .sort(
      (first, second) =>
        second.session.time.updated - first.session.time.updated ||
        first.session.id.localeCompare(second.session.id),
    )
    .map(sessionItem);
}
