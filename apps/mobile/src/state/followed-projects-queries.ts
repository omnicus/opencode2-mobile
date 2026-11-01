import {
  archiveOpenCodeSession,
  type FormInfo,
  getDefaultOpenCodeLocation,
  getOpenCodeLocation,
  type LocationRef,
  listActiveOpenCodeSessions,
  listOpenCodeFormRequests,
  listOpenCodePermissionRequests,
  listOpenCodeProjects,
  type OpenCodeClient,
  openCodeDirectoryExists,
  type PermissionReply,
  type PermissionRequest,
  replyOpenCodePermissionRequest,
  type SessionInfo,
} from "@opencode2-mobile/opencode-adapter";
import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { useCallback } from "react";

import {
  type FollowedSessionPage,
  type FollowedSessionPageParam,
  failedFollowedSessionProjects,
  fetchFollowedSessionPage,
  flattenFollowedSessionPages,
  loadSessionAncestries,
  nextFollowedSessionPageParam,
  type SessionAncestryResult,
  setFollowedSessionArchived,
} from "./followed-project-inbox";
import {
  activeLocationStatus,
  followedInboxWindow,
  type HistoricalCandidate,
  initialFollowedSessionPageParam,
  requireClient,
  sameRevisionScope,
} from "./followed-projects-model";
import { openCodeQueryKeys } from "./open-code-query-keys";

const sessionPageSize = 30;
// The OpenCode desktop inbox also loads the newest 50 archived root sessions.
const archivedPageSize = 50;
// ["opencode", connectionID, "session-ancestries", purpose]
const ancestryScopeLength = 4;

export type FollowedQueryScope = {
  client: OpenCodeClient | undefined;
  connectionReady: boolean;
  queryConnectionID: string;
  revision: number;
};

type Refetchable = { refetch: () => Promise<unknown> };

export function useFollowedProjectCatalog(scope: FollowedQueryScope) {
  const projectsQuery = useQuery({
    enabled: scope.connectionReady,
    queryFn: ({ signal }) => listOpenCodeProjects(requireClient(scope.client), { signal }),
    queryKey: openCodeQueryKeys.projects(scope.queryConnectionID),
  });
  const defaultLocationQuery = useQuery({
    enabled: scope.connectionReady,
    queryFn: ({ signal }) => getDefaultOpenCodeLocation(requireClient(scope.client), { signal }),
    queryKey: openCodeQueryKeys.defaultLocation(scope.queryConnectionID),
  });
  return {
    defaultLocationQuery,
    defaultProjectID: defaultLocationQuery.data?.project.id,
    projects: projectsQuery.data ?? [],
    projectsQuery,
  };
}

function useFollowedSessionsQuery(
  scope: FollowedQueryScope,
  input: {
    enabled: boolean;
    fetchFilter: { search?: string; until?: number };
    initialPageParam: FollowedSessionPageParam;
    keyFilter: { search?: string; since?: number };
    projectIDs: readonly string[];
  },
) {
  const queryKey = openCodeQueryKeys.followedProjectSessions(
    scope.queryConnectionID,
    input.projectIDs,
    { limit: sessionPageSize, order: "desc", parentID: null, ...input.keyFilter },
    scope.revision,
  );
  return useInfiniteQuery({
    enabled: input.enabled,
    getNextPageParam: nextFollowedSessionPageParam,
    initialPageParam: input.initialPageParam,
    placeholderData: (previous, previousQuery) =>
      sameRevisionScope(previousQuery?.queryKey, queryKey, queryKey.length - 1)
        ? previous
        : undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchFollowedSessionPage(requireClient(scope.client), input.projectIDs, pageParam, {
        limit: sessionPageSize,
        ...input.fetchFilter,
        signal,
      }),
    queryKey,
  });
}

function useArchivedSessionsQuery(
  scope: FollowedQueryScope,
  input: {
    enabled: boolean;
    initialPageParam: FollowedSessionPageParam;
    projectIDs: readonly string[];
  },
) {
  const queryKey = openCodeQueryKeys.followedProjectSessions(
    scope.queryConnectionID,
    input.projectIDs,
    { archived: true, limit: archivedPageSize, order: "desc", parentID: null },
    scope.revision,
  );
  return useQuery({
    enabled: input.enabled,
    placeholderData: (previous: FollowedSessionPage | undefined, previousQuery) =>
      sameRevisionScope(previousQuery?.queryKey, queryKey, queryKey.length - 1)
        ? previous
        : undefined,
    queryFn: ({ signal }) =>
      fetchFollowedSessionPage(
        requireClient(scope.client),
        input.projectIDs,
        input.initialPageParam,
        { archived: true, limit: archivedPageSize, signal },
      ),
    queryKey,
  });
}

export function useFollowedProjectSessions(
  scope: FollowedQueryScope,
  input: {
    inboxSinceMs: number | undefined;
    preferenceReady: boolean;
    projectIDs: readonly string[];
    search: string;
  },
) {
  const enabled = scope.connectionReady && input.preferenceReady && input.projectIDs.length > 0;
  const initialPageParam = initialFollowedSessionPageParam(input.projectIDs);
  const inboxWindow = followedInboxWindow(input.inboxSinceMs);
  const sessionsQuery = useFollowedSessionsQuery(scope, {
    enabled: enabled && input.inboxSinceMs !== undefined,
    fetchFilter: inboxWindow.fetchFilter,
    initialPageParam,
    keyFilter: inboxWindow.keyFilter,
    projectIDs: input.projectIDs,
  });
  const archivedSessionsQuery = useArchivedSessionsQuery(scope, {
    enabled,
    initialPageParam,
    projectIDs: input.projectIDs,
  });
  const normalizedSearch = input.search.trim();
  const searchSessionsQuery = useFollowedSessionsQuery(scope, {
    enabled: Boolean(enabled && normalizedSearch),
    fetchFilter: { search: normalizedSearch },
    initialPageParam,
    keyFilter: { search: normalizedSearch },
    projectIDs: input.projectIDs,
  });
  const visibleSessionsQuery = normalizedSearch ? searchSessionsQuery : sessionsQuery;
  return {
    archivedSessionsQuery,
    normalizedSearch,
    rootSessions: flattenFollowedSessionPages(sessionsQuery.data?.pages),
    searchSessionsQuery,
    sessionProjectFailureCount: failedFollowedSessionProjects(sessionsQuery.data?.pages).length,
    sessionsQuery,
    visibleRootSessions: visibleFollowedRootSessions(normalizedSearch, {
      archived: archivedSessionsQuery.data,
      search: searchSessionsQuery.data?.pages,
      sessions: sessionsQuery.data?.pages,
    }),
    visibleSessionsQuery,
  };
}

// Archived roots only add Archived rows. Location discovery keeps to the active list.
export function visibleFollowedRootSessions(
  search: string,
  pages: {
    archived: FollowedSessionPage | undefined;
    search: readonly FollowedSessionPage[] | undefined;
    sessions: readonly FollowedSessionPage[] | undefined;
  },
) {
  if (search) return flattenFollowedSessionPages(pages.search);
  return flattenFollowedSessionPages([
    ...(pages.sessions ?? []),
    ...(pages.archived ? [pages.archived] : []),
  ]);
}

export function visibleSessionState(
  query: ReturnType<typeof useFollowedSessionsQuery>,
  followedProjectCount: number,
) {
  return {
    // Placeholder pages belong to the previous revision. Paging from them
    // would cancel the first fetch for the current revision.
    fetchNextPage: () => (query.isPlaceholderData ? Promise.resolve() : query.fetchNextPage()),
    hasNextPage: Boolean(query.hasNextPage),
    sessionsError: query.isError || failedFollowedSessionProjects(query.data?.pages).length > 0,
    sessionsFetchingNextPage: query.isFetchingNextPage,
    sessionsLoading: followedProjectCount > 0 && query.isPending,
  };
}

export function useSessionAncestriesQuery(
  scope: FollowedQueryScope,
  purpose: "active" | "interactions",
  sessionIDs: readonly string[],
) {
  const queryKey = openCodeQueryKeys.sessionAncestries(
    scope.queryConnectionID,
    purpose,
    sessionIDs,
    scope.revision,
  );
  const query = useQuery({
    enabled: scope.connectionReady && sessionIDs.length > 0,
    // Ancestry entries are looked up by session ID, so the previous snapshot
    // stays valid for display while the active set or revision changes.
    placeholderData: (previous: SessionAncestryResult | undefined, previousQuery) =>
      sameRevisionScope(previousQuery?.queryKey, queryKey, ancestryScopeLength)
        ? previous
        : undefined,
    queryFn: ({ signal }) => loadSessionAncestries(requireClient(scope.client), sessionIDs, signal),
    queryKey,
  });
  return {
    failureCount: query.data?.failures.length ?? 0,
    query,
    sessions: query.data?.sessions ?? {},
  };
}

export function useActiveSessionAncestries(scope: FollowedQueryScope) {
  const activeSessionsQuery = useQuery({
    enabled: scope.connectionReady,
    queryFn: ({ signal }) => listActiveOpenCodeSessions(requireClient(scope.client), { signal }),
    queryKey: openCodeQueryKeys.activeSessions(scope.queryConnectionID),
  });
  const activeSessionIDs = Object.keys(activeSessionsQuery.data ?? {}).sort();
  const ancestry = useSessionAncestriesQuery(scope, "active", activeSessionIDs);
  return {
    activeSessionIDs,
    activeSessionsQuery,
    ancestry,
    ...activeLocationStatus(activeSessionsQuery, activeSessionIDs.length, ancestry.query),
  };
}

type EventLocationInput = {
  activeLocationsResolved: boolean;
  eventLocations: LocationRef[];
  findCandidate: (candidate: LocationRef) => HistoricalCandidate | undefined;
};

export function useEventLocationsQuery(
  scope: FollowedQueryScope,
  input: EventLocationInput & {
    activeLocationsPending: boolean;
    preferenceReady: boolean;
    projectsQuery: { isPending: boolean };
  },
) {
  return useQuery({
    enabled: Boolean(
      scope.connectionReady &&
        input.eventLocations.length &&
        input.preferenceReady &&
        !input.projectsQuery.isPending &&
        !input.activeLocationsPending,
    ),
    queryFn: async ({ signal }) =>
      resolveEventLocations(requireClient(scope.client), input, signal),
    queryKey: openCodeQueryKeys.eventLocations(
      scope.queryConnectionID,
      input.eventLocations,
      scope.revision,
    ),
  });
}

async function resolveEventLocations(
  client: OpenCodeClient,
  input: EventLocationInput,
  signal: AbortSignal,
) {
  const settled = await Promise.allSettled(
    input.eventLocations.map(async (eventLocation) => {
      const candidate = input.findCandidate(eventLocation);
      // Resolving a location initializes it on the server. Check through the
      // live project root before touching a retired historical directory.
      if (candidate && input.activeLocationsResolved) {
        let exists: boolean | undefined;
        try {
          exists = await openCodeDirectoryExists(client, candidate.root, eventLocation.directory, {
            signal,
          });
        } catch {
          // An unavailable probe is not proof that the directory is gone.
          if (signal.aborted) throw new Error("LOCATION_CHECK_ABORTED");
        }
        if (exists === false) return undefined;
      }
      return getOpenCodeLocation(client, eventLocation, { signal });
    }),
  );
  return {
    failures: settled.filter((result) => result.status === "rejected").length,
    locations: settled.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    ),
  };
}

export function useSelectedLocationQuery(
  scope: FollowedQueryScope,
  location: LocationRef | undefined,
) {
  return useQuery({
    enabled: Boolean(scope.connectionReady && location),
    queryFn: ({ signal }) => {
      if (!scope.client || !location) throw new Error("LOCATION_NOT_RESOLVED");
      return getOpenCodeLocation(scope.client, location, { signal });
    },
    queryKey: openCodeQueryKeys.resolvedLocation(
      scope.queryConnectionID,
      location ?? { directory: "unselected" },
    ),
  });
}

export function useHistoricalDirectoryQueries(
  scope: FollowedQueryScope,
  candidates: readonly HistoricalCandidate[],
) {
  return useQueries({
    queries: candidates.map((candidate) => ({
      enabled: scope.connectionReady,
      queryKey: openCodeQueryKeys.historicalDirectory(
        scope.queryConnectionID,
        candidate.root,
        candidate.location.directory,
        scope.revision,
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        openCodeDirectoryExists(
          requireClient(scope.client),
          candidate.root,
          candidate.location.directory,
          { signal },
        ),
    })),
  });
}

// Each location gets a permission query followed by a form query.
export function useLocationInteractionQueries(
  scope: FollowedQueryScope,
  locations: readonly LocationRef[],
  canCheck: (location: LocationRef) => boolean,
) {
  return useQueries({
    queries: locations.flatMap((location) => [
      {
        enabled: scope.connectionReady && canCheck(location),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          listOpenCodePermissionRequests(requireClient(scope.client), location, { signal }),
        queryKey: openCodeQueryKeys.permissions(scope.queryConnectionID, location),
      },
      {
        enabled: scope.connectionReady && canCheck(location),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          listOpenCodeFormRequests(requireClient(scope.client), location, { signal }),
        queryKey: openCodeQueryKeys.forms(scope.queryConnectionID, location),
      },
    ]),
  });
}

export function cachedAttentionLookup(queryClient: QueryClient, queryConnectionID: string) {
  return (candidate: LocationRef) => {
    const permissionSnapshot = queryClient.getQueryData<{ data: PermissionRequest[] }>(
      openCodeQueryKeys.permissions(queryConnectionID, candidate),
    );
    const formSnapshot = queryClient.getQueryData<{ data: FormInfo[] }>(
      openCodeQueryKeys.forms(queryConnectionID, candidate),
    );
    return Boolean(permissionSnapshot?.data.length || formSnapshot?.data.length);
  };
}

export function usePermissionReply(
  queryClient: QueryClient,
  client: OpenCodeClient | undefined,
  connectionID: string | undefined,
  permissionLocations: ReadonlyMap<string, LocationRef>,
) {
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
  return {
    failedPermissionReply:
      permissionReplyMutation.isError && permissionReplyMutation.variables
        ? { failedPermissionReplyId: permissionReplyMutation.variables.requestID }
        : {},
    replyPermission,
    replyingPermission:
      permissionReplyMutation.isPending && permissionReplyMutation.variables
        ? { replyingPermissionId: permissionReplyMutation.variables.requestID }
        : {},
  };
}

export function useArchiveSession(
  queryClient: QueryClient,
  client: OpenCodeClient | undefined,
  connectionID: string | undefined,
) {
  return useCallback(
    async (session: SessionInfo, archived: boolean) => {
      if (!client || !connectionID) throw new Error("CONNECTION_NOT_READY");
      await archiveOpenCodeSession(client, session.id, archived);
      // Move the row at once. The archive event and this refetch bring the server's copy.
      const archivedAt = archived ? Date.now() : undefined;
      const followedSessions = (query: { queryKey: QueryKey }) =>
        query.queryKey[0] === "opencode" &&
        query.queryKey[1] === connectionID &&
        query.queryKey[2] === "followed-project-sessions";
      queryClient.setQueriesData<
        InfiniteData<FollowedSessionPage, FollowedSessionPageParam> | FollowedSessionPage
      >({ predicate: followedSessions }, (current) =>
        archiveCachedSession(current, session.id, archivedAt),
      );
      void queryClient.invalidateQueries({ predicate: followedSessions });
    },
    [client, connectionID, queryClient],
  );
}

function archiveCachedSession(
  current:
    | InfiniteData<FollowedSessionPage, FollowedSessionPageParam>
    | FollowedSessionPage
    | undefined,
  sessionID: string,
  archivedAt: number | undefined,
) {
  if (!current) return current;
  if ("pages" in current) {
    return {
      ...current,
      pages: current.pages.map((page) => setFollowedSessionArchived(page, sessionID, archivedAt)),
    };
  }
  return setFollowedSessionArchived(current, sessionID, archivedAt);
}

export function refetchFollowedProjects(input: {
  activeSessionsQuery: Refetchable;
  archivedSessionsQuery: Refetchable;
  canCheck: (location: LocationRef) => boolean;
  defaultLocationQuery: Refetchable;
  directoryQueries: readonly Refetchable[];
  followedProjectCount: number;
  interactionQueries: readonly Refetchable[];
  knownLocations: readonly LocationRef[];
  projectsQuery: Refetchable;
  search: string;
  searchSessionsQuery: Refetchable;
  sessionsQuery: Refetchable;
  supplementalInteractionQueries: readonly Refetchable[];
}) {
  return Promise.allSettled([
    ...input.directoryQueries.map((query) => query.refetch()),
    input.projectsQuery.refetch(),
    input.defaultLocationQuery.refetch(),
    input.activeSessionsQuery.refetch(),
    ...(input.followedProjectCount
      ? [input.sessionsQuery.refetch(), input.archivedSessionsQuery.refetch()]
      : []),
    ...(input.followedProjectCount && input.search ? [input.searchSessionsQuery.refetch()] : []),
    // refetch() bypasses enabled. Do not initialize a historical
    // location while its renewed directory probe is still pending.
    ...input.knownLocations.flatMap((knownLocation, index) => {
      if (!input.canCheck(knownLocation)) return [];
      return input.interactionQueries
        .slice(index * 2, index * 2 + 2)
        .map((query) => query.refetch());
    }),
    ...input.supplementalInteractionQueries.map((query) => query.refetch()),
  ]);
}
