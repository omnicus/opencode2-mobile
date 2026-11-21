import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import type { SessionInfo } from "@opencode2-mobile/opencode-adapter";
import {
  canSaveSessionName,
  sessionActionReady,
  sessionArchiveLabel,
  sessionDeleteWarning,
  sessionMenuNotice,
  sessionSheetRequestClose,
  sessionSheetSize,
  sessionSheetTitles,
  sessionSummary,
} from "./session-action-sheet-model";

const now = Date.UTC(2026, 10, 21, 12);

beforeEach(() => {
  jest.useFakeTimers({ now });
});

afterEach(() => {
  jest.useRealTimers();
});

test("sizes the confirmation pages compactly and the editors as pages", () => {
  expect(sessionSheetSize("menu")).toBe("compact");
  expect(sessionSheetSize("delete")).toBe("compact");
  expect(sessionSheetSize("rename")).toBe("page");
  expect(sessionSheetSize("mcp")).toBe("page");
  expect(sessionSheetTitles.delete).toBe("Delete session?");
  expect(sessionSheetTitles.mcp).toBe("MCP servers");
});

test("system back steps back on Android, but an iOS swipe that dismissed a page sheet closes", () => {
  expect(sessionSheetRequestClose("menu", "android")).toBe("close");
  expect(sessionSheetRequestClose("menu", "ios")).toBe("close");
  expect(sessionSheetRequestClose("rename", "android")).toBe("back");
  expect(sessionSheetRequestClose("mcp", "android")).toBe("back");
  expect(sessionSheetRequestClose("delete", "android")).toBe("back");
  expect(sessionSheetRequestClose("rename", "ios")).toBe("close");
  expect(sessionSheetRequestClose("mcp", "ios")).toBe("close");
  expect(sessionSheetRequestClose("delete", "ios")).toBe("close");
});

test("explains disabled rows only while offline", () => {
  expect(sessionMenuNotice(true)).toBeUndefined();
  expect(sessionMenuNotice(false)).toBe("Reconnect to the server to use these actions.");
});

test("summarizes the session from its own record", () => {
  const session = {
    agent: "build",
    model: { id: "claude-opus-5", providerID: "anthropic" },
    time: { created: now - 86_400_000, updated: now - 2 * 3_600_000 },
  } as SessionInfo;
  expect(sessionSummary(session)).toBe("build · claude-opus-5 · Updated 2 hours ago");
  expect(
    sessionSummary({
      time: { created: now, updated: now - 5 * 60_000, archived: now },
    } as SessionInfo),
  ).toBe("Archived · Updated 5 minutes ago");
});

test("warns that deletion takes every subagent session below", () => {
  expect(sessionDeleteWarning).toBe(
    "This deletes the session and any subagent sessions it started. It cannot be undone.",
  );
});

test("an archived session offers Unarchive, any other offers Archive", () => {
  expect(sessionArchiveLabel(false)).toBe("Archive");
  expect(sessionArchiveLabel(true)).toBe("Unarchive");
});

test("a name is savable only when connected, non-blank and changed", () => {
  expect(canSaveSessionName(true, " Next ", "Original")).toBe(true);
  expect(canSaveSessionName(false, "Next", "Original")).toBe(false);
  expect(canSaveSessionName(true, "   ", "Original")).toBe(false);
  expect(canSaveSessionName(true, " Original ", "Original")).toBe(false);
  expect(canSaveSessionName(true, "Next", undefined)).toBe(true);
});

test("remote actions need a connection and a rename needs a name", () => {
  const ready = { connected: true, title: "Name" };
  expect(sessionActionReady("archive", ready)).toBe(true);
  expect(sessionActionReady("archive", { ...ready, title: "" })).toBe(true);
  expect(sessionActionReady("archive", { ...ready, connected: false })).toBe(false);
  expect(sessionActionReady("delete", ready)).toBe(true);
  expect(sessionActionReady("delete", { connected: false, title: "" })).toBe(false);
  expect(sessionActionReady("delete", { ...ready, title: "" })).toBe(true);
  expect(sessionActionReady("rename", ready)).toBe(true);
  expect(sessionActionReady("rename", { ...ready, title: "   " })).toBe(false);
  expect(sessionActionReady("rename", { ...ready, connected: false })).toBe(false);
});
