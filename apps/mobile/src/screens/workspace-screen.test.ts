import { expect, test } from "@jest/globals";

import type { FollowedInboxRow, FollowedInboxSections } from "../state/followed-project-inbox";
import {
  flattenSessionPages,
  formatElapsed,
  getComposerDockKeyboardOffset,
  needsComposerDockMeasurement,
  projectDirectories,
  searchResultItems,
  workspaceInboxItems,
} from "./workspace-screen-model";

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
