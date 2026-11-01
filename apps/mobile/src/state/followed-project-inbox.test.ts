import { expect, jest, test } from "@jest/globals";
import type {
  FormInfo,
  OpenCodeClient,
  PermissionRequest,
  SessionInfo,
  SessionsResponse,
} from "@opencode2-mobile/opencode-adapter";

import {
  buildFollowedInboxSections,
  failedFollowedSessionProjects,
  fetchFollowedSessionPage,
  flattenFollowedSessionPages,
  isSessionUnread,
  nextFollowedSessionPageParam,
  setFollowedSessionArchived,
  stabilizeFollowedInboxSections,
  uniqueLocations,
  workingSince,
} from "./followed-project-inbox";

type ListProjectSessionsCall = (
  client: OpenCodeClient,
  projectID: string,
  input: { archived?: boolean; cursor?: string },
  options?: { signal?: AbortSignal },
) => Promise<SessionsResponse>;

const mockListProjectSessions = jest.fn<ListProjectSessionsCall>();

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  getOpenCodeSession: jest.fn(),
  listOpenCodeProjectSessions: (...args: Parameters<ListProjectSessionsCall>) =>
    mockListProjectSessions(...args),
}));

test("paginates followed projects independently and contains a project failure", async () => {
  mockListProjectSessions.mockReset();
  let projectBAttempts = 0;
  mockListProjectSessions.mockImplementation(async (_client, projectID, input) => {
    if (projectID === "project-b") {
      projectBAttempts += 1;
      if (projectBAttempts === 1) throw new Error("offline");
      return { cursor: {}, data: [session("ses_beta", 1, "project-b")] };
    }
    return {
      cursor: { next: input.cursor ? null : "project-a:older" },
      data: [session(`ses_${input.cursor ? "older" : "newer"}`, 2, "project-a")],
    };
  });
  const client = {} as OpenCodeClient;

  const first = await fetchFollowedSessionPage(
    client,
    ["project-a", "project-b"],
    { "project-a": undefined, "project-b": undefined },
    { limit: 30 },
  );

  expect(first.failures).toEqual(["project-b"]);
  expect(first.cursors).toEqual({ "project-a": "project-a:older", "project-b": undefined });
  expect(nextFollowedSessionPageParam(first)).toEqual({
    "project-a": "project-a:older",
    "project-b": undefined,
  });
  const second = await fetchFollowedSessionPage(client, ["project-a", "project-b"], first.cursors, {
    limit: 30,
  });
  expect(mockListProjectSessions).toHaveBeenCalledWith(
    client,
    "project-a",
    {
      cursor: "project-a:older",
      limit: 30,
      order: "desc",
      parentID: null,
    },
    undefined,
  );
  expect(nextFollowedSessionPageParam(second)).toBeUndefined();
  expect(failedFollowedSessionProjects([first, second])).toEqual([]);
  expect(flattenFollowedSessionPages([first, second]).map((item) => item.id)).toEqual([
    "ses_newer",
    "ses_older",
    "ses_beta",
  ]);
});

test("builds non-overlapping sections and bubbles child work and attention once", () => {
  const root = session("ses_root", 3, "project-a");
  const child = { ...session("ses_child", 4, "project-a"), parentID: root.id };
  const recent = session("ses_recent", 2, "project-b");
  const permission = {
    action: "shell",
    id: "per_child",
    resources: [],
    sessionID: child.id,
  } satisfies PermissionRequest;
  const form = {
    fields: [{ key: "answer", type: "string" }],
    id: "form_child",
    sessionID: child.id,
    title: "Input",
  } satisfies FormInfo;

  const sections = buildFollowedInboxSections({
    activeSessionIDs: [child.id, child.id],
    ancestrySessions: { [child.id]: child, [root.id]: root },
    forms: [form],
    permissions: [permission],
    projects: [
      {
        canonical: "/a",
        id: "project-a",
        name: "Alpha",
        sandboxes: [],
        time: { active: 1, created: 1, updated: 1 },
      },
      {
        canonical: "/b",
        id: "project-b",
        sandboxes: [],
        time: { active: 1, created: 1, updated: 1 },
      },
    ],
    recentSince: "all",
    rootSessions: [root, recent],
  });

  expect(sections.needsYou).toHaveLength(1);
  expect(sections.needsYou[0]).toMatchObject({
    active: true,
    attentionCount: 2,
    status: "approval",
    projectLabel: "Alpha",
    targetLocation: child.location,
    targetSessionID: "ses_child",
  });
  expect(sections.needsYou[0]).not.toHaveProperty("children");
  expect(sections.working).toEqual([]);
  expect(sections.recent.map((row) => row.session.id)).toEqual(["ses_recent"]);
  expect(
    [...sections.needsYou, ...sections.working, ...sections.recent].map((row) => row.session.id),
  ).toEqual(["ses_root", "ses_recent"]);
});

test.each(["permission", "form"] as const)(
  "gives a single %s request its status without server content",
  (kind) => {
    const root = session("ses_reason", 3, "project-a");
    const permission: PermissionRequest = {
      action: "shell",
      id: "per_reason",
      resources: ["/private"],
      sessionID: root.id,
    };
    const form: FormInfo = {
      id: "form_reason",
      title: "Private content",
      fields: [{ key: "answer", type: "string" }],
      sessionID: root.id,
    };
    const sections = buildFollowedInboxSections({
      activeSessionIDs: [root.id],
      ancestrySessions: {},
      projects: [],
      recentSince: "all",
      rootSessions: [root],
      permissions: kind === "permission" ? [permission, permission] : [],
      forms: kind === "form" ? [form, form] : [],
    });
    expect(sections.needsYou[0]).toMatchObject({
      attentionCount: 1,
      status: kind === "permission" ? "approval" : "input",
    });
    expect(sections.working).toEqual([]);
  },
);

test("shows actionable ancestry roots and orphan fallbacks outside loaded feed pages", () => {
  const olderRoot = session("ses_older_root", 2, "project-a");
  const child = { ...session("ses_child", 3, "project-a"), parentID: olderRoot.id };
  const orphan = { ...session("ses_orphan", 4, "project-a"), parentID: "ses_missing" };

  const sections = buildFollowedInboxSections({
    activeSessionIDs: [child.id, orphan.id],
    ancestrySessions: {
      [child.id]: child,
      [olderRoot.id]: olderRoot,
      [orphan.id]: orphan,
    },
    forms: [],
    permissions: [],
    projects: [
      {
        canonical: "/a",
        id: "project-a",
        sandboxes: [],
        time: { active: 1, created: 1, updated: 1 },
      },
    ],
    recentSince: "all",
    rootSessions: [],
  });

  // Neither run start is known, so the order falls back to the session ID.
  expect(sections.working.map((row) => row.session.id)).toEqual(["ses_older_root", "ses_orphan"]);
  expect(sections.unmatchedSessionIDs).toEqual([]);
});

test("background-only child work makes the root row working and still opens the root", () => {
  const root = session("ses_root", 2, "project-a");
  const child = { ...session("ses_child", 3, "project-a"), parentID: root.id };

  const sections = buildFollowedInboxSections({
    activeSessionIDs: [child.id],
    ancestrySessions: { [child.id]: child, [root.id]: root },
    forms: [],
    permissions: [],
    projects: [],
    recentSince: "all",
    rootSessions: [root],
  });

  expect(sections.working.map((row) => row.session.id)).toEqual(["ses_root"]);
  expect(sections.working[0]).toMatchObject({
    active: true,
    attentionCount: 0,
    targetSessionID: "ses_root",
  });
  expect(sections.recent).toEqual([]);
});

test("labels a worktree only when the session runs outside the project's canonical directory", () => {
  const project = {
    canonical: "/repo",
    id: "project-a",
    name: "Repo",
    sandboxes: [],
    time: { active: 1, created: 1, updated: 1 },
  };
  const canonical = {
    ...session("ses_canonical", 2, "project-a"),
    location: { directory: "/repo" },
  };
  const worktree = {
    ...session("ses_worktree", 1, "project-a"),
    location: { directory: "/worktrees/repo/feature-list" },
  };

  const sections = buildFollowedInboxSections({
    activeSessionIDs: [],
    ancestrySessions: {},
    forms: [],
    permissions: [],
    projects: [project],
    recentSince: "all",
    rootSessions: [canonical, worktree],
  });

  expect(sections.recent[0]).not.toHaveProperty("worktreeLabel");
  expect(sections.recent[1]).toMatchObject({
    projectLabel: "Repo",
    worktreeLabel: "feature-list",
  });
});

test("keeps exact directories and workspace IDs distinct", () => {
  expect(
    uniqueLocations([
      { directory: "/project" },
      { directory: "/project/subdir" },
      { directory: "/project", workspaceID: "wrk_one" },
      { directory: "/project" },
    ]),
  ).toEqual([
    { directory: "/project" },
    { directory: "/project", workspaceID: "wrk_one" },
    { directory: "/project/subdir" },
  ]);
});

test("keeps global forms out of session ancestry without marking coverage unresolved", () => {
  const root = session("ses_root", 1, "project-a");
  const sections = buildFollowedInboxSections({
    activeSessionIDs: [],
    ancestrySessions: {},
    forms: [
      {
        fields: [{ key: "confirmed", type: "boolean" }],
        id: "frm_global",
        sessionID: "global",
        title: "Confirm",
      },
    ],
    permissions: [],
    projects: [],
    recentSince: "all",
    rootSessions: [root],
  });

  expect(sections.unmatchedSessionIDs).toEqual([]);
  expect(sections.recent.map((row) => row.session.id)).toEqual([root.id]);
});

test("keeps Needs you rows stable while their server timestamps change", () => {
  const first = session("ses_first", 1, "project-a");
  const second = session("ses_second", 2, "project-a");
  const permissions = [first, second].map((item) => ({
    action: "shell",
    id: `per_${item.id}`,
    resources: [],
    sessionID: item.id,
  }));
  const build = (rootSessions: SessionInfo[]) =>
    buildFollowedInboxSections({
      activeSessionIDs: [],
      ancestrySessions: {},
      forms: [],
      permissions,
      projects: [],
      recentSince: 0,
      rootSessions,
    });
  const previous = build([first, second]);
  const next = build([{ ...first, time: { created: 1, updated: 4 } }, second]);

  expect(previous.needsYou.map((row) => row.session.id)).toEqual(["ses_second", "ses_first"]);
  expect(next.needsYou.map((row) => row.session.id)).toEqual(["ses_first", "ses_second"]);
  expect(
    stabilizeFollowedInboxSections(next, previous).needsYou.map((row) => row.session.id),
  ).toEqual(["ses_second", "ses_first"]);
});

test("orders Working by when each run started, with unknown starts last", () => {
  const late = run(session("ses_late", 9, "project-a"), { busy: 300 });
  const early = run(session("ses_early", 8, "project-a"), { busy: 100 });
  // The previous run ended after it started, so this run's start is not known yet.
  const unknown = run(session("ses_unknown", 10, "project-a"), { busy: 50, idle: 60 });

  const sections = buildFollowedInboxSections({
    activeSessionIDs: [late.id, early.id, unknown.id],
    ancestrySessions: {},
    forms: [],
    permissions: [],
    projects: [],
    recentSince: 0,
    rootSessions: [late, early, unknown],
  });

  expect(sections.working.map((row) => row.session.id)).toEqual([
    "ses_early",
    "ses_late",
    "ses_unknown",
  ]);
  expect(sections.working.every((row) => row.status === "working")).toBe(true);
  expect(workingSince(late)).toBe(300);
  expect(workingSince(unknown)).toBeUndefined();
});

test("lists only runs finished since the inbox started, newest first, split by archive", () => {
  const before = run(session("ses_before", 9, "project-a"), { idle: 999 });
  const never = session("ses_never", 8, "project-a");
  const older = run(session("ses_older", 7, "project-a"), { idle: 1_100 });
  const newer = run(session("ses_newer", 6, "project-a"), { idle: 1_300 });
  const archived = run(session("ses_archived", 5, "project-a"), { archived: 1_400, idle: 1_200 });
  const archivedBefore = run(session("ses_archived_before", 4, "project-a"), {
    archived: 1_400,
    idle: 900,
  });
  const input = {
    activeSessionIDs: [],
    ancestrySessions: {},
    forms: [],
    permissions: [],
    projects: [],
    rootSessions: [before, never, older, newer, archived, archivedBefore],
  };

  const sections = buildFollowedInboxSections({ ...input, recentSince: 1_000 });
  expect(sections.recent.map((row) => row.session.id)).toEqual(["ses_newer", "ses_older"]);
  expect(sections.archived.map((row) => row.session.id)).toEqual(["ses_archived"]);
  expect(sections.archived[0]).toMatchObject({ archived: true, section: "archived" });
  // Until the device knows when its inbox started, nothing finished is listed.
  const unstarted = buildFollowedInboxSections({ ...input, recentSince: undefined });
  expect([...unstarted.recent, ...unstarted.archived]).toEqual([]);
  // Search lists every finished session.
  expect(buildFollowedInboxSections({ ...input, recentSince: "all" }).recent).toHaveLength(4);
});

test("finished rows are done, failed, or ready from the shared viewed time", () => {
  const done = run(session("ses_done", 3, "project-a"), { idle: 20, viewed: 10 });
  const failed = {
    ...run(session("ses_failed", 2, "project-a"), { idle: 20 }),
    outcome: "failed" as const,
  };
  const read = {
    ...run(session("ses_read", 1, "project-a"), { idle: 20, viewed: 20 }),
    outcome: "failed" as const,
  };

  const sections = buildFollowedInboxSections({
    activeSessionIDs: [],
    ancestrySessions: {},
    forms: [],
    permissions: [],
    projects: [],
    recentSince: 0,
    rootSessions: [done, failed, read],
  });

  expect(Object.fromEntries(sections.recent.map((row) => [row.session.id, row.status]))).toEqual({
    ses_done: "done",
    ses_failed: "failed",
    ses_read: "ready",
  });
  expect(isSessionUnread(done)).toBe(true);
  expect(isSessionUnread(read)).toBe(false);
  expect(isSessionUnread(session("ses_never", 1, "project-a"))).toBe(false);
});

test("pages each project back to the inbox start and asks for archived roots", async () => {
  mockListProjectSessions.mockReset();
  mockListProjectSessions.mockImplementation(async (_client, _projectID, input) => {
    const page = Number(input.cursor ?? 0);
    // Each page is ten minutes older than the one before it.
    return {
      cursor: { next: String(page + 1) },
      data: [session(`ses_${page}`, 10_000_000 - page * 600_000, "project-a")],
    };
  });
  const client = {} as OpenCodeClient;

  const page = await fetchFollowedSessionPage(
    client,
    ["project-a"],
    { "project-a": undefined },
    { limit: 30, until: 10_000_000 - 1_000_000 },
  );
  expect(page.responses["project-a"]?.data.map((item) => item.id)).toEqual([
    "ses_0",
    "ses_1",
    "ses_2",
  ]);
  expect(page.cursors).toEqual({ "project-a": "3" });

  mockListProjectSessions.mockClear();
  await fetchFollowedSessionPage(
    client,
    ["project-a"],
    { "project-a": undefined },
    { archived: true, limit: 50 },
  );
  expect(mockListProjectSessions).toHaveBeenCalledTimes(1);
  expect(mockListProjectSessions).toHaveBeenCalledWith(
    client,
    "project-a",
    { archived: true, limit: 50, order: "desc", parentID: null },
    undefined,
  );
});

test("moves a cached session between Recent and Archived", () => {
  const first = session("ses_first", 2, "project-a");
  const page = {
    cursors: {},
    failures: [],
    responses: { "project-a": { cursor: {}, data: [first, session("ses_other", 1, "project-a")] } },
  };

  const archived = setFollowedSessionArchived(page, "ses_first", 50);
  expect(archived.responses["project-a"]?.data[0]?.time.archived).toBe(50);
  expect(archived.responses["project-a"]?.data[1]).toBe(page.responses["project-a"].data[1]);
  const restored = setFollowedSessionArchived(archived, "ses_first", undefined);
  expect(restored.responses["project-a"]?.data[0]?.time).not.toHaveProperty("archived");
  expect(setFollowedSessionArchived(page, "ses_missing", 50)).toBe(page);
});

function run(item: SessionInfo, time: Partial<SessionInfo["time"]>): SessionInfo {
  return { ...item, time: { ...item.time, ...time } };
}

function session(id: string, updated: number, projectID: string): SessionInfo {
  return {
    cost: 0,
    id,
    location: { directory: `/${projectID}` },
    projectID,
    time: { created: updated, updated },
    title: id,
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  };
}
