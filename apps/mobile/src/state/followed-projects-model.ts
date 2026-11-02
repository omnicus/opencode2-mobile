import type {
  FormInfo,
  LocationGetOutput,
  LocationRef,
  OpenCodeClient,
  PermissionRequest,
  ProjectListOutput,
  SessionInfo,
} from "@opencode2-mobile/opencode-adapter";
import { hashKey, type QueryKey } from "@tanstack/react-query";

import type {
  CollapsibleInboxSection,
  SessionInboxPreferences,
} from "../storage/session-inbox-repository";
import {
  type FollowedSessionPageParam,
  locationKey,
  type SessionAncestryResult,
  uniqueLocations,
} from "./followed-project-inbox";

export type AttentionLocationFailure = {
  location: LocationRef;
  projectLabel: string;
  source: "project-root" | "worktree" | "session-history" | "discovered";
  failedChecks: Array<"permissions" | "forms">;
};

export type AttentionCoverage = {
  completeness: "complete" | "incomplete";
  failedLocationCount: number;
  failedLocations: AttentionLocationFailure[];
  failedProjects: Array<{ label: string; locationCount: number; projectID?: string }>;
  freshness: "current" | "reconciling" | "stale";
  knownLocationCount: number;
  reasons: string[];
  reconciledLocationCount: number;
  revision: number;
};

export type HistoricalCandidate = { location: LocationRef; root: LocationRef };

export type InteractionIndex = {
  formLocations: Map<string, LocationRef>;
  forms: Map<string, FormInfo>;
  permissionLocations: Map<string, LocationRef>;
  permissions: Map<string, PermissionRequest>;
};

export type LocationSelection = { connectionKey: string; location: LocationRef };

export type InboxPreferenceState = {
  connectionKey: string;
  preferences: SessionInboxPreferences;
};

type Project = ProjectListOutput[number];
type QueryActivity = { isFetching: boolean; isPending: boolean };
type QueryCheck = { isError: boolean };
type DirectoryProbe = { data: boolean | undefined; isPending: boolean; isSuccess: boolean };
type EventLocations = { failures: number; locations: LocationGetOutput[] };

export const unresolvedConnectionID = "unselected";

export function requireClient(client: OpenCodeClient | undefined) {
  if (!client) throw new Error("CONNECTION_NOT_READY");
  return client;
}

// A reconciliation revision restarts revision-keyed queries under a new key.
// Keep showing the previous snapshot while the new one loads so the inbox does
// not blank out, but only when the leading key parts (connection and scope)
// match. Data never crosses connections or followed-project sets.
export function sameRevisionScope(
  previousKey: QueryKey | undefined,
  key: QueryKey,
  scopeLength: number,
) {
  return Boolean(
    previousKey &&
      hashKey(previousKey.slice(0, scopeLength)) === hashKey(key.slice(0, scopeLength)),
  );
}

export function followedProjectAvailability(
  projects: ProjectListOutput,
  followedProjectIds: readonly string[],
) {
  const projectByID = new Map(projects.map((project) => [project.id, project]));
  return {
    availableFollowedProjectIDs: followedProjectIds.filter((projectID) =>
      projectByID.has(projectID),
    ),
    projectByID,
    unavailableProjectIds: followedProjectIds.filter((projectID) => !projectByID.has(projectID)),
  };
}

export function followedProjectScopeKey(
  connectionKey: string | undefined,
  projectIDs: readonly string[],
) {
  return connectionKey
    ? `${connectionKey}\u0000${[...projectIDs].sort().join("\u0000")}`
    : undefined;
}

export function inboxPreferencesFor(
  state: InboxPreferenceState | undefined,
  connectionKey: string | undefined,
) {
  return state && state.connectionKey === connectionKey ? state.preferences : undefined;
}

export function withSectionExpanded(
  current: InboxPreferenceState | undefined,
  connectionKey: string,
  section: CollapsibleInboxSection,
  expanded: boolean,
) {
  const key = section === "archived" ? "archivedExpanded" : "workingExpanded";
  return current && current.connectionKey === connectionKey
    ? { ...current, preferences: { ...current.preferences, [key]: expanded } }
    : current;
}

// The active list starts at the inbox start: the key records it, and paging stops past it.
export function followedInboxWindow(sinceMs: number | undefined) {
  return sinceMs === undefined
    ? { fetchFilter: {}, keyFilter: {} }
    : { fetchFilter: { until: sinceMs }, keyFilter: { since: sinceMs } };
}

export function initialFollowedSessionPageParam(projectIDs: readonly string[]) {
  return Object.fromEntries(
    projectIDs.map((projectID) => [projectID, undefined]),
  ) as FollowedSessionPageParam;
}

export function initialFollowedProjectID(
  projects: ProjectListOutput,
  defaultProjectID: string | undefined,
) {
  return projects.find((project) => project.id === defaultProjectID)?.id ?? projects[0]?.id;
}

export function nextLocationSelection(
  current: LocationSelection | undefined,
  nextLocation: LocationRef | undefined,
  connectionKey: string | undefined,
) {
  const next =
    nextLocation && connectionKey ? { connectionKey, location: nextLocation } : undefined;
  return current?.connectionKey === next?.connectionKey &&
    current?.location.directory === next?.location.directory &&
    current?.location.workspaceID === next?.location.workspaceID
    ? current
    : next;
}

export function activeLocationStatus(
  activeSessions: { isPending: boolean; isSuccess: boolean },
  activeSessionCount: number,
  ancestry: {
    data: SessionAncestryResult | undefined;
    isPending: boolean;
    isPlaceholderData: boolean;
    isSuccess: boolean;
  },
) {
  return {
    activeLocationsPending:
      activeSessions.isPending ||
      (activeSessionCount > 0 && (ancestry.isPending || ancestry.isPlaceholderData)),
    activeLocationsResolved:
      activeSessions.isSuccess &&
      (activeSessionCount === 0 ||
        (ancestry.isSuccess &&
          !ancestry.isPlaceholderData &&
          ancestry.data?.failures.length === 0)),
  };
}

export function protectedLocationKeys(input: {
  activeAncestrySessions: Record<string, SessionInfo>;
  attentionLocations: readonly LocationRef[];
  location: LocationRef | undefined;
  projectByID: ReadonlyMap<string, Project>;
  projectIDs: readonly string[];
}) {
  return new Set(
    [
      ...input.projectIDs.flatMap((projectID) => {
        const project = input.projectByID.get(projectID);
        return project ? [{ directory: project.canonical }] : [];
      }),
      ...input.attentionLocations,
      ...Object.values(input.activeAncestrySessions).map((session) => session.location),
      ...(input.location ? [input.location] : []),
    ].map(locationKey),
  );
}

export function historicalCandidate(
  candidate: LocationRef,
  input: {
    hasAttention: (candidate: LocationRef) => boolean;
    projectByID: ReadonlyMap<string, Project>;
    projects: ProjectListOutput;
    protectedLocationKeys: ReadonlySet<string>;
    rootSessions: readonly SessionInfo[];
  },
): HistoricalCandidate | undefined {
  if (input.protectedLocationKeys.has(locationKey(candidate)) || candidate.workspaceID)
    return undefined;
  const session = input.rootSessions.find(
    (item) => locationKey(item.location) === locationKey(candidate),
  );
  const projectID = session?.projectID ?? inferLocationProjectID(candidate, input.projects);
  const project = projectID ? input.projectByID.get(projectID) : undefined;
  if (!project) return undefined;
  // Actual attention takes precedence over retirement; generic event locations
  // are discovery hints, not evidence of outstanding work.
  if (input.hasAttention(candidate)) return undefined;
  return { location: candidate, root: { directory: project.canonical } };
}

export function historicalCandidates(
  candidates: readonly LocationRef[],
  findCandidate: (candidate: LocationRef) => HistoricalCandidate | undefined,
) {
  return candidates.flatMap((candidate) => {
    const historical = findCandidate(candidate);
    return historical ? [historical] : [];
  });
}

export function discoverFollowedLocations(input: {
  activeAncestrySessions: Record<string, SessionInfo>;
  attentionLocations: readonly LocationRef[];
  eventLocations: EventLocations | undefined;
  projectByID: ReadonlyMap<string, Project>;
  projectIDs: readonly string[];
  rootSessions: readonly SessionInfo[];
  selectedLocation: LocationGetOutput | undefined;
}) {
  const projectLocations = input.projectIDs.flatMap((projectID) => {
    const project = input.projectByID.get(projectID);
    return project
      ? [project.canonical, ...project.sandboxes].map((directory) => ({ directory }))
      : [];
  });
  return uniqueLocations([
    ...input.attentionLocations,
    ...projectLocations,
    ...input.rootSessions.map((session) => session.location),
    ...Object.values(input.activeAncestrySessions)
      .filter((session) => input.projectIDs.includes(session.projectID))
      .map((session) => session.location),
    ...(input.eventLocations?.locations ?? [])
      .filter((resolved) => input.projectIDs.includes(resolved.project.id))
      .map((resolved) => ({
        directory: resolved.directory,
      })),
    ...(input.selectedLocation && input.projectIDs.includes(input.selectedLocation.project.id)
      ? [
          {
            directory: input.selectedLocation.directory,
          },
        ]
      : []),
  ]);
}

export function directoryProbesByLocation<Probe>(
  candidates: readonly HistoricalCandidate[],
  probes: readonly Probe[],
) {
  return new Map(
    candidates.map((candidate, index) => [locationKey(candidate.location), probes[index]]),
  );
}

export function knownCandidateLocations(
  candidates: readonly LocationRef[],
  probeByLocation: ReadonlyMap<string, DirectoryProbe | undefined>,
  activeLocationsResolved: boolean,
) {
  return candidates.filter((candidate) => {
    const query = probeByLocation.get(locationKey(candidate));
    return !activeLocationsResolved || !query?.isSuccess || query.data !== false;
  });
}

export function canCheckLocationInteractions(
  probe: DirectoryProbe | undefined,
  activeLocationsPending: boolean,
  activeLocationsResolved: boolean,
) {
  return (
    !probe ||
    (!probe.isPending &&
      !activeLocationsPending &&
      !(activeLocationsResolved && probe.data === false))
  );
}

export function createInteractionIndex(): InteractionIndex {
  return {
    formLocations: new Map(),
    forms: new Map(),
    permissionLocations: new Map(),
    permissions: new Map(),
  };
}

// Each location owns a permission query followed by a form query.
export function addLocationInteractions(
  index: InteractionIndex,
  locations: readonly LocationRef[],
  queries: readonly { data: unknown }[],
) {
  for (const [locationIndex, location] of locations.entries()) {
    const permissionResult = queries[locationIndex * 2]?.data as
      | { data: PermissionRequest[] }
      | undefined;
    const formResult = queries[locationIndex * 2 + 1]?.data as { data: FormInfo[] } | undefined;
    for (const request of permissionResult?.data ?? []) {
      index.permissions.set(request.id, request);
      index.permissionLocations.set(request.id, location);
    }
    for (const form of formResult?.data ?? []) {
      index.forms.set(form.id, form);
      index.formLocations.set(form.id, location);
    }
  }
}

export function interactionSessionIDs(index: InteractionIndex) {
  return [
    ...new Set(
      [...index.permissions.values(), ...index.forms.values()]
        .map((interaction) => interaction.sessionID)
        .filter((sessionID) => sessionID !== "global"),
    ),
  ].sort();
}

export function sortedInteractions(index: InteractionIndex) {
  return {
    forms: [...index.forms.values()].sort(compareInteractions),
    permissions: [...index.permissions.values()].sort(compareInteractions),
  };
}

export function supplementalInteractionLocations(
  ancestrySessions: Record<string, SessionInfo>,
  projectIDs: readonly string[],
  knownLocations: readonly LocationRef[],
) {
  const knownLocationKeys = new Set(knownLocations.map(locationKey));
  return uniqueLocations(
    Object.values(ancestrySessions)
      .filter((session) => projectIDs.includes(session.projectID))
      .map((session) => session.location),
  ).filter((candidate) => !knownLocationKeys.has(locationKey(candidate)));
}

export function followedActiveSessionIDs(
  activeSessionIDs: readonly string[],
  ancestrySessions: Record<string, SessionInfo>,
  projectIDs: readonly string[],
) {
  return activeSessionIDs.filter((sessionID) =>
    projectIDs.includes(ancestrySessions[sessionID]?.projectID ?? ""),
  );
}

export function failedInteractionLocations(
  locations: readonly LocationRef[],
  queries: readonly QueryCheck[],
) {
  return locations.filter(
    (_location, index) => queries[index * 2]?.isError || queries[index * 2 + 1]?.isError,
  );
}

export function projectIDsByLocation(input: {
  eventLocations: EventLocations | undefined;
  projects: ProjectListOutput;
  selectedLocation: LocationGetOutput | undefined;
  sessions: readonly SessionInfo[];
}) {
  const projectIDByLocation = new Map<string, string>();
  for (const project of input.projects) {
    for (const directory of [project.canonical, ...project.sandboxes]) {
      projectIDByLocation.set(locationKey({ directory }), project.id);
    }
  }
  for (const session of input.sessions) {
    projectIDByLocation.set(locationKey(session.location), session.projectID);
  }
  for (const resolved of input.eventLocations?.locations ?? []) {
    projectIDByLocation.set(
      locationKey({
        directory: resolved.directory,
      }),
      resolved.project.id,
    );
  }
  if (input.selectedLocation) {
    projectIDByLocation.set(
      locationKey({
        directory: input.selectedLocation.directory,
      }),
      input.selectedLocation.project.id,
    );
  }
  return projectIDByLocation;
}

type FailureLookup = {
  projectByID: ReadonlyMap<string, Project>;
  projectIDByLocation: ReadonlyMap<string, string>;
  projects: ProjectListOutput;
};

function failedLocationProjectID(location: LocationRef, lookup: FailureLookup) {
  return (
    lookup.projectIDByLocation.get(locationKey(location)) ??
    inferLocationProjectID(location, lookup.projects)
  );
}

function failedChecksAt(queries: readonly QueryCheck[], index: number) {
  const failedChecks: AttentionLocationFailure["failedChecks"] = [];
  if (queries[index * 2]?.isError) failedChecks.push("permissions");
  if (queries[index * 2 + 1]?.isError) failedChecks.push("forms");
  return failedChecks;
}

export function locationFailureSource(
  project: Project | undefined,
  location: LocationRef,
  sessionLocationKeys: ReadonlySet<string>,
): AttentionLocationFailure["source"] {
  if (project?.canonical === location.directory) return "project-root";
  if (project?.sandboxes.includes(location.directory)) return "worktree";
  return sessionLocationKeys.has(locationKey(location)) ? "session-history" : "discovered";
}

export function attentionLocationFailures(
  locations: readonly LocationRef[],
  queries: readonly QueryCheck[],
  lookup: FailureLookup & { sessions: readonly SessionInfo[] },
) {
  // UI-only location details stay in memory. Never include paths or raw query
  // errors in the redacted support report or device persistence.
  const sessionLocationKeys = new Set(
    lookup.sessions.map((session) => locationKey(session.location)),
  );
  return locations.flatMap((failedLocation, index): AttentionLocationFailure[] => {
    const failedChecks = failedChecksAt(queries, index);
    if (failedChecks.length === 0) return [];
    const projectID = failedLocationProjectID(failedLocation, lookup);
    const project = projectID ? lookup.projectByID.get(projectID) : undefined;
    return [
      {
        location: failedLocation,
        projectLabel: project ? labelProject(project) : "Unknown project",
        source: locationFailureSource(project, failedLocation, sessionLocationKeys),
        failedChecks,
      },
    ];
  });
}

export function failedProjectSummaries(
  failedLocations: readonly LocationRef[],
  lookup: FailureLookup,
) {
  const failedProjectCounts = new Map<string, number>();
  for (const failedLocation of failedLocations) {
    const key = failedLocationProjectID(failedLocation, lookup) ?? "";
    failedProjectCounts.set(key, (failedProjectCounts.get(key) ?? 0) + 1);
  }
  return [...failedProjectCounts.entries()]
    .map(([projectID, locationCount]) => {
      const project = lookup.projectByID.get(projectID);
      return {
        label: project ? labelProject(project) : "Unknown project",
        locationCount,
        ...(projectID ? { projectID } : {}),
      };
    })
    .sort((first, second) => first.label.localeCompare(second.label));
}

export function isAttentionReconciling(input: {
  activeLocationsPending: boolean;
  defaultLocation: { isPending: boolean };
  directoryQueries: readonly QueryActivity[];
  eventLocationCount: number;
  eventLocationsQuery: { isPending: boolean };
  followedProjectCount: number;
  interactionAncestry: { isPending: boolean; isPlaceholderData: boolean };
  interactionQueries: readonly QueryActivity[];
  interactionSessionCount: number;
  location: LocationRef | undefined;
  preferenceReady: boolean;
  projects: { isPending: boolean };
  selectedLocationQuery: { isPending: boolean };
  sessions: { isPending: boolean; isPlaceholderData: boolean };
}) {
  const interactionPending = input.interactionQueries.some((query) => query.isPending);
  const interactionFetching = input.interactionQueries.some((query) => query.isFetching);
  return (
    input.directoryQueries.some((query) => query.isPending || query.isFetching) ||
    !input.preferenceReady ||
    input.projects.isPending ||
    input.defaultLocation.isPending ||
    (input.followedProjectCount > 0 &&
      (input.sessions.isPending || input.sessions.isPlaceholderData)) ||
    input.activeLocationsPending ||
    (input.eventLocationCount > 0 && input.eventLocationsQuery.isPending) ||
    (Boolean(input.location) && input.selectedLocationQuery.isPending) ||
    interactionPending ||
    interactionFetching ||
    (input.interactionSessionCount > 0 &&
      (input.interactionAncestry.isPending || input.interactionAncestry.isPlaceholderData))
  );
}

export function attentionCoverageReasons(input: {
  activeAncestryFailureCount: number;
  eventLocations: EventLocations | undefined;
  failedLocationCount: number;
  interactionAncestryFailureCount: number;
  location: LocationRef | undefined;
  preferenceLoadFailed: boolean | undefined;
  projectIDs: readonly string[];
  selectedLocationQuery: { data: LocationGetOutput | undefined; isError: boolean };
  sessionProjectFailureCount: number;
  unavailableProjectCount: number;
  unmatchedSessionCount: number;
}) {
  const selectedLocationFailed = Boolean(
    input.location &&
      input.selectedLocationQuery.isError &&
      (!input.selectedLocationQuery.data ||
        input.projectIDs.includes(input.selectedLocationQuery.data.project.id)),
  );
  const checks: Array<[boolean, string]> = [
    [input.unavailableProjectCount > 0, "followed-project-unavailable"],
    [input.sessionProjectFailureCount > 0, "project-session-page-failed"],
    [input.activeAncestryFailureCount > 0, "active-session-metadata-failed"],
    [(input.eventLocations?.failures ?? 0) > 0, "event-location-failed"],
    [selectedLocationFailed, "selected-location-failed"],
    [input.failedLocationCount > 0, "location-interaction-failed"],
    [input.interactionAncestryFailureCount > 0, "interaction-session-metadata-failed"],
    [input.unmatchedSessionCount > 0, "session-parent-unresolved"],
    [Boolean(input.preferenceLoadFailed), "followed-project-preference-failed"],
  ];
  return checks.flatMap(([failed, reason]) => (failed ? [reason] : []));
}

export function attentionFreshness(
  status: string,
  reconciling: boolean,
): AttentionCoverage["freshness"] {
  if (status !== "connected") return "stale";
  return reconciling ? "reconciling" : "current";
}

export function inferLocationProjectID(location: LocationRef, projects: ProjectListOutput) {
  const directory = normalizeDirectory(location.directory);
  let match: { length: number; projectID: string } | undefined;
  for (const project of projects) {
    for (const root of [project.canonical, ...project.sandboxes]) {
      const normalizedRoot = normalizeDirectory(root);
      if (
        (directory === normalizedRoot || directory.startsWith(`${normalizedRoot}/`)) &&
        normalizedRoot.length > (match?.length ?? -1)
      ) {
        match = { length: normalizedRoot.length, projectID: project.id };
      }
    }
  }
  return match?.projectID;
}

function normalizeDirectory(directory: string) {
  const normalized = directory.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized || "/";
}

export function labelProject(project: Project) {
  return (
    project.name?.trim() || project.canonical.split(/[\\/]/).filter(Boolean).at(-1) || project.id
  );
}

function compareInteractions(
  first: { id: string; sessionID: string },
  second: { id: string; sessionID: string },
) {
  return first.sessionID.localeCompare(second.sessionID) || first.id.localeCompare(second.id);
}
