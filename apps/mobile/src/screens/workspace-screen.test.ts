import { afterEach, expect, jest, test } from "@jest/globals";
import type { ProjectListOutput } from "@opencode2-mobile/opencode-adapter";

import type { FollowedInboxRow, FollowedInboxSections } from "../state/followed-project-inbox";
import {
  attentionNoticeText,
  attentionNoticeVisible,
  connectionNoticeText,
  flattenSessionPages,
  formatElapsed,
  formatSessionTime,
  getComposerDockKeyboardOffset,
  mentionFileState,
  needsComposerDockMeasurement,
  pendingShortcutLabels,
  projectDirectories,
  searchResultItems,
  selectFollowedProject,
  sessionBranchState,
  sessionTimeDescription,
  sessionWaitingFor,
  shouldAutoFillTranscript,
  transcriptLoadErrorMessage,
  withTranscriptContentSize,
  withTranscriptViewportSize,
  workspaceInboxItems,
} from "./workspace-screen-model";

afterEach(() => {
  jest.useRealTimers();
});

test("measures the keyboard dock once per physical screen size", () => {
  expect(needsComposerDockMeasurement(undefined, 2_000, false)).toBe(true);
  expect(needsComposerDockMeasurement(2_000, 2_000, false)).toBe(false);
  expect(needsComposerDockMeasurement(2_000, 1_000, false)).toBe(true);
  expect(needsComposerDockMeasurement(2_000, 2_000, true)).toBe(false);
});

test("positions the composer from every keyboard frame without retaining the prior cycle", () => {
  const dockScreenBottom = 1_800;
  const keyboardScreenY = 1_234;

  expect(getComposerDockKeyboardOffset(dockScreenBottom, keyboardScreenY, 32)).toBe(534);
  expect(getComposerDockKeyboardOffset(dockScreenBottom, 2_000)).toBe(0);
  expect(getComposerDockKeyboardOffset(dockScreenBottom, keyboardScreenY, 32)).toBe(534);
});

test("flattens cursor pages in server order and removes concurrent duplicates", () => {
  const first = session("ses_first", 3);
  const duplicate = { ...first, title: "stale duplicate" };
  const second = session("ses_second", 2);

  expect(
    flattenSessionPages([
      { cursor: { next: "opaque" }, data: [first] },
      { cursor: {}, data: [duplicate, second] },
    ]).map((item) => item.id),
  ).toEqual(["ses_first", "ses_second"]);
});

test("offers canonical, current, and sandbox directories without duplicates", () => {
  expect(
    projectDirectories(
      {
        canonical: "/project",
        id: "project-1",
        sandboxes: ["/project", "/worktree"],
        time: { active: 1, created: 1, updated: 1 },
      },
      "project-1",
      "/project/subdirectory",
    ),
  ).toEqual(["/project", "/project/subdirectory", "/worktree"]);
});

test("keeps a large paginated list stable and accepts an empty response", () => {
  const sessions = Array.from({ length: 120 }, (_, index) => session(`ses_${index}`, 120 - index));
  const pages = Array.from({ length: 4 }, (_, index) => ({
    cursor: index === 3 ? {} : { next: `page:${index + 1}` },
    data: sessions.slice(index * 30, (index + 1) * 30),
  }));

  expect(flattenSessionPages(pages)).toEqual(sessions);
  expect(flattenSessionPages([{ cursor: {}, data: [] }])).toEqual([]);
});

test("lists Needs attention with its count, then Recent and Archived, without Working", () => {
  const inbox = sections({
    archived: [row("ses_archived", 3)],
    needsYou: [row("ses_blocked", 1)],
    recent: [row("ses_a", 50), row("ses_b", 40)],
    working: [row("ses_working", 2)],
  });

  const items = workspaceInboxItems(inbox);
  expect(keys(items)).toEqual([
    "header:needs-you",
    "ses_blocked",
    "header:recent",
    "ses_a",
    "ses_b",
    "header:archived",
    "ses_archived",
  ]);
  expect(items[0]).toEqual({
    count: 1,
    key: "header:needs-you",
    section: "needs-you",
    type: "header",
  });
  expect(items[2]).not.toHaveProperty("count");
});

test("Recent has no header when nothing needs attention", () => {
  expect(keys(workspaceInboxItems(sections({ recent: [row("ses_a", 50)] })))).toEqual(["ses_a"]);
  expect(keys(workspaceInboxItems(sections({ working: [row("ses_working", 2)] })))).toEqual([]);
});

test("formats compact elapsed time like the desktop inbox", () => {
  expect(formatElapsed(-5_000, true)).toBe("0s");
  expect(formatElapsed(35_000, true)).toBe("35s");
  expect(formatElapsed(35_000, false)).toBe("now");
  expect(formatElapsed(5 * 60_000, false)).toBe("5m");
  expect(formatElapsed(3 * 3_600_000, true)).toBe("3h");
  expect(formatElapsed(2 * 86_400_000, false)).toBe("2d");
});

test("search results are one list ordered by recency", () => {
  const inbox = sections({
    archived: [row("ses_archived", 70)],
    needsYou: [row("ses_blocked", 1)],
    recent: [row("ses_a", 50), row("ses_b", 90)],
    working: [row("ses_working", 60)],
  });

  expect(keys(searchResultItems(inbox))).toEqual([
    "ses_b",
    "ses_archived",
    "ses_working",
    "ses_a",
    "ses_blocked",
  ]);
});

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

test("shortens session times to minutes, hours, days, then a date", () => {
  const now = Date.UTC(2026, 10, 1, 12);
  jest.useFakeTimers({ now });

  expect(formatSessionTime(now + minute)).toBe("Now");
  expect(formatSessionTime(Number.NaN)).toBe("Now");
  expect(formatSessionTime(now - 30_000)).toBe("Now");
  expect(formatSessionTime(now - 5 * minute)).toBe("5m");
  expect(formatSessionTime(now - 3 * hour)).toBe("3h");
  expect(formatSessionTime(now - 2 * day)).toBe("2d");
  expect(formatSessionTime(now - 10 * day)).toBe(
    new Date(now - 10 * day).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  );
});

test("describes session times in words with singular and plural units", () => {
  const now = Date.UTC(2026, 10, 1, 12);
  jest.useFakeTimers({ now });

  expect(sessionTimeDescription(Number.NaN)).toBe("Updated just now");
  expect(sessionTimeDescription(now - 30_000)).toBe("Updated just now");
  expect(sessionTimeDescription(now - minute)).toBe("Updated 1 minute ago");
  expect(sessionTimeDescription(now - 5 * minute)).toBe("Updated 5 minutes ago");
  expect(sessionTimeDescription(now - hour)).toBe("Updated 1 hour ago");
  expect(sessionTimeDescription(now - 3 * hour)).toBe("Updated 3 hours ago");
  expect(sessionTimeDescription(now - day)).toBe("Updated 1 day ago");
  expect(sessionTimeDescription(now - 2 * day)).toBe("Updated 2 days ago");
  expect(sessionTimeDescription(now - 10 * day)).toBe(
    `Updated ${new Date(now - 10 * day).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`,
  );
});

test("falls back to a generic time when the date cannot be formatted", () => {
  const now = Date.UTC(2026, 10, 1, 12);
  jest.useFakeTimers({ now });
  const format = jest.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(() => {
    throw new RangeError("Unsupported locale");
  });
  try {
    expect(formatSessionTime(now - 10 * day)).toBe("Earlier");
    expect(sessionTimeDescription(now - 10 * day)).toBe("Updated earlier");
  } finally {
    format.mockRestore();
  }
});

test("labels the branch as known, unavailable, loading, or absent", () => {
  expect(sessionBranchState("main", true, true)).toEqual({
    name: "main",
    stale: true,
    state: "known",
  });
  expect(sessionBranchState("", true, true)).toEqual({ state: "unavailable" });
  expect(sessionBranchState(undefined, false, true)).toEqual({ state: "loading" });
  expect(sessionBranchState(undefined, false, false)).toEqual({ state: "none" });
});

test("waits on permissions before forms", () => {
  expect(sessionWaitingFor(1, 1)).toBe("permission");
  expect(sessionWaitingFor(0, 2)).toBe("input");
  expect(sessionWaitingFor(0, 0)).toBeUndefined();
});

test("shows the attention notice for stale or incomplete current coverage", () => {
  expect(attentionNoticeVisible({ completeness: "complete", freshness: "stale" })).toBe(true);
  expect(attentionNoticeVisible({ completeness: "incomplete", freshness: "current" })).toBe(true);
  expect(attentionNoticeVisible({ completeness: "complete", freshness: "current" })).toBe(false);
  expect(attentionNoticeVisible({ completeness: "incomplete", freshness: "reconciling" })).toBe(
    false,
  );
});

test("words the attention and connection notices only while they are visible", () => {
  expect(attentionNoticeText(false, "stale")).toBeUndefined();
  expect(attentionNoticeText(true, "stale")).toBe(
    "Request status is stale. Reconnect to check pending requests.",
  );
  expect(attentionNoticeText(true, "current")).toBe("Some request locations could not be checked.");
  expect(connectionNoticeText(false, true)).toBeUndefined();
  expect(connectionNoticeText(true, true)).toBe("Showing saved data until the server reconnects.");
  expect(connectionNoticeText(true, false)).toBe("Waiting for current server data.");
});

test("labels the pending shortcut with a capped count", () => {
  expect(pendingShortcutLabels(1)).toEqual({
    accessibilityLabel: "1 known request",
    label: "Needs you 1",
  });
  expect(pendingShortcutLabels(99)).toEqual({
    accessibilityLabel: "99 known requests",
    label: "Needs you 99",
  });
  expect(pendingShortcutLabels(100).label).toBe("Needs you 99+");
});

test("selects the default followed project and its current directory", () => {
  const projects = [project("first", "/first"), project("default", "/default")];
  expect(selectFollowedProject(projects, ["first", "default"], "default", "/default/sub")).toEqual({
    directory: "/default/sub",
    id: "default",
  });
  expect(selectFollowedProject(projects, ["first", "default"], "default", undefined)).toEqual({
    directory: "/default",
    id: "default",
  });
  expect(selectFollowedProject(projects, ["first"], "default", "/default/sub")).toEqual({
    directory: "/first",
    id: "first",
  });
  expect(selectFollowedProject(projects, [], "default", "/default/sub")).toBeUndefined();
});

test("fills the transcript only while a measured short list follows the live edge", () => {
  const scope = "scope";
  const ready = {
    canLoadOlder: true,
    connected: true,
    liveFollowEnabled: true,
    messagesError: false,
    messagesPending: false,
    ready: true,
    size: { content: 100, scope, viewport: 500 },
    sizeScope: scope,
    viewportSlack: 16,
    visible: true,
  };
  expect(shouldAutoFillTranscript(ready)).toBe(true);
  expect(shouldAutoFillTranscript({ ...ready, canLoadOlder: false })).toBe(false);
  expect(shouldAutoFillTranscript({ ...ready, liveFollowEnabled: false })).toBe(false);
  expect(shouldAutoFillTranscript({ ...ready, sizeScope: "other" })).toBe(false);
  expect(shouldAutoFillTranscript({ ...ready, size: { content: 490, scope, viewport: 500 } })).toBe(
    false,
  );
});

test("keeps transcript measurements for the current scope and resets them for a new one", () => {
  const current = { content: 100, scope: "a", viewport: 500 };
  expect(withTranscriptContentSize(current, "a", 100)).toBe(current);
  expect(withTranscriptContentSize(current, "a", 200)).toEqual({
    content: 200,
    scope: "a",
    viewport: 500,
  });
  expect(withTranscriptContentSize(current, "b", 100)).toEqual({
    content: 100,
    scope: "b",
    viewport: 0,
  });
  expect(withTranscriptViewportSize(current, "a", 500)).toBe(current);
  expect(withTranscriptViewportSize(current, "a", 600)).toEqual({
    content: 100,
    scope: "a",
    viewport: 600,
  });
  expect(withTranscriptViewportSize(current, "b", 500)).toEqual({
    content: 0,
    scope: "b",
    viewport: 500,
  });
});

test("offers mention files only for the settled search", () => {
  const settled = {
    deferredSearch: "src",
    executionLoading: false,
    executionUnavailable: false,
    files: ["src/index.ts"],
    filesError: false,
    filesPending: false,
    search: "src",
  };
  expect(mentionFileState(settled)).toEqual({
    files: ["src/index.ts"],
    loading: false,
    unavailable: false,
  });
  expect(mentionFileState({ ...settled, files: undefined }).files).toEqual([]);
  expect(mentionFileState({ ...settled, search: "src/i" })).toEqual({
    files: [],
    loading: true,
    unavailable: false,
  });
  expect(mentionFileState({ ...settled, filesPending: true }).loading).toBe(true);
  expect(
    mentionFileState({
      ...settled,
      deferredSearch: undefined,
      filesPending: true,
      search: undefined,
    }).loading,
  ).toBe(false);
  expect(mentionFileState({ ...settled, executionLoading: true }).loading).toBe(true);
  expect(mentionFileState({ ...settled, filesError: true }).unavailable).toBe(true);
  expect(mentionFileState({ ...settled, executionUnavailable: true }).unavailable).toBe(true);
});

test("explains unsupported transcript data separately from other load failures", () => {
  expect(transcriptLoadErrorMessage(new Error("MALFORMED_MESSAGE_LIST"))).toBe(
    "This server returned unsupported transcript data.",
  );
  expect(transcriptLoadErrorMessage(new Error("UNREACHABLE"))).toBe(
    "The transcript could not be loaded. Refresh and try again.",
  );
  expect(transcriptLoadErrorMessage("MALFORMED_MESSAGE_LIST")).toBe(
    "The transcript could not be loaded. Refresh and try again.",
  );
});

function project(id: string, canonical: string): ProjectListOutput[number] {
  return { canonical, id, sandboxes: [], time: { active: 1, created: 1, updated: 1 } };
}

function keys(items: readonly { key: string }[]) {
  return items.map((item) => item.key);
}

function sections(input: Partial<FollowedInboxSections>): FollowedInboxSections {
  return {
    archived: [],
    needsYou: [],
    recent: [],
    unmatchedSessionIDs: [],
    working: [],
    ...input,
  };
}

function row(id: string, updated: number): FollowedInboxRow {
  const item = session(id, updated);
  return {
    active: false,
    archived: false,
    attentionCount: 0,
    projectLabel: "Project",
    section: "recent",
    session: item,
    status: "ready",
    targetLocation: item.location,
    targetSessionID: item.id,
  };
}

function session(id: string, updated: number) {
  return {
    cost: 0,
    id,
    location: { directory: "/project" },
    projectID: "project-1",
    time: { created: updated, updated },
    title: id,
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  };
}
