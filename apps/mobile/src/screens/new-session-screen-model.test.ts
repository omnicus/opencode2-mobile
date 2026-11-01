import { expect, test } from "@jest/globals";

import {
  createSessionFailure,
  creatingLocationKey,
  emptyProjectListCopy,
  matchingProjects,
  orderProjects,
  type Project,
  projectBrowserState,
  projectLabel,
  projectLocations,
  projectRows,
} from "./new-session-screen-model";

function project(id: string, canonical = `/projects/${id}`, sandboxes: string[] = []): Project {
  return { canonical, id, sandboxes, time: { active: 1, created: 1, updated: 1 } };
}

test("orders followed projects by follow order before the server order", () => {
  const projects = [project("a"), project("b"), project("c"), project("d")];

  expect(orderProjects(projects, ["d", "b"]).map(({ id }) => id)).toEqual(["d", "b", "a", "c"]);
});

test("matches projects by label, path, worktree, and id", () => {
  const projects = [project("alpha"), project("beta", "/projects/beta", ["/worktrees/feature"])];

  expect(matchingProjects(projects, "")).toBe(projects);
  expect(matchingProjects(projects, "feature").map(({ id }) => id)).toEqual(["beta"]);
  expect(matchingProjects(projects, "missing")).toEqual([]);
});

test("builds followed and other project sections", () => {
  const projects = [project("a"), project("b")];
  const followed = new Set(["a"]);

  expect(projectRows(projects, followed, false).map(({ id }) => id)).toEqual([
    "section-followed",
    "project-a",
  ]);
  expect(projectRows(projects, followed, true).map(({ id }) => id)).toEqual([
    "section-followed",
    "project-a",
    "section-other",
    "project-b",
  ]);
  expect(projectRows(projects, new Set(), false)).toEqual([]);
});

test("labels projects by name, final path segment, then id", () => {
  expect(projectLabel({ canonical: "/projects/alpha", id: "a", name: " Alpha " })).toBe("Alpha");
  expect(projectLabel({ canonical: "C:\\work\\beta\\", id: "b", name: " " })).toBe("beta");
  expect(projectLabel({ canonical: "/", id: "root" })).toBe("root");
});

test("offers the main directory, the server directory, and remaining worktrees", () => {
  const beta = project("beta", "/projects/beta", ["/worktrees/current", "/worktrees/other/"]);
  const defaultLocation = {
    directory: "/worktrees/current",
    project: { canonical: beta.canonical, directory: beta.canonical, id: beta.id },
  };

  expect(projectLocations(undefined, defaultLocation)).toEqual([]);
  expect(
    projectLocations(beta, defaultLocation).map(({ label, location }) => [label, location]),
  ).toEqual([
    ["Main directory", { directory: "/projects/beta" }],
    ["Server's working directory", { directory: "/worktrees/current" }],
    ["other", { directory: "/worktrees/other/" }],
  ]);
  expect(
    projectLocations(beta, { ...defaultLocation, directory: beta.canonical }).map(
      ({ label }) => label,
    ),
  ).toEqual(["Main directory", "current", "other"]);
  expect(projectLocations(beta, undefined).map(({ key }) => key)).toEqual([
    "/projects/beta\u0000",
    "/worktrees/current\u0000",
    "/worktrees/other/\u0000",
  ]);
  expect(
    projectLocations(project("root", "/projects/root", ["/"]), undefined).map(({ label }) => label),
  ).toEqual(["Main directory", "/"]);
});

test("finds the location being created for the shown project", () => {
  const alpha = project("alpha");
  const requested = { directory: "/worktrees/alpha", workspaceID: "workspace-alpha" };

  expect(creatingLocationKey(undefined, alpha)).toBeUndefined();
  expect(creatingLocationKey({ project: project("beta"), requested }, alpha)).toBeUndefined();
  expect(creatingLocationKey({ project: alpha, requested }, alpha)).toBe(
    "/worktrees/alpha\u0000workspace-alpha",
  );
});

test("chooses the project browser state in loading, error, empty, list order", () => {
  expect(projectBrowserState({ loadFailed: true, loading: true, projectCount: 0 })).toBe("loading");
  expect(projectBrowserState({ loadFailed: true, loading: false, projectCount: 1 })).toBe("error");
  expect(projectBrowserState({ loadFailed: false, loading: false, projectCount: 0 })).toBe("empty");
  expect(projectBrowserState({ loadFailed: false, loading: false, projectCount: 2 })).toBe(
    "projects",
  );
});

test("describes an empty project list with or without a search", () => {
  expect(emptyProjectListCopy(true, "  Gamma ")).toEqual({
    copy: "Try a project name or path.",
    title: 'No projects match "Gamma"',
  });
  expect(emptyProjectListCopy(false, " ")).toEqual({
    copy: "Browse server projects to start a session.",
    title: "No followed projects",
  });
});

test("classifies session creation failures", () => {
  expect(createSessionFailure(new Error("REQUEST_ABORTED"))).toBe("aborted");
  expect(createSessionFailure(new Error("LOCATION_PROJECT_MISMATCH"))).toBe("project-changed");
  expect(createSessionFailure(new Error("boom"))).toBe("failed");
  expect(createSessionFailure("REQUEST_ABORTED")).toBe("failed");
});
