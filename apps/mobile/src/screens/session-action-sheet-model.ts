export type SessionSheetPage = "menu" | "rename" | "delete" | "devtools";
export type SessionAction = "archive" | "rename" | "delete";

export const sessionSheetTitles: Record<SessionSheetPage, string> = {
  menu: "Session actions",
  rename: "Rename session",
  delete: "Delete session?",
  devtools: "Dev tools",
};

export function sessionSheetSize(page: SessionSheetPage) {
  return page === "menu" || page === "delete" ? "compact" : "page";
}

export function sessionArchiveLabel(archived: boolean) {
  return archived ? "Unarchive" : "Archive";
}

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
