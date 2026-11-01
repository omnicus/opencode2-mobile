import type {
  ProjectListOutput,
  SessionInfo,
  SessionsResponse,
} from "@opencode2-mobile/opencode-adapter";
import type { FollowedInboxRow, FollowedInboxSections } from "../state/followed-project-inbox";

type Project = ProjectListOutput[number];

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

export type WorkspaceInboxItem =
  | { key: string; type: "divider" }
  | { key: string; row: FollowedInboxRow; type: "session" };

function sessionItem(row: FollowedInboxRow): WorkspaceInboxItem {
  return { key: row.session.id, row, type: "session" };
}

// Every ongoing row, then the newest finished rows up to the limit. Rows keep the stabilized
// order from the inbox so they do not jump while sessions stream.
export function workspaceInboxItems(
  inbox: FollowedInboxSections,
  limit: number,
): WorkspaceInboxItem[] {
  const ongoing = [...inbox.needsYou, ...inbox.working];
  const finishedIDs = new Set(
    [...inbox.recent]
      .sort((first, second) => second.session.time.updated - first.session.time.updated)
      .slice(0, Math.max(0, limit - ongoing.length))
      .map((row) => row.session.id),
  );
  const finished = inbox.recent.filter((row) => finishedIDs.has(row.session.id));
  return [
    ...ongoing.map(sessionItem),
    ...(ongoing.length > 0 && finished.length > 0
      ? [{ key: "divider:finished", type: "divider" as const }]
      : []),
    ...finished.map(sessionItem),
  ];
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
