import type {
  ProjectListOutput,
  SessionInfo,
  SessionsResponse,
} from "@opencode2-mobile/opencode-adapter";
import type {
  FollowedInboxRow,
  FollowedInboxSections,
  FollowedInboxStatus,
} from "../state/followed-project-inbox";

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

export type WorkspaceSection = "archived" | "needs-you" | "recent";

export const workspaceSectionLabels: Record<WorkspaceSection | "working", string> = {
  archived: "Archived",
  "needs-you": "Needs attention",
  recent: "Recent",
  working: "Working",
};

export const inboxStatusLabels: Record<Exclude<FollowedInboxStatus, "ready">, string> = {
  approval: "Approval",
  done: "Done",
  failed: "Failed",
  input: "Question",
  working: "Working",
};

export type WorkspaceInboxItem =
  | { count?: number; key: string; section: WorkspaceSection; type: "header" }
  | { key: string; row: FollowedInboxRow; type: "session" };

function sessionItem(row: FollowedInboxRow): WorkspaceInboxItem {
  return { key: row.session.id, row, type: "session" };
}

// The scrolling part of the OpenCode desktop inbox: Needs attention with its count, Recent
// (headed only below Needs attention), then Archived. Working rows sit in their own shelf.
export function workspaceInboxItems(inbox: FollowedInboxSections): WorkspaceInboxItem[] {
  return [
    ...(inbox.needsYou.length > 0
      ? [
          {
            count: inbox.needsYou.length,
            key: "header:needs-you",
            section: "needs-you" as const,
            type: "header" as const,
          },
          ...inbox.needsYou.map(sessionItem),
        ]
      : []),
    ...(inbox.recent.length > 0 && inbox.needsYou.length > 0
      ? [{ key: "header:recent", section: "recent" as const, type: "header" as const }]
      : []),
    ...inbox.recent.map(sessionItem),
    ...(inbox.archived.length > 0
      ? [
          { key: "header:archived", section: "archived" as const, type: "header" as const },
          ...inbox.archived.map(sessionItem),
        ]
      : []),
  ];
}

export function searchResultItems(inbox: FollowedInboxSections) {
  return [...inbox.needsYou, ...inbox.working, ...inbox.recent, ...inbox.archived]
    .sort(
      (first, second) =>
        second.session.time.updated - first.session.time.updated ||
        first.session.id.localeCompare(second.session.id),
    )
    .map(sessionItem);
}

// Compact elapsed time as in the desktop inbox: seconds only while a run is under a minute old.
export function formatElapsed(milliseconds: number, seconds: boolean) {
  const elapsed = Math.max(0, Math.floor(milliseconds / 1000));
  if (elapsed < 60) return seconds ? `${elapsed}s` : "now";
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3600)}h`;
  return `${Math.floor(elapsed / 86_400)}d`;
}
