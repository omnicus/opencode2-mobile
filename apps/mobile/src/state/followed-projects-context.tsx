import {
  type FormInfo,
  getDefaultOpenCodeLocation,
  getOpenCodeLocation,
  type LocationRef,
  listActiveOpenCodeSessions,
  listOpenCodeFormRequests,
  listOpenCodePermissionRequests,
  listOpenCodeProjects,
  type OpenCodeClient,
  type PermissionReply,
  type PermissionRequest,
  replyOpenCodePermissionRequest,
} from "@opencode2-mobile/opencode-adapter";
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  hasFollowedProjectPreference,
  readFollowedProjectIds,
  replaceFollowedProjectIds,
} from "../storage/followed-project-repository";
import { useConnectionRuntime } from "./connection-runtime-context";
import {
  buildFollowedInboxSections,
  type FollowedInboxSections,
  type FollowedSessionPageParam,
  failedFollowedSessionProjects,
  fetchFollowedSessionPage,
  flattenFollowedSessionPages,
  loadSessionAncestries,
  locationKey,
  nextFollowedSessionPageParam,
  stabilizeFollowedInboxSections,
  uniqueLocations,
} from "./followed-project-inbox";
import { openCodeQueryKeys } from "./open-code-query-keys";

const sessionPageSize = 30;
const unresolvedConnectionID = "unselected";

export type AttentionCoverage = {
  completeness: "complete" | "incomplete";
  failedLocationCount: number;
  failedProjects: Array<{ label: string; locationCount: number; projectID?: string }>;
  freshness: "current" | "reconciling" | "stale";
  knownLocationCount: number;
  reasons: string[];
  reconciledLocationCount: number;
  revision: number;
};

type FollowedProjectsContextValue = {
  attentionCoverage: AttentionCoverage;
  blockedSessionIds: ReadonlySet<string>;
  fetchNextPage: () => Promise<unknown>;
  followedProjectIds: string[];
  formLocations: ReadonlyMap<string, LocationRef>;
  forms: FormInfo[];
  hasNextPage: boolean;
  inbox: FollowedInboxSections;
  interactionsError: boolean;
  interactionsLoading: boolean;
  location?: LocationRef;
  pendingCount: number;
  permissionReplyError: boolean;
  permissions: PermissionRequest[];
  preferencesLoading: boolean;
  preferencesError: boolean;
  preferencesSaving: boolean;
  projects: Awaited<ReturnType<typeof listOpenCodeProjects>>;
  projectsError: boolean;
  projectsLoading: boolean;
  refetch: () => Promise<unknown>;
  replyPermission: (requestID: string, sessionID: string, reply: PermissionReply) => void;
  replyingPermissionId?: string;
  search: string;
  sessionsError: boolean;
  sessionsLoading: boolean;
  setFollowedProjectIds: (projectIDs: readonly string[]) => Promise<void>;
  setLocation: (location: LocationRef | undefined) => void;
  setSearch: (search: string) => void;
  unavailableProjectIds: string[];
};

const FollowedProjectsContext = createContext<FollowedProjectsContextValue | undefined>(undefined);

export function FollowedProjectsProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const runtime = useConnectionRuntime();
  const queryClient = useQueryClient();
  const connectionID = runtime.connectionId;
  const connectionKey = connectionID
    ? `${connectionID}\u0000${runtime.connectionUpdatedAtMs ?? 0}`
    : undefined;
  const latestConnectionKeyRef = useRef(connectionKey);
  latestConnectionKeyRef.current = connectionKey;
  const client = runtime.restClient;
  const revision = runtime.reconciliationRevision;
  const [preferenceState, setPreferenceState] = useState<{
    connectionKey: string;
    hasPreference: boolean;
    loadFailed: boolean;
    projectIDs: string[];
  }>();
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const inboxOrderRef = useRef<{
    connectionKey: string | undefined;
    inbox: FollowedInboxSections;
  }>(undefined);
  const discoveredLocationsRef = useRef<{
    scopeKey: string | undefined;
    locations: LocationRef[];
  }>({ scopeKey: undefined, locations: [] });
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<{
    connectionKey: string;
    location: LocationRef;
  }>();
  const preferenceReady = Boolean(
    connectionKey && preferenceState?.connectionKey === connectionKey,
  );
  const followedProjectIds = preferenceReady ? (preferenceState?.projectIDs ?? []) : [];
  const location =
    selection && selection.connectionKey === connectionKey ? selection.location : undefined;

  useEffect(() => {
    setPreferenceState(undefined);
    setPreferencesSaving(false);
    setSearch("");
    setSelection(undefined);
    if (!connectionID || !connectionKey) return;
    let active = true;
    Promise.all([
      readFollowedProjectIds(db, connectionID),
      hasFollowedProjectPreference(db, connectionID),
    ])
      .then(([projectIDs, hasPreference]) => {
        if (active) {
          setPreferenceState({ connectionKey, hasPreference, loadFailed: false, projectIDs });
        }
      })
      .catch(() => {
        if (active) {
          setPreferenceState({
            connectionKey,
            hasPreference: true,
            loadFailed: true,
            projectIDs: [],
          });
        }
      });
    return () => {
      active = false;
    };
  }, [connectionID, connectionKey, db]);

  const projectsQuery = useQuery({
    enabled: Boolean(client && connectionID),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return listOpenCodeProjects(client, { signal });
    },
    queryKey: openCodeQueryKeys.projects(connectionID ?? unresolvedConnectionID),
  });
  const defaultLocationQuery = useQuery({
    enabled: Boolean(client && connectionID),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getDefaultOpenCodeLocation(client, { signal });
    },
    queryKey: openCodeQueryKeys.defaultLocation(connectionID ?? unresolvedConnectionID),
  });
  const projects = projectsQuery.data ?? [];

  useEffect(() => {
    if (
      !connectionID ||
      !connectionKey ||
      !preferenceReady ||
      preferenceState?.hasPreference !== false ||
      projects.length === 0 ||
      preferencesSaving
    ) {
      return;
    }
    const initialProjectID =
      projects.find((project) => project.id === defaultLocationQuery.data?.project.id)?.id ??
      projects[0]?.id;
    if (!initialProjectID) return;
    setPreferencesSaving(true);
    void replaceFollowedProjectIds(
      db,
      connectionID,
      [initialProjectID],
      runtime.connectionUpdatedAtMs,
    )
      .then(() => {
        if (latestConnectionKeyRef.current !== connectionKey) return;
        setPreferenceState({
          connectionKey,
          hasPreference: true,
          loadFailed: false,
          projectIDs: [initialProjectID],
        });
      })
      .catch(() => {
        if (latestConnectionKeyRef.current !== connectionKey) return;
        setPreferenceState({
          connectionKey,
          hasPreference: true,
          loadFailed: true,
          projectIDs: [],
        });
      })
      .finally(() => {
        if (latestConnectionKeyRef.current === connectionKey) setPreferencesSaving(false);
      });
  }, [
    connectionID,
    connectionKey,
    db,
    defaultLocationQuery.data?.project.id,
    preferenceReady,
    preferenceState?.hasPreference,
    preferencesSaving,
    projects,
    runtime.connectionUpdatedAtMs,
  ]);

  const projectByID = new Map(projects.map((project) => [project.id, project]));
  const availableFollowedProjectIDs = followedProjectIds.filter((projectID) =>
    projectByID.has(projectID),
  );
  const unavailableProjectIds = followedProjectIds.filter(
    (projectID) => !projectByID.has(projectID),
  );
  const followedScopeKey = connectionKey
    ? `${connectionKey}\u0000${[...availableFollowedProjectIDs].sort().join("\u0000")}`
    : undefined;
  const initialPageParam = Object.fromEntries(
    availableFollowedProjectIDs.map((projectID) => [projectID, undefined]),
  ) as FollowedSessionPageParam;
  const sessionsQuery = useInfiniteQuery({
    enabled: Boolean(
      client && connectionID && preferenceReady && availableFollowedProjectIDs.length,
    ),
    getNextPageParam: nextFollowedSessionPageParam,
    initialPageParam,
    queryFn: ({ pageParam, signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return fetchFollowedSessionPage(client, availableFollowedProjectIDs, pageParam, {
        limit: sessionPageSize,
        signal,
      });
    },
    queryKey: openCodeQueryKeys.followedProjectSessions(
      connectionID ?? unresolvedConnectionID,
      availableFollowedProjectIDs,
      { limit: sessionPageSize, order: "desc", parentID: null },
      revision,
    ),
  });
  const normalizedSearch = search.trim();
  const searchSessionsQuery = useInfiniteQuery({
    enabled: Boolean(
      client &&
        connectionID &&
        preferenceReady &&
        availableFollowedProjectIDs.length &&
        normalizedSearch,
    ),
    getNextPageParam: nextFollowedSessionPageParam,
    initialPageParam,
    queryFn: ({ pageParam, signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return fetchFollowedSessionPage(client, availableFollowedProjectIDs, pageParam, {
        limit: sessionPageSize,
        search: normalizedSearch,
        signal,
      });
    },
    queryKey: openCodeQueryKeys.followedProjectSessions(
      connectionID ?? unresolvedConnectionID,
      availableFollowedProjectIDs,
      {
        limit: sessionPageSize,
        order: "desc",
        parentID: null,
        search: normalizedSearch,
      },
      revision,
    ),
  });
  const rootSessions = flattenFollowedSessionPages(sessionsQuery.data?.pages);
  const visibleRootSessions = normalizedSearch
    ? flattenFollowedSessionPages(searchSessionsQuery.data?.pages)
    : rootSessions;

  const activeSessionsQuery = useQuery({
    enabled: Boolean(client && connectionID),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return listActiveOpenCodeSessions(client, { signal });
    },
    queryKey: openCodeQueryKeys.activeSessions(connectionID ?? unresolvedConnectionID),
  });
  const activeSessionIDs = Object.keys(activeSessionsQuery.data ?? {}).sort();
  const activeAncestryQuery = useQuery({
    enabled: Boolean(client && connectionID && activeSessionIDs.length),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return loadSessionAncestries(client, activeSessionIDs, signal);
    },
    queryKey: openCodeQueryKeys.sessionAncestries(
      connectionID ?? unresolvedConnectionID,
      "active",
      activeSessionIDs,
      revision,
    ),
  });

  const eventLocations = uniqueLocations(runtime.eventLocations);
  const eventLocationsQuery = useQuery({
    enabled: Boolean(client && connectionID && eventLocations.length),
    queryFn: async ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      const settled = await Promise.allSettled(
        eventLocations.map((eventLocation) =>
          getOpenCodeLocation(client, eventLocation, { signal }),
        ),
      );
      return {
        failures: settled.filter((result) => result.status === "rejected").length,
        locations: settled.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        ),
      };
    },
    queryKey: openCodeQueryKeys.eventLocations(
      connectionID ?? unresolvedConnectionID,
      eventLocations,
      revision,
    ),
  });
  const selectedLocationQuery = useQuery({
    enabled: Boolean(client && connectionID && location),
    queryFn: ({ signal }) => {
      if (!client || !location) throw new Error("LOCATION_NOT_RESOLVED");
      return getOpenCodeLocation(client, location, { signal });
    },
    queryKey: openCodeQueryKeys.resolvedLocation(
      connectionID ?? unresolvedConnectionID,
      location ?? { directory: "unselected" },
    ),
  });

  const projectLocations = availableFollowedProjectIDs.flatMap((projectID) => {
    const project = projectByID.get(projectID);
    return project
      ? [project.canonical, ...project.sandboxes].map((directory) => ({ directory }))
      : [];
  });
  const discoveredLocations = uniqueLocations([
    ...runtime.attentionLocations,
    ...projectLocations,
    ...rootSessions.map((session) => session.location),
    ...Object.values(activeAncestryQuery.data?.sessions ?? {})
      .filter((session) => availableFollowedProjectIDs.includes(session.projectID))
      .map((session) => session.location),
    ...(eventLocationsQuery.data?.locations ?? [])
      .filter((resolved) => availableFollowedProjectIDs.includes(resolved.project.id))
      .map((resolved) => ({
        directory: resolved.directory,
        ...(resolved.workspaceID ? { workspaceID: resolved.workspaceID } : {}),
      })),
    ...(selectedLocationQuery.data &&
    availableFollowedProjectIDs.includes(selectedLocationQuery.data.project.id)
      ? [
          {
            directory: selectedLocationQuery.data.directory,
            ...(selectedLocationQuery.data.workspaceID
              ? { workspaceID: selectedLocationQuery.data.workspaceID }
              : {}),
          },
        ]
      : []),
  ]);
  const previousLocations =
    discoveredLocationsRef.current.scopeKey === followedScopeKey
      ? discoveredLocationsRef.current.locations
      : [];
  const knownLocations = uniqueLocations([...previousLocations, ...discoveredLocations]);
  discoveredLocationsRef.current = { scopeKey: followedScopeKey, locations: knownLocations };
  const interactionQueries = useQueries({
    queries: knownLocations.flatMap((knownLocation) => [
      {
        enabled: Boolean(client && connectionID),
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!client) throw new Error("CONNECTION_NOT_READY");
          return listOpenCodePermissionRequests(client, knownLocation, { signal });
        },
        queryKey: openCodeQueryKeys.permissions(
          connectionID ?? unresolvedConnectionID,
          knownLocation,
        ),
      },
      {
        enabled: Boolean(client && connectionID),
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!client) throw new Error("CONNECTION_NOT_READY");
          return listOpenCodeFormRequests(client, knownLocation, { signal });
        },
        queryKey: openCodeQueryKeys.forms(connectionID ?? unresolvedConnectionID, knownLocation),
      },
    ]),
  });
  const permissionsByID = new Map<string, PermissionRequest>();
  const formsByID = new Map<string, FormInfo>();
  const formLocations = new Map<string, LocationRef>();
  const permissionLocations = new Map<string, LocationRef>();
  for (const [locationIndex, knownLocation] of knownLocations.entries()) {
    const permissionResult = interactionQueries[locationIndex * 2]?.data as
      | { data: PermissionRequest[] }
      | undefined;
    const formResult = interactionQueries[locationIndex * 2 + 1]?.data as
      | { data: FormInfo[] }
      | undefined;
    for (const request of permissionResult?.data ?? []) {
      permissionsByID.set(request.id, request);
      permissionLocations.set(request.id, knownLocation);
    }
    for (const form of formResult?.data ?? []) {
      formsByID.set(form.id, form);
      formLocations.set(form.id, knownLocation);
    }
  }
  const initialInteractions = [...permissionsByID.values(), ...formsByID.values()];
  const interactionSessionIDs = [
    ...new Set(
      initialInteractions
        .map((interaction) => interaction.sessionID)
        .filter((sessionID) => sessionID !== "global"),
    ),
  ].sort();
  const interactionAncestryQuery = useQuery({
    enabled: Boolean(client && connectionID && interactionSessionIDs.length),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return loadSessionAncestries(client, interactionSessionIDs, signal);
    },
    queryKey: openCodeQueryKeys.sessionAncestries(
      connectionID ?? unresolvedConnectionID,
      "interactions",
      interactionSessionIDs,
      revision,
    ),
  });
  const knownLocationKeys = new Set(knownLocations.map(locationKey));
  const supplementalLocations = uniqueLocations(
    Object.values(interactionAncestryQuery.data?.sessions ?? {})
      .filter((session) => availableFollowedProjectIDs.includes(session.projectID))
      .map((session) => session.location),
  ).filter((candidate) => !knownLocationKeys.has(locationKey(candidate)));
  const supplementalInteractionQueries = useQueries({
    queries: supplementalLocations.flatMap((supplementalLocation) => [
      {
        enabled: Boolean(client && connectionID),
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!client) throw new Error("CONNECTION_NOT_READY");
          return listOpenCodePermissionRequests(client, supplementalLocation, { signal });
        },
        queryKey: openCodeQueryKeys.permissions(
          connectionID ?? unresolvedConnectionID,
          supplementalLocation,
        ),
      },
      {
        enabled: Boolean(client && connectionID),
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!client) throw new Error("CONNECTION_NOT_READY");
          return listOpenCodeFormRequests(client, supplementalLocation, { signal });
        },
        queryKey: openCodeQueryKeys.forms(
          connectionID ?? unresolvedConnectionID,
          supplementalLocation,
        ),
      },
    ]),
  });
  for (const [locationIndex, supplementalLocation] of supplementalLocations.entries()) {
    const permissionResult = supplementalInteractionQueries[locationIndex * 2]?.data as
      | { data: PermissionRequest[] }
      | undefined;
    const formResult = supplementalInteractionQueries[locationIndex * 2 + 1]?.data as
      | { data: FormInfo[] }
      | undefined;
    for (const request of permissionResult?.data ?? []) {
      permissionsByID.set(request.id, request);
      permissionLocations.set(request.id, supplementalLocation);
    }
    for (const form of formResult?.data ?? []) {
      formsByID.set(form.id, form);
      formLocations.set(form.id, supplementalLocation);
    }
  }
  const permissions = [...permissionsByID.values()].sort(compareInteractions);
  const forms = [...formsByID.values()].sort(compareInteractions);

  const ancestrySessions = {
    ...(activeAncestryQuery.data?.sessions ?? {}),
    ...(interactionAncestryQuery.data?.sessions ?? {}),
  };
  const followedActiveSessionIDs = activeSessionIDs.filter((sessionID) =>
    availableFollowedProjectIDs.includes(ancestrySessions[sessionID]?.projectID ?? ""),
  );
  const nextInbox = buildFollowedInboxSections({
    activeSessionIDs: followedActiveSessionIDs,
    ancestrySessions,
    forms,
    permissions,
    projects,
    rootSessions: visibleRootSessions,
  });
  const previousInboxOrder = inboxOrderRef.current;
  const inbox = stabilizeFollowedInboxSections(
    nextInbox,
    previousInboxOrder && previousInboxOrder.connectionKey === connectionKey
      ? previousInboxOrder.inbox
      : undefined,
  );
  inboxOrderRef.current = { connectionKey, inbox };

  const allInteractionQueries = [...interactionQueries, ...supplementalInteractionQueries];
  const interactionPending = allInteractionQueries.some((query) => query.isPending);
  const interactionFetching = allInteractionQueries.some((query) => query.isFetching);
  const failedLocations = [
    ...knownLocations.filter(
      (_location, index) =>
        interactionQueries[index * 2]?.isError || interactionQueries[index * 2 + 1]?.isError,
    ),
    ...supplementalLocations.filter(
      (_location, index) =>
        supplementalInteractionQueries[index * 2]?.isError ||
        supplementalInteractionQueries[index * 2 + 1]?.isError,
    ),
  ];
  const failedLocationCount = failedLocations.length;
  const projectIDByLocation = new Map<string, string>();
  for (const project of projects) {
    for (const directory of [project.canonical, ...project.sandboxes]) {
      projectIDByLocation.set(locationKey({ directory }), project.id);
    }
  }
  for (const session of [...rootSessions, ...Object.values(ancestrySessions)]) {
    projectIDByLocation.set(locationKey(session.location), session.projectID);
  }
  for (const resolved of eventLocationsQuery.data?.locations ?? []) {
    projectIDByLocation.set(
      locationKey({
        directory: resolved.directory,
        ...(resolved.workspaceID ? { workspaceID: resolved.workspaceID } : {}),
      }),
      resolved.project.id,
    );
  }
  if (selectedLocationQuery.data) {
    projectIDByLocation.set(
      locationKey({
        directory: selectedLocationQuery.data.directory,
        ...(selectedLocationQuery.data.workspaceID
          ? { workspaceID: selectedLocationQuery.data.workspaceID }
          : {}),
      }),
      selectedLocationQuery.data.project.id,
    );
  }
  const failedProjectCounts = new Map<string, number>();
  for (const failedLocation of failedLocations) {
    const projectID =
      projectIDByLocation.get(locationKey(failedLocation)) ??
      inferLocationProjectID(failedLocation, projects);
    const key = projectID ?? "";
    failedProjectCounts.set(key, (failedProjectCounts.get(key) ?? 0) + 1);
  }
  const failedProjects = [...failedProjectCounts.entries()]
    .map(([projectID, locationCount]) => {
      const project = projectByID.get(projectID);
      return {
        label: project ? labelProject(project) : "Unknown project",
        locationCount,
        ...(projectID ? { projectID } : {}),
      };
    })
    .sort((first, second) => first.label.localeCompare(second.label));
  const sessionProjectFailures = failedFollowedSessionProjects(sessionsQuery.data?.pages);
  const reconciling =
    !preferenceReady ||
    projectsQuery.isPending ||
    defaultLocationQuery.isPending ||
    (availableFollowedProjectIDs.length > 0 && sessionsQuery.isPending) ||
    activeSessionsQuery.isPending ||
    (activeSessionIDs.length > 0 && activeAncestryQuery.isPending) ||
    (eventLocations.length > 0 && eventLocationsQuery.isPending) ||
    (Boolean(location) && selectedLocationQuery.isPending) ||
    interactionPending ||
    interactionFetching ||
    (interactionSessionIDs.length > 0 && interactionAncestryQuery.isPending);
  const coverageReasons = [
    ...(unavailableProjectIds.length > 0 ? ["followed-project-unavailable"] : []),
    ...(sessionProjectFailures.length > 0 ? ["project-session-page-failed"] : []),
    ...((activeAncestryQuery.data?.failures.length ?? 0) > 0
      ? ["active-session-metadata-failed"]
      : []),
    ...((eventLocationsQuery.data?.failures ?? 0) > 0 ? ["event-location-failed"] : []),
    ...(location &&
    selectedLocationQuery.isError &&
    (!selectedLocationQuery.data ||
      availableFollowedProjectIDs.includes(selectedLocationQuery.data.project.id))
      ? ["selected-location-failed"]
      : []),
    ...(failedLocationCount > 0 ? ["location-interaction-failed"] : []),
    ...((interactionAncestryQuery.data?.failures.length ?? 0) > 0
      ? ["interaction-session-metadata-failed"]
      : []),
    ...(inbox.unmatchedSessionIDs.length > 0 ? ["session-parent-unresolved"] : []),
    ...(preferenceState?.loadFailed ? ["followed-project-preference-failed"] : []),
  ];
  const attentionCoverage: AttentionCoverage = {
    completeness: reconciling || coverageReasons.length > 0 ? "incomplete" : "complete",
    failedLocationCount,
    failedProjects,
    freshness: runtime.status !== "connected" ? "stale" : reconciling ? "reconciling" : "current",
    knownLocationCount: knownLocations.length + supplementalLocations.length,
    reasons: coverageReasons,
    reconciledLocationCount:
      knownLocations.length + supplementalLocations.length - failedLocationCount,
    revision,
  };

  const permissionReplyMutation = useMutation({
    mutationFn: ({
      reply,
      requestClient,
      requestID,
      sessionID,
    }: {
      requestConnectionID: string;
      location: LocationRef;
      reply: PermissionReply;
      requestClient: OpenCodeClient;
      requestID: string;
      sessionID: string;
    }) => replyOpenCodePermissionRequest(requestClient, sessionID, requestID, reply),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: openCodeQueryKeys.permissions(variables.requestConnectionID, variables.location),
      });
    },
  });

  const setFollowedProjectIds = useCallback(
    async (projectIDs: readonly string[]) => {
      if (!connectionID || !connectionKey || preferencesSaving) return;
      setPreferencesSaving(true);
      try {
        await replaceFollowedProjectIds(
          db,
          connectionID,
          projectIDs,
          runtime.connectionUpdatedAtMs,
        );
        if (latestConnectionKeyRef.current !== connectionKey) return;
        setPreferenceState({
          connectionKey,
          hasPreference: true,
          loadFailed: false,
          projectIDs: [...projectIDs],
        });
      } finally {
        if (latestConnectionKeyRef.current === connectionKey) setPreferencesSaving(false);
      }
    },
    [connectionID, connectionKey, db, preferencesSaving, runtime.connectionUpdatedAtMs],
  );
  const setLocation = useCallback(
    (nextLocation: LocationRef | undefined) => {
      setSelection((current) => {
        const next =
          nextLocation && connectionKey ? { connectionKey, location: nextLocation } : undefined;
        return current?.connectionKey === next?.connectionKey &&
          current?.location.directory === next?.location.directory &&
          current?.location.workspaceID === next?.location.workspaceID
          ? current
          : next;
      });
    },
    [connectionKey],
  );
  const replyPermission = useCallback(
    (requestID: string, sessionID: string, reply: PermissionReply) => {
      const requestLocation = permissionLocations.get(requestID);
      if (!client || !connectionID || !requestLocation || permissionReplyMutation.isPending) return;
      permissionReplyMutation.mutate({
        location: requestLocation,
        reply,
        requestClient: client,
        requestConnectionID: connectionID,
        requestID,
        sessionID,
      });
    },
    [client, connectionID, permissionLocations, permissionReplyMutation],
  );
  const visibleSessionsQuery = normalizedSearch ? searchSessionsQuery : sessionsQuery;

  return (
    <FollowedProjectsContext
      value={{
        attentionCoverage,
        blockedSessionIds: new Set(interactionSessionIDs),
        fetchNextPage: () => visibleSessionsQuery.fetchNextPage(),
        followedProjectIds,
        formLocations,
        forms,
        hasNextPage: Boolean(visibleSessionsQuery.hasNextPage),
        inbox,
        interactionsError: failedLocationCount > 0,
        interactionsLoading: reconciling,
        ...(location ? { location } : {}),
        pendingCount: permissions.length + forms.length,
        permissionReplyError: permissionReplyMutation.isError,
        permissions,
        preferencesError: Boolean(preferenceState?.loadFailed),
        preferencesLoading: !preferenceReady,
        preferencesSaving,
        projects,
        projectsError: projectsQuery.isError,
        projectsLoading: projectsQuery.isPending,
        refetch: () =>
          Promise.allSettled([
            projectsQuery.refetch(),
            defaultLocationQuery.refetch(),
            activeSessionsQuery.refetch(),
            ...(availableFollowedProjectIDs.length ? [sessionsQuery.refetch()] : []),
            ...(availableFollowedProjectIDs.length && normalizedSearch
              ? [searchSessionsQuery.refetch()]
              : []),
            ...allInteractionQueries.map((query) => query.refetch()),
          ]),
        replyPermission,
        ...(permissionReplyMutation.isPending && permissionReplyMutation.variables
          ? { replyingPermissionId: permissionReplyMutation.variables.requestID }
          : {}),
        search,
        sessionsError:
          visibleSessionsQuery.isError ||
          failedFollowedSessionProjects(visibleSessionsQuery.data?.pages).length > 0,
        sessionsLoading: availableFollowedProjectIDs.length > 0 && visibleSessionsQuery.isPending,
        setFollowedProjectIds,
        setLocation,
        setSearch,
        unavailableProjectIds,
      }}
    >
      {children}
    </FollowedProjectsContext>
  );
}

export function useFollowedProjects() {
  const value = use(FollowedProjectsContext);
  if (!value) throw new Error("FollowedProjectsProvider is missing");
  return value;
}

function inferLocationProjectID(
  location: LocationRef,
  projects: Awaited<ReturnType<typeof listOpenCodeProjects>>,
) {
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

function labelProject(project: Awaited<ReturnType<typeof listOpenCodeProjects>>[number]) {
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
