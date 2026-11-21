import type { SessionInfo } from "@opencode2-mobile/opencode-adapter";
import { sessionTimeDescription } from "./workspace-screen-model";

export type SessionSheetPage = "menu" | "rename" | "delete" | "mcp";
export type SessionAction = "archive" | "rename" | "delete";

export const sessionSheetTitles: Record<SessionSheetPage, string> = {
  menu: "Session actions",
  rename: "Rename session",
  delete: "Delete session?",
  mcp: "MCP servers",
};

export function sessionSheetSize(page: SessionSheetPage) {
  return page === "menu" || page === "delete" ? "compact" : "page";
}

// Android back steps from a page to the menu. On iOS the same callback is the swipe that has
// already dismissed a page sheet natively, so stepping back would strand an invisible sheet.
export function sessionSheetRequestClose(page: SessionSheetPage, platform: string) {
  return page === "menu" || platform === "ios" ? "close" : "back";
}

export function sessionArchiveLabel(archived: boolean) {
  return archived ? "Unarchive" : "Archive";
}

// Shown on the menu when its rows are disabled, so the dimmed rows have a reason.
export function sessionMenuNotice(connected: boolean) {
  return connected ? undefined : "Reconnect to the server to use these actions.";
}

// One line of context from the session record alone: no extra request, nothing persisted.
export function sessionSummary(session: SessionInfo) {
  return [
    session.time.archived !== undefined ? "Archived" : undefined,
    session.agent,
    session.model?.id,
    sessionTimeDescription(session.time.updated),
  ]
    .filter(Boolean)
    .join(" · ");
}

// The same warning wherever a session is deleted: the list's alert and this sheet. Deletion
// takes the whole tree, and a subagent can start subagents of its own.
export const sessionDeleteWarning =
  "This deletes the session and any subagent sessions it started. It cannot be undone.";

export function canSaveSessionName(
  connected: boolean,
  title: string,
  currentTitle: string | undefined,
) {
  return connected && Boolean(title.trim()) && title.trim() !== currentTitle;
}

export function sessionActionReady(
  action: SessionAction,
  state: { connected: boolean; title: string },
) {
  if (!state.connected) return false;
  return action !== "rename" || Boolean(state.title.trim());
}
