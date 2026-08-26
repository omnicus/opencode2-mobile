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
  nextFollowedSessionPageParam,
  stabilizeFollowedInboxSections,
  uniqueLocations,
} from "./followed-project-inbox";

type ListProjectSessionsCall = (
  client: OpenCodeClient,
  projectID: string,
  input: { cursor?: string },
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
        time: { created: 1, updated: 1 },
      },
      { canonical: "/b", id: "project-b", sandboxes: [], time: { created: 1, updated: 1 } },
    ],
    rootSessions: [root, recent],
  });

  expect(sections.needsYou).toHaveLength(1);
  expect(sections.needsYou[0]).toMatchObject({
    active: true,
    activeChildCount: 1,
    attentionCount: 2,
    projectLabel: "Alpha",
    targetLocation: child.location,
    targetSessionID: "ses_child",
  });
  expect(sections.needsYou[0]?.children).toMatchObject([
    { active: true, attentionCount: 2, session: { id: "ses_child" } },
  ]);
  expect(sections.working).toEqual([]);
  expect(sections.recent.map((row) => row.session.id)).toEqual(["ses_recent"]);
  expect(
    [...sections.needsYou, ...sections.working, ...sections.recent].map((row) => row.session.id),
  ).toEqual(["ses_root", "ses_recent"]);
});

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
      { canonical: "/a", id: "project-a", sandboxes: [], time: { created: 1, updated: 1 } },
    ],
    rootSessions: [],
  });

  expect(sections.working.map((row) => row.session.id)).toEqual(["ses_orphan", "ses_older_root"]);
  expect(sections.unmatchedSessionIDs).toEqual([]);
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
    rootSessions: [root],
  });

  expect(sections.unmatchedSessionIDs).toEqual([]);
  expect(sections.recent.map((row) => row.session.id)).toEqual([root.id]);
});

test("keeps existing priority rows stable while their server timestamps change", () => {
  const first = session("ses_first", 1, "project-a");
  const second = session("ses_second", 2, "project-a");
  const previous = buildFollowedInboxSections({
    activeSessionIDs: [first.id, second.id],
    ancestrySessions: { [first.id]: first, [second.id]: second },
    forms: [],
    permissions: [],
    projects: [],
    rootSessions: [first, second],
  });
  const next = buildFollowedInboxSections({
    activeSessionIDs: [first.id, second.id],
    ancestrySessions: {
      [first.id]: { ...first, time: { created: 1, updated: 4 } },
      [second.id]: second,
    },
    forms: [],
    permissions: [],
    projects: [],
    rootSessions: [{ ...first, time: { created: 1, updated: 4 } }, second],
  });

  expect(
    stabilizeFollowedInboxSections(next, previous).working.map((row) => row.session.id),
  ).toEqual(["ses_second", "ses_first"]);
});

test("keeps existing recent rows stable across competing timestamp updates", () => {
  const first = session("ses_first", 1, "project-a");
  const second = session("ses_second", 2, "project-a");
  const previous = buildFollowedInboxSections({
    activeSessionIDs: [],
    ancestrySessions: {},
    forms: [],
    permissions: [],
    projects: [],
    rootSessions: [first, second],
  });
  const firstUpdate = buildFollowedInboxSections({
    activeSessionIDs: [],
    ancestrySessions: {},
    forms: [],
    permissions: [],
    projects: [],
    rootSessions: [{ ...first, time: { created: 1, updated: 3 } }, second],
  });
  const firstStableUpdate = stabilizeFollowedInboxSections(firstUpdate, previous);
  const secondUpdate = buildFollowedInboxSections({
    activeSessionIDs: [],
    ancestrySessions: {},
    forms: [],
    permissions: [],
    projects: [],
    rootSessions: [
      { ...first, time: { created: 1, updated: 3 } },
      { ...second, time: { created: 2, updated: 4 } },
    ],
  });

  expect(firstStableUpdate.recent.map((row) => row.session.id)).toEqual([
    "ses_second",
    "ses_first",
  ]);
  expect(
    stabilizeFollowedInboxSections(secondUpdate, firstStableUpdate).recent.map(
      (row) => row.session.id,
    ),
  ).toEqual(["ses_second", "ses_first"]);
});

test("inserts newly discovered sessions by recency without reordering existing rows", () => {
  const first = session("ses_first", 3, "project-a");
  const second = session("ses_second", 2, "project-a");
  const previous = buildFollowedInboxSections({
    activeSessionIDs: [],
    ancestrySessions: {},
    forms: [],
    permissions: [],
    projects: [],
    rootSessions: [first, second],
  });
  const next = buildFollowedInboxSections({
    activeSessionIDs: [],
    ancestrySessions: {},
    forms: [],
    permissions: [],
    projects: [],
    rootSessions: [
      session("ses_new", 4, "project-a"),
      first,
      second,
      session("ses_older", 1, "project-a"),
    ],
  });

  expect(
    stabilizeFollowedInboxSections(next, previous).recent.map((row) => row.session.id),
  ).toEqual(["ses_new", "ses_first", "ses_second", "ses_older"]);
});

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
