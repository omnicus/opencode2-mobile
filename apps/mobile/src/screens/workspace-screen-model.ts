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
import type { AttentionCoverage } from "../state/followed-projects-context";
import type { CollapsibleInboxSection } from "../storage/session-inbox-repository";

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

export type SessionBranchState =
  | { name: string; stale: boolean; state: "known" }
  | { state: "loading" | "none" | "unavailable" };

export function sessionBranchState(
  current: string | undefined,
  unavailable: boolean,
  pending: boolean,
): SessionBranchState {
  if (current) return { name: current, stale: unavailable, state: "known" };
  if (unavailable) return { state: "unavailable" };
  return { state: pending ? "loading" : "none" };
}

export function sessionWaitingFor(
  permissionCount: number,
  formCount: number,
): "input" | "permission" | undefined {
  if (permissionCount > 0) return "permission";
  return formCount > 0 ? "input" : undefined;
}

export function attentionNoticeVisible(
  coverage: Pick<AttentionCoverage, "completeness" | "freshness">,
) {
  return (
    coverage.freshness === "stale" ||
    (coverage.freshness === "current" && coverage.completeness === "incomplete")
  );
}

export function attentionNoticeText(visible: boolean, freshness: AttentionCoverage["freshness"]) {
  if (!visible) return undefined;
  return freshness === "stale"
    ? "Request status is stale. Reconnect to check pending requests."
    : "Some request locations could not be checked.";
}

export function connectionNoticeText(visible: boolean, cached: boolean) {
  if (!visible) return undefined;
  return cached
    ? "Showing saved data until the server reconnects."
    : "Waiting for current server data.";
}

export function pendingShortcutLabels(pendingCount: number) {
  return {
    accessibilityLabel: `${pendingCount} known ${pendingCount === 1 ? "request" : "requests"}`,
    label: pendingCount > 99 ? "Needs you 99+" : `Needs you ${pendingCount}`,
  };
}

export function selectFollowedProject(
  projects: readonly Project[],
  followedProjectIds: readonly string[],
  defaultProjectId: string | undefined,
  defaultDirectory: string | undefined,
) {
  const followedProjects = projects.filter((project) => followedProjectIds.includes(project.id));
  const project =
    followedProjects.find((candidate) => candidate.id === defaultProjectId) ?? followedProjects[0];
  if (!project) return undefined;
  return {
    directory:
      project.id === defaultProjectId && defaultDirectory ? defaultDirectory : project.canonical,
    id: project.id,
  };
}

export type TranscriptSize = { content: number; scope: string; viewport: number };

export function shouldAutoFillTranscript(state: {
  canLoadOlder: boolean;
  connected: boolean;
  liveFollowEnabled: boolean;
  messagesError: boolean;
  messagesPending: boolean;
  ready: boolean;
  size: TranscriptSize;
  sizeScope: string;
  visible: boolean;
  viewportSlack: number;
}) {
  return (
    state.canLoadOlder &&
    state.visible &&
    state.ready &&
    state.connected &&
    state.liveFollowEnabled &&
    !state.messagesPending &&
    !state.messagesError &&
    state.size.scope === state.sizeScope &&
    state.size.viewport > 0 &&
    state.size.content > 0 &&
    state.size.content < state.size.viewport - state.viewportSlack
  );
}

export function withTranscriptContentSize(current: TranscriptSize, scope: string, height: number) {
  if (current.scope === scope && current.content === height) return current;
  return { scope, viewport: current.scope === scope ? current.viewport : 0, content: height };
}

export function withTranscriptViewportSize(current: TranscriptSize, scope: string, height: number) {
  if (current.scope === scope && current.viewport === height) return current;
  return { scope, viewport: height, content: current.scope === scope ? current.content : 0 };
}

export function mentionFileState<File>(state: {
  deferredSearch: string | undefined;
  executionLoading: boolean;
  executionUnavailable: boolean;
  files: File[] | undefined;
  filesError: boolean;
  filesPending: boolean;
  search: string | undefined;
}) {
  const current = state.deferredSearch === state.search;
  return {
    files: current ? (state.files ?? []) : [],
    loading:
      state.executionLoading || (state.search !== undefined && (state.filesPending || !current)),
    unavailable: state.executionUnavailable || state.filesError,
  };
}

export function transcriptLoadErrorMessage(error: unknown) {
  return error instanceof Error && error.message === "MALFORMED_MESSAGE_LIST"
    ? "This server returned unsupported transcript data."
    : "The transcript could not be loaded.";
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

export const workspaceSectionLabels: Record<CollapsibleInboxSection, string> = {
  archived: "Archived",
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
  | {
      count: number;
      expanded: boolean;
      key: string;
      section: CollapsibleInboxSection;
      type: "header";
    }
  | { key: string; row: FollowedInboxRow; type: "session" };

function sessionItem(row: FollowedInboxRow): WorkspaceInboxItem {
  return { key: row.session.id, row, type: "session" };
}

function collapsibleSection(
  section: CollapsibleInboxSection,
  rows: readonly FollowedInboxRow[],
  expanded: boolean,
): WorkspaceInboxItem[] {
  if (rows.length === 0) return [];
  return [
    { count: rows.length, expanded, key: `header:${section}`, section, type: "header" },
    ...(expanded ? rows.map(sessionItem) : []),
  ];
}

// Sessions that need attention lead, then finished runs, both without a header. Working and
// Archived follow under headers that collapse them, so a long archive never hides Working.
export function workspaceInboxItems(
  inbox: FollowedInboxSections,
  expanded: Record<CollapsibleInboxSection, boolean>,
): WorkspaceInboxItem[] {
  return [
    ...inbox.needsYou.map(sessionItem),
    ...inbox.recent.map(sessionItem),
    ...collapsibleSection("working", inbox.working, expanded.working),
    ...collapsibleSection("archived", inbox.archived, expanded.archived),
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
