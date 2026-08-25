import { expect, test } from "@jest/globals";

import {
  flattenSessionPages,
  getComposerDockKeyboardOffset,
  needsComposerDockMeasurement,
  projectDirectories,
} from "./workspace-screen-model";

test("measures the keyboard dock once per window size", () => {
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
        time: { created: 1, updated: 1 },
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
