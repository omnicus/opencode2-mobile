import type {
  FormInfo,
  LocationRef,
  PermissionReply,
  PermissionRequest,
  ProjectListOutput,
  SessionInfo,
} from "@opencode2-mobile/opencode-adapter";
import { useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import { createContext, type ReactNode, use, useRef } from "react";

import type { CollapsibleInboxSection } from "../storage/session-inbox-repository";
import { useConnectionRuntime } from "./connection-runtime-context";
import {
  buildFollowedInboxSections,
  type FollowedInboxSections,
  locationKey,
  stabilizeFollowedInboxSections,
  uniqueLocations,
} from "./followed-project-inbox";
import {
  type AttentionCoverage,
  addLocationInteractions,
  attentionCoverageReasons,
  attentionFreshness,
  attentionLocationFailures,
  canCheckLocationInteractions,
  createInteractionIndex,
  directoryProbesByLocation,
  discoverFollowedLocations,
  failedInteractionLocations,
  failedProjectSummaries,
  followedActiveSessionIDs,
  followedProjectAvailability,
  followedProjectScopeKey,
  historicalCandidate,
  historicalCandidates,
  interactionSessionIDs,
  isAttentionReconciling,
  knownCandidateLocations,
  projectIDsByLocation,
  protectedLocationKeys,
  sortedInteractions,
  supplementalInteractionLocations,
  unresolvedConnectionID,
} from "./followed-projects-model";
import {
  useFollowedProjectPreferences,
  useInitialFollowedProject,
  useSessionInboxPreferences,
  useSetFollowedProjectIds,
} from "./followed-projects-preferences";
import {
  cachedAttentionLookup,
  type FollowedQueryScope,
  refetchFollowedProjects,
  useActiveSessionAncestries,
  useArchiveSession,
  useEventLocationsQuery,
  useFollowedProjectCatalog,
  useFollowedProjectSessions,
  useHistoricalDirectoryQueries,
  useLocationInteractionQueries,
  usePermissionReply,
  useSelectedLocationQuery,
  useSessionAncestriesQuery,
  visibleSessionState,
} from "./followed-projects-queries";

export type { AttentionCoverage, AttentionLocationFailure } from "./followed-projects-model";

type FollowedProjectsContextValue = {
  archiveSession: (session: SessionInfo, archived: boolean) => Promise<void>;
  archivedExpanded: boolean;
  attentionCoverage: AttentionCoverage;
  blockedSessionIds: ReadonlySet<string>;
  fetchNextPage: () => Promise<unknown>;
  followedProjectIds: string[];
  formLocations: ReadonlyMap<string, LocationRef>;
  forms: FormInfo[];
  hasNextPage: boolean;
  sessionsFetchingNextPage: boolean;
  inbox: FollowedInboxSections;
  interactionsError: boolean;
  interactionsLoading: boolean;
  location?: LocationRef;
  pendingCount: number;
  failedPermissionReplyId?: string;
  permissions: PermissionRequest[];
  preferencesLoading: boolean;
  preferencesError: boolean;
  preferencesSaving: boolean;
  projects: ProjectListOutput;
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
  setSectionExpanded: (section: CollapsibleInboxSection, expanded: boolean) => void;
  unavailableProjectIds: string[];
  workingExpanded: boolean;
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
  const client = runtime.restClient;
  const revision = runtime.reconciliationRevision;
  const scope: FollowedQueryScope = {
    client,
    connectionReady: Boolean(client && connectionID),
    queryConnectionID: connectionID ?? unresolvedConnectionID,
    revision,
  };
  const preferences = useFollowedProjectPreferences(
    db,
    connectionID,
    connectionKey,
    runtime.connectionUpdatedAtMs,
  );
  const { location, preferenceReady } = preferences;
  const inboxPreferences = useSessionInboxPreferences(
    db,
    connectionID,
    connectionKey,
    runtime.connectionUpdatedAtMs,
  );

  const catalog = useFollowedProjectCatalog(scope);
  const { projects } = catalog;
  useInitialFollowedProject(preferences.writer, {
    defaultProjectID: catalog.defaultProjectID,
    hasPreference: preferences.hasPreference,
    preferenceReady,
    projects,
  });
  const setFollowedProjectIds = useSetFollowedProjectIds(preferences.writer);

  const { availableFollowedProjectIDs, projectByID, unavailableProjectIds } =
    followedProjectAvailability(projects, preferences.followedProjectIds);
  const sessions = useFollowedProjectSessions(scope, {
    inboxSinceMs: inboxPreferences.inboxSinceMs,
    preferenceReady,
    projectIDs: availableFollowedProjectIDs,
    search: preferences.search,
  });
  const { rootSessions } = sessions;
  const active = useActiveSessionAncestries(scope);

  const eventLocations = uniqueLocations(runtime.eventLocations);
  const historicalLookup = {
    hasAttention: cachedAttentionLookup(queryClient, scope.queryConnectionID),
    projectByID,
    projects,
    protectedLocationKeys: protectedLocationKeys({
      activeAncestrySessions: active.ancestry.sessions,
      attentionLocations: runtime.attentionLocations,
      projectByID,
      projectIDs: availableFollowedProjectIDs,
    }),
    rootSessions,
  };
  const findHistoricalCandidate = (candidate: LocationRef) =>
    historicalCandidate(candidate, historicalLookup);
  const eventLocationsQuery = useEventLocationsQuery(scope, {
    activeLocationsPending: active.activeLocationsPending,
    activeLocationsResolved: active.activeLocationsResolved,
    eventLocations,
    findCandidate: findHistoricalCandidate,
    preferenceReady,
    projectsQuery: catalog.projectsQuery,
  });
  const selectedLocationQuery = useSelectedLocationQuery(scope, location);

  const candidateLocations = useAccumulatedLocations(
    followedProjectScopeKey(connectionKey, availableFollowedProjectIDs),
    discoverFollowedLocations({
      activeAncestrySessions: active.ancestry.sessions,
      attentionLocations: runtime.attentionLocations,
      eventLocations: eventLocationsQuery.data,
      projectByID,
      projectIDs: availableFollowedProjectIDs,
      rootSessions,
      selectedLocation: selectedLocationQuery.data,
    }),
  );
  const retirementCandidates = historicalCandidates(candidateLocations, findHistoricalCandidate);
  const directoryQueries = useHistoricalDirectoryQueries(scope, retirementCandidates);
  const directoryQueryByLocation = directoryProbesByLocation(
    retirementCandidates,
    directoryQueries,
  );
  const knownLocations = knownCandidateLocations(
    candidateLocations,
    directoryQueryByLocation,
    active.activeLocationsResolved,
  );
  const canCheckInteractions = (candidate: LocationRef) =>
    canCheckLocationInteractions(
      directoryQueryByLocation.get(locationKey(candidate)),
      active.activeLocationsPending,
      active.activeLocationsResolved,
    );
  const interactionQueries = useLocationInteractionQueries(
    scope,
    knownLocations,
    canCheckInteractions,
  );
  const interactions = createInteractionIndex();
  addLocationInteractions(interactions, knownLocations, interactionQueries);
  const blockedSessionIDs = interactionSessionIDs(interactions);
  const interactionAncestry = useSessionAncestriesQuery(scope, "interactions", blockedSessionIDs);
  const supplementalLocations = supplementalInteractionLocations(
    interactionAncestry.sessions,
    availableFollowedProjectIDs,
    knownLocations,
  );
  const supplementalInteractionQueries = useLocationInteractionQueries(
    scope,
    supplementalLocations,
    () => true,
  );
  addLocationInteractions(interactions, supplementalLocations, supplementalInteractionQueries);
  const { forms, permissions } = sortedInteractions(interactions);

  const ancestrySessions = { ...active.ancestry.sessions, ...interactionAncestry.sessions };
  const inbox = useStableInbox(
    connectionKey,
    buildFollowedInboxSections({
      activeSessionIDs: followedActiveSessionIDs(
        active.activeSessionIDs,
        ancestrySessions,
        availableFollowedProjectIDs,
      ),
      ancestrySessions,
      forms,
      permissions,
      projects,
      recentSince: sessions.normalizedSearch ? "all" : inboxPreferences.inboxSinceMs,
      rootSessions: sessions.visibleRootSessions,
    }),
  );

  const allLocations = [...knownLocations, ...supplementalLocations];
  const allInteractionQueries = [...interactionQueries, ...supplementalInteractionQueries];
  const failedLocations = failedInteractionLocations(allLocations, allInteractionQueries);
  const locatedSessions = [...rootSessions, ...Object.values(ancestrySessions)];
  const failureLookup = {
    projectByID,
    projectIDByLocation: projectIDsByLocation({
      eventLocations: eventLocationsQuery.data,
      projects,
      selectedLocation: selectedLocationQuery.data,
      sessions: locatedSessions,
    }),
    projects,
  };
  const failedLocationDetails = attentionLocationFailures(allLocations, allInteractionQueries, {
    ...failureLookup,
    sessions: locatedSessions,
  });
  const reconciling = isAttentionReconciling({
    activeLocationsPending: active.activeLocationsPending,
    defaultLocation: catalog.defaultLocationQuery,
    directoryQueries,
    eventLocationCount: eventLocations.length,
    eventLocationsQuery,
    followedProjectCount: availableFollowedProjectIDs.length,
    interactionAncestry: interactionAncestry.query,
    interactionQueries: allInteractionQueries,
    interactionSessionCount: blockedSessionIDs.length,
    location,
    preferenceReady,
    projects: catalog.projectsQuery,
    selectedLocationQuery,
    sessions: sessions.sessionsQuery,
  });
  const coverageReasons = attentionCoverageReasons({
    activeAncestryFailureCount: active.ancestry.failureCount,
    eventLocations: eventLocationsQuery.data,
    failedLocationCount: failedLocations.length,
    interactionAncestryFailureCount: interactionAncestry.failureCount,
    location,
    preferenceLoadFailed: preferences.preferencesError,
    projectIDs: availableFollowedProjectIDs,
    selectedLocationQuery,
    selectedLocationRetired: Boolean(
      location &&
        candidateLocations.some((candidate) => locationKey(candidate) === locationKey(location)) &&
        !knownLocations.some((candidate) => locationKey(candidate) === locationKey(location)),
    ),
    sessionProjectFailureCount: sessions.sessionProjectFailureCount,
    unavailableProjectCount: unavailableProjectIds.length,
    unmatchedSessionCount: inbox.unmatchedSessionIDs.length,
  });
  const attentionCoverage: AttentionCoverage = {
    completeness: reconciling || coverageReasons.length > 0 ? "incomplete" : "complete",
    failedLocationCount: failedLocations.length,
    failedLocations: failedLocationDetails,
    failedProjects: failedProjectSummaries(failedLocations, failureLookup),
    freshness: attentionFreshness(runtime.status, reconciling),
    knownLocationCount: allLocations.length,
    reasons: coverageReasons,
    reconciledLocationCount: allLocations.length - failedLocations.length,
    revision,
  };

  const permissionReply = usePermissionReply(
    queryClient,
    client,
    connectionID,
    interactions.permissionLocations,
  );
  const archiveSession = useArchiveSession(queryClient, client, connectionID);
  const visibleSessions = visibleSessionState(
    sessions.visibleSessionsQuery,
    availableFollowedProjectIDs.length,
  );

  return (
    <FollowedProjectsContext
      value={{
        archiveSession,
        archivedExpanded: inboxPreferences.archivedExpanded,
        attentionCoverage,
        blockedSessionIds: new Set(blockedSessionIDs),
        fetchNextPage: visibleSessions.fetchNextPage,
        followedProjectIds: preferences.followedProjectIds,
        formLocations: interactions.formLocations,
        forms,
        hasNextPage: visibleSessions.hasNextPage,
        sessionsFetchingNextPage: visibleSessions.sessionsFetchingNextPage,
        inbox,
        interactionsError: failedLocations.length > 0,
        interactionsLoading: reconciling,
        ...(location ? { location } : {}),
        pendingCount: permissions.length + forms.length,
        ...permissionReply.failedPermissionReply,
        permissions,
        preferencesError: preferences.preferencesError,
        preferencesLoading: !preferenceReady,
        preferencesSaving: preferences.preferencesSaving,
        projects,
        projectsError: catalog.projectsQuery.isError,
        projectsLoading: catalog.projectsQuery.isPending,
        refetch: () =>
          refetchFollowedProjects({
            activeSessionsQuery: active.activeSessionsQuery,
            archivedSessionsQuery: sessions.archivedSessionsQuery,
            canCheck: canCheckInteractions,
            defaultLocationQuery: catalog.defaultLocationQuery,
            directoryQueries,
            followedProjectCount: availableFollowedProjectIDs.length,
            interactionQueries,
            knownLocations,
            projectsQuery: catalog.projectsQuery,
            search: sessions.normalizedSearch,
            searchSessionsQuery: sessions.searchSessionsQuery,
            sessionsQuery: sessions.sessionsQuery,
            supplementalInteractionQueries,
          }),
        replyPermission: permissionReply.replyPermission,
        ...permissionReply.replyingPermission,
        search: preferences.search,
        sessionsError: visibleSessions.sessionsError,
        sessionsLoading: visibleSessions.sessionsLoading,
        setFollowedProjectIds,
        setLocation: preferences.setLocation,
        setSearch: preferences.setSearch,
        setSectionExpanded: inboxPreferences.setSectionExpanded,
        unavailableProjectIds,
        workingExpanded: inboxPreferences.workingExpanded,
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

function useAccumulatedLocations(scopeKey: string | undefined, discovered: LocationRef[]) {
  const discoveredLocationsRef = useRef<{
    scopeKey: string | undefined;
    locations: LocationRef[];
  }>({ scopeKey: undefined, locations: [] });
  const previousLocations =
    discoveredLocationsRef.current.scopeKey === scopeKey
      ? discoveredLocationsRef.current.locations
      : [];
  const candidateLocations = uniqueLocations([...previousLocations, ...discovered]);
  discoveredLocationsRef.current = { scopeKey, locations: candidateLocations };
  return candidateLocations;
}

function useStableInbox(connectionKey: string | undefined, nextInbox: FollowedInboxSections) {
  const inboxOrderRef = useRef<{
    connectionKey: string | undefined;
    inbox: FollowedInboxSections;
  }>(undefined);
  const previousInboxOrder = inboxOrderRef.current;
  const inbox = stabilizeFollowedInboxSections(
    nextInbox,
    previousInboxOrder && previousInboxOrder.connectionKey === connectionKey
      ? previousInboxOrder.inbox
      : undefined,
  );
  inboxOrderRef.current = { connectionKey, inbox };
  return inbox;
}
