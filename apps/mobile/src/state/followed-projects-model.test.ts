import { expect, jest, test } from "@jest/globals";
import type {
  LocationGetOutput,
  OpenCodeClient,
  ProjectListOutput,
} from "@opencode2-mobile/opencode-adapter";

import { locationKey } from "./followed-project-inbox";
import {
  attentionCoverageReasons,
  failedProjectSummaries,
  followedInboxWindow,
  inboxPreferencesFor,
  initialFollowedProjectID,
  labelProject,
  locationFailureSource,
  nextLocationSelection,
  requireClient,
  withSectionExpanded,
} from "./followed-projects-model";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({}));

const alpha = {
  canonical: "/work/alpha",
  id: "project-a",
  name: "Alpha",
  sandboxes: ["/work/alpha-tree"],
  time: { active: 1, created: 1, updated: 1 },
} satisfies ProjectListOutput[number];
const beta = {
  canonical: "C:\\work\\beta\\",
  id: "project-b",
  sandboxes: [],
  time: { active: 1, created: 1, updated: 1 },
} satisfies ProjectListOutput[number];
const projects: ProjectListOutput = [alpha, beta];
const projectByID = new Map(projects.map((project) => [project.id, project]));

test("rejects queries before the connection has a client", () => {
  const client = {} as OpenCodeClient;
  expect(requireClient(client)).toBe(client);
  expect(() => requireClient(undefined)).toThrow("CONNECTION_NOT_READY");
});

test("keeps inbox preferences to the connection that loaded them", () => {
  const state = {
    connectionKey: "connection",
    preferences: { archivedExpanded: true, sinceMs: 1, workingExpanded: true },
  };
  expect(inboxPreferencesFor(state, "connection")).toBe(state.preferences);
  expect(inboxPreferencesFor(state, "other")).toBeUndefined();
  expect(inboxPreferencesFor(undefined, "connection")).toBeUndefined();
  expect(withSectionExpanded(state, "connection", "working", false)).toEqual({
    connectionKey: "connection",
    preferences: { archivedExpanded: true, sinceMs: 1, workingExpanded: false },
  });
  expect(withSectionExpanded(state, "connection", "archived", false)).toEqual({
    connectionKey: "connection",
    preferences: { archivedExpanded: false, sinceMs: 1, workingExpanded: true },
  });
  expect(withSectionExpanded(state, "other", "working", false)).toBe(state);
  expect(withSectionExpanded(undefined, "connection", "working", false)).toBeUndefined();
});

test("limits the active list to the inbox start once it is known", () => {
  expect(followedInboxWindow(undefined)).toEqual({ fetchFilter: {}, keyFilter: {} });
  expect(followedInboxWindow(1_000)).toEqual({
    fetchFilter: { until: 1_000 },
    keyFilter: { since: 1_000 },
  });
});

test("prefers the default project for the first follow", () => {
  expect(initialFollowedProjectID(projects, "project-b")).toBe("project-b");
  expect(initialFollowedProjectID(projects, "project-missing")).toBe("project-a");
  expect(initialFollowedProjectID([], undefined)).toBeUndefined();
});

test("keeps the current selection when the location is unchanged", () => {
  const current = { connectionKey: "connection", location: { directory: "/work/alpha" } };
  expect(nextLocationSelection(current, { directory: "/work/alpha" }, "connection")).toBe(current);
  expect(nextLocationSelection(current, { directory: "/work/beta" }, "connection")).toEqual({
    connectionKey: "connection",
    location: { directory: "/work/beta" },
  });
  expect(
    nextLocationSelection(current, { directory: "/work/alpha", workspaceID: "wrk" }, "connection"),
  ).toEqual({
    connectionKey: "connection",
    location: { directory: "/work/alpha", workspaceID: "wrk" },
  });
  expect(nextLocationSelection(current, undefined, "connection")).toBeUndefined();
  expect(nextLocationSelection(undefined, { directory: "/work/alpha" }, undefined)).toBeUndefined();
  expect(nextLocationSelection(undefined, undefined, undefined)).toBeUndefined();
});

test("labels projects by name, then directory, then ID", () => {
  expect(labelProject(alpha)).toBe("Alpha");
  expect(labelProject(beta)).toBe("beta");
  expect(labelProject({ ...beta, canonical: "/", name: "  " })).toBe("project-b");
});

test("classifies where a failed location came from", () => {
  const sessionKeys = new Set([locationKey({ directory: "/work/alpha/session" })]);
  expect(locationFailureSource(alpha, { directory: "/work/alpha" }, sessionKeys)).toBe(
    "project-root",
  );
  expect(locationFailureSource(alpha, { directory: "/work/alpha-tree" }, sessionKeys)).toBe(
    "worktree",
  );
  expect(locationFailureSource(alpha, { directory: "/work/alpha/session" }, sessionKeys)).toBe(
    "session-history",
  );
  expect(locationFailureSource(undefined, { directory: "/elsewhere" }, sessionKeys)).toBe(
    "discovered",
  );
});

test("groups failed locations by inferred project with an unknown fallback", () => {
  expect(
    failedProjectSummaries(
      [
        { directory: "/work/alpha/nested" },
        { directory: "C:/work/beta/sub" },
        { directory: "/unknown" },
        { directory: "/work/alpha-tree" },
      ],
      { projectByID, projectIDByLocation: new Map(), projects },
    ),
  ).toEqual([
    { label: "Alpha", locationCount: 2, projectID: "project-a" },
    { label: "beta", locationCount: 1, projectID: "project-b" },
    { label: "Unknown project", locationCount: 1 },
  ]);
});

test("reports each incomplete coverage reason in a stable order", () => {
  const complete: Parameters<typeof attentionCoverageReasons>[0] = {
    activeAncestryFailureCount: 0,
    eventLocations: undefined,
    failedLocationCount: 0,
    interactionAncestryFailureCount: 0,
    location: undefined,
    preferenceLoadFailed: false,
    projectIDs: ["project-a"],
    selectedLocationQuery: { data: undefined, isError: true },
    sessionProjectFailureCount: 0,
    unavailableProjectCount: 0,
    unmatchedSessionCount: 0,
  };
  expect(attentionCoverageReasons(complete)).toEqual([]);
  expect(
    attentionCoverageReasons({
      activeAncestryFailureCount: 1,
      eventLocations: { failures: 1, locations: [] },
      failedLocationCount: 1,
      interactionAncestryFailureCount: 1,
      location: { directory: "/work/alpha" },
      preferenceLoadFailed: true,
      projectIDs: ["project-a"],
      selectedLocationQuery: { data: undefined, isError: true },
      sessionProjectFailureCount: 1,
      unavailableProjectCount: 1,
      unmatchedSessionCount: 1,
    }),
  ).toEqual([
    "followed-project-unavailable",
    "project-session-page-failed",
    "active-session-metadata-failed",
    "event-location-failed",
    "selected-location-failed",
    "location-interaction-failed",
    "interaction-session-metadata-failed",
    "session-parent-unresolved",
    "followed-project-preference-failed",
  ]);
  const selectedLocation = {
    directory: "/outside",
    project: { canonical: "/outside", directory: "/outside", id: "project-outside" },
  } as LocationGetOutput;
  expect(
    attentionCoverageReasons({
      ...complete,
      location: { directory: "/outside" },
      selectedLocationQuery: { data: selectedLocation, isError: true },
    }),
  ).toEqual([]);
});
