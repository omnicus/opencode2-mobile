import { expect, test } from "@jest/globals";

import { openCodeQueryKeys } from "./open-code-query-keys";

test("scopes every key by connection and explicit location", () => {
  const location = { directory: "/workspace", workspaceID: "wrk_test" };

  expect(openCodeQueryKeys.health("connection-1")).toEqual(["opencode", "connection-1", "health"]);
  expect(
    openCodeQueryKeys.sessions("connection-1", location, { limit: 50, order: "desc" }),
  ).toEqual([
    "opencode",
    "connection-1",
    "location",
    "/workspace",
    "wrk_test",
    "sessions",
    50,
    "desc",
    null,
    "parent:any",
  ]);
});

test("does not collide across connections or workspace locations", () => {
  const first = openCodeQueryKeys.permissions("connection-1", { directory: "/workspace" });
  const second = openCodeQueryKeys.permissions("connection-2", { directory: "/workspace" });
  const workspace = openCodeQueryKeys.permissions("connection-1", {
    directory: "/workspace",
    workspaceID: "wrk_test",
  });

  expect(first).not.toEqual(second);
  expect(first).not.toEqual(workspace);
});

test("separates working-tree and branch diffs within one location", () => {
  const location = { directory: "/workspace", workspaceID: "wrk_test" };
  expect(openCodeQueryKeys.vcsDiff("connection-1", location, "working")).toEqual([
    "opencode",
    "connection-1",
    "location",
    "/workspace",
    "wrk_test",
    "vcs-diff",
    "working",
  ]);
  expect(openCodeQueryKeys.vcsDiff("connection-1", location, "working")).not.toEqual(
    openCodeQueryKeys.vcsDiff("connection-1", location, "branch"),
  );
});

test("keeps all-parent and root-session list parameters distinct", () => {
  const location = { directory: "/workspace" };
  expect(openCodeQueryKeys.sessions("connection-1", location, {})).not.toEqual(
    openCodeQueryKeys.sessions("connection-1", location, { parentID: null }),
  );
});

test("scopes followed project pages by ordered projects and reconciliation revision", () => {
  expect(
    openCodeQueryKeys.followedProjectSessions(
      "connection-1",
      ["project-b", "project-a"],
      { limit: 30, order: "desc", parentID: null },
      4,
    ),
  ).toEqual([
    "opencode",
    "connection-1",
    "followed-project-sessions",
    ["project-b", "project-a"],
    30,
    "desc",
    null,
    "parent:root",
    4,
  ]);
});

test("scopes default locations and session details without losing location identity", () => {
  expect(openCodeQueryKeys.defaultLocation("connection-1")).toEqual([
    "opencode",
    "connection-1",
    "location-default",
  ]);
  expect(
    openCodeQueryKeys.session(
      "connection-1",
      { directory: "/workspace", workspaceID: "wrk_test" },
      "ses_test",
    ),
  ).toEqual([
    "opencode",
    "connection-1",
    "location",
    "/workspace",
    "wrk_test",
    "sessions",
    "detail",
    "ses_test",
  ]);
});

test("keeps transcript parameters location-scoped but separate from metadata", () => {
  expect(
    openCodeQueryKeys.messages(
      "connection-1",
      { directory: "/workspace", workspaceID: "wrk_test" },
      "ses_test",
      { limit: 50, order: "desc" },
    ),
  ).toEqual([
    "opencode",
    "connection-1",
    "location",
    "/workspace",
    "wrk_test",
    "messages",
    "ses_test",
    50,
    "desc",
  ]);
});

test("scopes inbox and local admission state to one session", () => {
  const location = { directory: "/workspace", workspaceID: "wrk_test" };

  expect(openCodeQueryKeys.inbox("connection-1", location, "ses_test")).toEqual([
    "opencode",
    "connection-1",
    "location",
    "/workspace",
    "wrk_test",
    "inbox",
    "ses_test",
  ]);
  expect(openCodeQueryKeys.promptAdmissions("connection-1", location, "ses_test")).toEqual([
    "opencode",
    "connection-1",
    "location",
    "/workspace",
    "wrk_test",
    "prompt-admissions",
    "ses_test",
  ]);
});
