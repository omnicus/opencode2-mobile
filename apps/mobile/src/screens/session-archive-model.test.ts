import { expect, test } from "@jest/globals";
import type { SessionInfo } from "@opencode2-mobile/opencode-adapter";
import type { FollowedInboxRow, FollowedInboxSections } from "../state/followed-project-inbox";
import {
  addArchivedSessions,
  resolveSessionArchiveIds,
  selectSessionArchiveView,
  sessionAutoArchiveAgeMs,
} from "./session-archive-model";

function row(id: string, active = false, attentionCount = 0): FollowedInboxRow {
  const session = {
    id,
    projectID: "project",
    title: id,
    location: { directory: "/workspace" },
    time: { created: 1, updated: 1 },
  } as SessionInfo;
  return {
    session,
    active,
    attentionCount,
    activeChildCount: active ? 1 : 0,
    children: [],
    projectLabel: "Project",
    section: "recent",
    targetLocation: session.location,
    targetSessionID: id,
  };
}
const idle = row("ses_idle");
const active = row("ses_active", true);
const blocked = row("ses_blocked", false, 1);
const other = row("ses_other");
const inbox: FollowedInboxSections = {
  needsYou: [blocked],
  working: [active],
  recent: [idle, other],
  unmatchedSessionIDs: [],
};

test("archives only idle sessions strictly older than 30 days since their last update", () => {
  const now = sessionAutoArchiveAgeMs * 2;
  const boundary = row("ses_boundary");
  boundary.session.time.updated = now - sessionAutoArchiveAgeMs;
  const childActive = { ...row("ses_child_active"), activeChildCount: 1 };
  expect(
    resolveSessionArchiveIds({ ...inbox, recent: [idle, boundary, childActive] }, [], {}, now),
  ).toEqual(["ses_idle"]);
  expect(resolveSessionArchiveIds(inbox, ["ses_manual"], {}, now)).toEqual([
    "ses_manual",
    "ses_idle",
    "ses_other",
  ]);
  expect(resolveSessionArchiveIds(inbox, [], { ses_idle: now, ses_other: now }, now)).toEqual([]);
  expect(
    resolveSessionArchiveIds(
      inbox,
      [],
      { ses_idle: now, ses_other: now },
      now + sessionAutoArchiveAgeMs + 1,
    ),
  ).toEqual(["ses_idle", "ses_other"]);
});

test("restoring an old session moves it to the top of Recent without changing server timestamps", () => {
  const restored = row("ses_restored");
  expect(
    selectSessionArchiveView({ ...inbox, recent: [other, restored] }, [], false, {
      ses_restored: 100,
    }).recent.map((item) => item.session.id),
  ).toEqual(["ses_restored", "ses_other"]);
  expect(restored.session.time.updated).toBe(1);
});

test("hides idle archives but never hides active tasks or attention", () => {
  const ids = [idle.session.id, active.session.id, blocked.session.id];
  expect(selectSessionArchiveView(inbox, ids, false)).toEqual({ ...inbox, recent: [other] });
  expect(selectSessionArchiveView(inbox, ids, true)).toEqual({ ...inbox, recent: [idle] });
  expect(selectSessionArchiveView(inbox, [], false)).toEqual(inbox);
});

test("restores archived sessions outside the loaded pages without copying server content", () => {
  const older = row("ses_older").session;
  const extra = addArchivedSessions(
    inbox,
    [
      idle.session,
      older,
      { ...older, id: "ses_unfollowed", projectID: "unfollowed" },
      { ...older, id: "ses_child", parentID: "ses_idle" },
    ],
    new Map([["project", "Project"]]),
    "",
  );
  expect(extra.recent.map((item) => item.session.id)).toEqual([
    "ses_idle",
    "ses_other",
    "ses_older",
  ]);
  expect(
    addArchivedSessions(inbox, [older], new Map([["project", "Project"]]), "non-matching").recent,
  ).toEqual(inbox.recent);
});
