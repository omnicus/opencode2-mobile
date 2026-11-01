import Feather from "@expo/vector-icons/Feather";
import {
  findOpenCodeFiles,
  getDefaultOpenCodeLocation,
  getOpenCodeLocation,
  getOpenCodeSession,
  getOpenCodeVcs,
  type LocationRef,
  listOpenCodeMessages,
  listOpenCodeProjects,
  removeOpenCodeSession,
  type SessionInfo,
  type SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Dimensions,
  FlatList,
  Keyboard,
  type KeyboardEvent,
  LayoutAnimation,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import Animated, { LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../components/button";
import { ProjectAvatar } from "../components/project-avatar";
import { announceOnIOS, useAnnouncement } from "../components/use-announcement";
import { useDelayedVisibility } from "../components/use-delayed-visibility";
import { useReducedMotion } from "../components/use-reduced-motion";
import { WorkingIndicator } from "../components/working-indicator";
import { useConnections } from "../connections/connections-context";
import type { RootStackParamList } from "../navigation/root-navigation";
import { WorkspaceHeaderActions } from "../navigation/workspace-header-actions";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import type { FollowedInboxRow } from "../state/followed-project-inbox";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import {
  recordTranscriptFollowCorrection,
  recordTranscriptLatestJump,
  recordTranscriptResidentSet,
} from "../state/transcript-performance";
import { useTranscriptPreferences } from "../state/transcript-preferences";
import { useModelFavorites } from "../state/use-model-favorites";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { deleteSessionLocalState } from "../storage/prompt-admission-repository";
import {
  disabledOpacity,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  space,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";
import { ActionButton, getConnectionPresentation, isTabletShell, ShellFrame } from "./app-shell";
import { SessionChanges } from "./diff-screen";
import { FormRequestList } from "./form-request-list";
import { SessionActionSheet } from "./session-action-sheet";
import { SessionBackgroundTasks } from "./session-background-tasks";
import { SessionComposer } from "./session-composer";
import { loadOpenCodeSessionTreeIds } from "./session-deletion";
import { SessionExecutionPanel, SessionWorkingStatus } from "./session-execution-panel";
import { SessionShellScope } from "./session-shell-output";
import {
  buildTranscriptPresentation,
  PendingPromptRow,
  SessionSubagentStates,
  SessionTranscriptRow,
  TranscriptActivityGroup,
  type TranscriptListItem,
  TranscriptUpdatesGroup,
} from "./session-transcript";
import {
  resolveTranscriptLiveFollow,
  type TranscriptLiveFollowEvent,
} from "./session-transcript-live-follow";
import { flattenTranscriptPages, subagentStates } from "./session-transcript-model";
import { useSessionDraft } from "./use-session-draft";
import { useSessionExecution } from "./use-session-execution";
import { WorkspaceListHeader } from "./workspace-list-header";
import { WorkspaceNewSessionAction } from "./workspace-new-session-action";
import {
  getComposerDockKeyboardOffset,
  needsComposerDockMeasurement,
  searchResultItems,
  type WorkspaceGroup,
  type WorkspaceInboxItem,
  workspaceGroupLabels,
  workspaceInboxItems,
} from "./workspace-screen-model";

type WorkspaceProps = NativeStackScreenProps<RootStackParamList, "Workspace">;
type SessionProps = NativeStackScreenProps<RootStackParamList, "Session">;

const messagePageSize = 40;
const sessionListLimit = 20;
const maxTranscriptPages = 5;
const iosKeyboardTransparentTopInset = 32;
const liveEdgeThreshold = 2;
// While following, rows ease to their new layout when the newest row grows: older text slides
// up and new lines rise in from the bottom edge. Reanimated animates each row's frame in the
// commit that changes it, so no frame shows the jump. A critically damped spring at this rate
// moves one 22-point line at up to about 140 pt/s and settles in about 0.33 s, close to the
// OpenCode iOS app.
const liveEdgeRowTransition = LinearTransition.springify().mass(1).stiffness(289).damping(34);
const userScrollSettleMs = 160;
const mentionFileLimit = 20;
const unresolvedLocation = { directory: "__unresolved__" } satisfies LocationRef;
const rowRipple = Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)" } : undefined;
const borderlessRipple =
  Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)", borderless: true } : undefined;
const noCollapsedGroups: ReadonlySet<WorkspaceGroup> = new Set();
// Collapsed groups last for the app session, per connection, and are never persisted.
const collapsedGroupsByConnection = new Map<string, ReadonlySet<WorkspaceGroup>>();

export function WorkspaceScreen({ navigation }: WorkspaceProps) {
  const db = useSQLiteContext();
  const runtime = useConnectionRuntime();
  const workspaceSelection = useWorkspaceSelection();
  const connections = useConnections();
  const queryClient = useQueryClient();
  const { fontScale, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const largeText = usesLargeTextLayout(fontScale);
  const tablet = isTabletShell(width);
  const connectionId = runtime.connectionId;
  const client = runtime.restClient;
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedDirectory, setSelectedDirectory] = useState<string>();
  const [sessionSearch, setSessionSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [screenFocused, setScreenFocused] = useState(() => navigation.isFocused?.() ?? true);
  const [actionSession, setActionSession] = useState<SessionInfo>();
  const presentationScope = connectionId ?? "unselected";
  const [collapsedGroups, setCollapsedGroups] = useState(
    () => collapsedGroupsByConnection.get(presentationScope) ?? noCollapsedGroups,
  );
  const showAttentionNotice = useDelayedVisibility(
    workspaceSelection.attentionCoverage.freshness === "stale" ||
      (workspaceSelection.attentionCoverage.freshness === "current" &&
        workspaceSelection.attentionCoverage.completeness === "incomplete"),
    presentationScope,
  );
  const showConnectionNotice = useDelayedVisibility(
    runtime.status !== "connected",
    presentationScope,
  );
  const [refreshing, setRefreshing] = useState(false);
  const removeAbortRef = useRef<AbortController>(null);
  const refreshGenerationRef = useRef(0);
  const deferredSessionSearch = useDeferredValue(sessionSearch.trim());

  useEffect(() => {
    void connectionId;
    setSelectedProjectId(undefined);
    setSelectedDirectory(undefined);
    setSessionSearch("");
    setSearchOpen(false);
    setActionSession(undefined);
    refreshGenerationRef.current += 1;
    setRefreshing(false);
  }, [connectionId]);

  useEffect(() => {
    setCollapsedGroups(collapsedGroupsByConnection.get(presentationScope) ?? noCollapsedGroups);
  }, [presentationScope]);

  useEffect(() => {
    const focus = navigation.addListener?.("focus", () => setScreenFocused(true));
    const blur = navigation.addListener?.("blur", () => setScreenFocused(false));
    return () => {
      focus?.();
      blur?.();
    };
  }, [navigation]);

  // Android back closes an open search before it can leave the screen.
  useEffect(() => {
    if (!searchOpen || !screenFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setSessionSearch("");
      setSearchOpen(false);
      Keyboard.dismiss();
      return true;
    });
    return () => subscription.remove();
  }, [screenFocused, searchOpen]);

  const projectsQuery = useQuery({
    enabled: Boolean(client && connectionId),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return listOpenCodeProjects(client, { signal });
    },
    queryKey: openCodeQueryKeys.projects(connectionId ?? "unselected"),
  });
  const defaultLocationQuery = useQuery({
    enabled: Boolean(client && connectionId),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getDefaultOpenCodeLocation(client, { signal });
    },
    queryKey: openCodeQueryKeys.defaultLocation(connectionId ?? "unselected"),
  });
  const projects = projectsQuery.data ?? [];
  const defaultProjectId = defaultLocationQuery.data?.project.id;
  const defaultDirectory = defaultLocationQuery.data?.directory;

  useEffect(() => {
    if (workspaceSelection.preferencesLoading) return;
    if (selectedProjectId && workspaceSelection.followedProjectIds.includes(selectedProjectId)) {
      return;
    }
    const followedProjects = projects.filter((project) =>
      workspaceSelection.followedProjectIds.includes(project.id),
    );
    const project =
      followedProjects.find((candidate) => candidate.id === defaultProjectId) ??
      followedProjects[0];
    if (!project) return;
    setSelectedProjectId(project.id);
    setSelectedDirectory(
      project.id === defaultProjectId && defaultDirectory ? defaultDirectory : project.canonical,
    );
  }, [
    defaultDirectory,
    defaultProjectId,
    projects,
    selectedProjectId,
    workspaceSelection.followedProjectIds,
    workspaceSelection.preferencesLoading,
  ]);

  const requestedLocation = selectedDirectory
    ? ({ directory: selectedDirectory } satisfies LocationRef)
    : undefined;
  const locationQuery = useQuery({
    enabled: Boolean(client && connectionId && requestedLocation),
    queryFn: ({ signal }) => {
      if (!client || !requestedLocation) throw new Error("LOCATION_NOT_SELECTED");
      return getOpenCodeLocation(client, requestedLocation, { signal });
    },
    queryKey: openCodeQueryKeys.location(
      connectionId ?? "unselected",
      requestedLocation ?? unresolvedLocation,
    ),
  });
  const location = locationQuery.data;
  const mutationScope = `${connectionId ?? ""}\u0000${location?.directory ?? ""}`;

  useEffect(() => {
    workspaceSelection.setSearch(deferredSessionSearch);
  }, [deferredSessionSearch, workspaceSelection.setSearch]);

  useEffect(() => {
    void mutationScope;
    return () => {
      removeAbortRef.current?.abort();
    };
  }, [mutationScope]);

  useEffect(() => {
    workspaceSelection.setLocation(location);
  }, [location, workspaceSelection.setLocation]);

  const inbox = workspaceSelection.inbox;
  const inboxItems: WorkspaceInboxItem[] = deferredSessionSearch
    ? searchResultItems(inbox)
    : workspaceInboxItems(inbox, sessionListLimit, collapsedGroups);
  const sessionCount = inbox.needsYou.length + inbox.working.length + inbox.recent.length;
  const selectedConnection = connections.profiles.find(
    (profile) => profile.id === connections.selectedProfileId,
  );
  const connectionPresentation = getConnectionPresentation(
    runtime.status,
    runtime.reconnectAttempt,
  );

  function closeSearch() {
    setSessionSearch("");
    setSearchOpen(false);
    Keyboard.dismiss();
  }

  function toggleGroup(group: WorkspaceGroup) {
    const collapsing = !collapsedGroups.has(group);
    const next = new Set(collapsedGroups);
    if (collapsing) next.add(group);
    else next.delete(group);
    collapsedGroupsByConnection.set(presentationScope, next);
    if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsedGroups(next);
    announceOnIOS(`${workspaceGroupLabels[group]} ${collapsing ? "collapsed" : "expanded"}`);
  }

  const removeMutation = useMutation({
    mutationFn: async (session: SessionInfo) => {
      if (!client || !connectionId) throw new Error("CONNECTION_NOT_READY");
      const controller = new AbortController();
      removeAbortRef.current?.abort();
      removeAbortRef.current = controller;
      try {
        const sessionIds = await loadOpenCodeSessionTreeIds(
          client,
          session.location,
          session.id,
          controller.signal,
        );
        await removeOpenCodeSession(client, session.id, { signal: controller.signal });
        const cleanupSucceeded = await deleteSessionLocalState(db, connectionId, sessionIds).then(
          () => true,
          () => false,
        );
        return { cleanupSucceeded, location: session.location, sessionIds };
      } catch (error) {
        if (controller.signal.aborted) throw new Error("REQUEST_ABORTED");
        throw error;
      } finally {
        if (removeAbortRef.current === controller) removeAbortRef.current = null;
      }
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "REQUEST_ABORTED") return;
      Alert.alert("Delete failed", "The session is still present. Refresh and try again.");
    },
    onSuccess: ({ cleanupSucceeded, location: deletedLocation, sessionIds }) => {
      if (!connectionId) return;
      for (const deletedSessionID of sessionIds) {
        queryClient.removeQueries({
          queryKey: openCodeQueryKeys.session(connectionId, deletedLocation, deletedSessionID),
        });
        queryClient.removeQueries({
          queryKey: openCodeQueryKeys.messageRoot(connectionId, deletedLocation, deletedSessionID),
        });
        queryClient.removeQueries({
          queryKey: openCodeQueryKeys.inbox(connectionId, deletedLocation, deletedSessionID),
        });
        queryClient.removeQueries({
          queryKey: openCodeQueryKeys.promptAdmissions(
            connectionId,
            deletedLocation,
            deletedSessionID,
          ),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: openCodeQueryKeys.connection(connectionId),
      });
      if (!cleanupSucceeded) {
        Alert.alert(
          "Local cleanup incomplete",
          "The server deleted the session, but encrypted local state could not be removed. Removing this connection profile will clear it.",
        );
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => undefined,
      );
    },
  });

  async function refresh() {
    if (refreshing) return;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    setRefreshing(true);
    try {
      await Promise.all([
        workspaceSelection.refetch(),
        ...(requestedLocation ? [locationQuery.refetch()] : []),
      ]);
    } finally {
      if (refreshGenerationRef.current === generation) setRefreshing(false);
    }
  }

  function openSession(row: FollowedInboxRow) {
    if (!connectionId) return;
    navigation.navigate("Session", {
      connectionId,
      location: row.targetLocation,
      sessionID: row.targetSessionID,
    });
  }

  function confirmDelete(session: SessionInfo, projectLabel: string) {
    const host = selectedConnection?.name ?? "selected server";
    const childWarning = session.parentID
      ? "This is a child session."
      : "Deleting a parent also deletes all child sessions.";
    Alert.alert(
      "Delete session?",
      `Host: ${host}\nProject: ${projectLabel}\nLocation: ${session.location.directory}\n\n${childWarning}`,
      [
        { style: "cancel", text: "Cancel" },
        { onPress: () => removeMutation.mutate(session), style: "destructive", text: "Delete" },
      ],
    );
  }

  const attentionNotice = showAttentionNotice
    ? workspaceSelection.attentionCoverage.freshness === "stale"
      ? "Request status is stale. Reconnect to check pending requests."
      : "Some request locations could not be checked."
    : undefined;
  const connectionNotice = showConnectionNotice
    ? runtime.cacheMetadata
      ? "Showing saved data until the server reconnects."
      : "Waiting for current server data."
    : undefined;
  useAnnouncement(attentionNotice);
  useAnnouncement(connectionNotice);
  useAnnouncement(workspaceSelection.sessionsError && "Sessions could not be loaded.");

  const header = (
    <View style={styles.homeHeader}>
      {!tablet &&
      workspaceSelection.pendingCount > 0 &&
      (Boolean(sessionSearch) ||
        workspaceSelection.pendingCount >
          inbox.needsYou.reduce((sum, row) => sum + row.attentionCount, 0)) ? (
        <View style={styles.workspaceActions}>
          <HeaderAction
            accessibilityHint="Opens permission and form requests"
            accessibilityLabel={`${workspaceSelection.pendingCount} known ${workspaceSelection.pendingCount === 1 ? "request" : "requests"}`}
            attention
            label={
              workspaceSelection.pendingCount > 99
                ? "Needs you 99+"
                : `Needs you ${workspaceSelection.pendingCount}`
            }
            onPress={() => navigation.navigate("Pending")}
          />
        </View>
      ) : null}
      {attentionNotice ? (
        <View style={styles.notice}>
          <Text
            accessibilityLiveRegion="polite"
            dynamicTypeRamp={typeRamp.footnote}
            style={styles.connectionNotice}
          >
            {attentionNotice}
          </Text>
          {workspaceSelection.attentionCoverage.freshness !== "stale" ? (
            <RetryButton busy={refreshing} onPress={() => void refresh()} />
          ) : null}
        </View>
      ) : null}
      {connectionNotice ? (
        <Text
          accessibilityLiveRegion="polite"
          dynamicTypeRamp={typeRamp.footnote}
          style={styles.connectionNotice}
        >
          {connectionNotice}
        </Text>
      ) : null}
      {deferredSessionSearch ? (
        <ListSectionHeader count={sessionCount} label="Search results" />
      ) : null}
    </View>
  );

  return (
    <ShellFrame
      active="Workspace"
      hideConnectionBar
      navigate={(section) => navigation.navigate(section)}
    >
      <WorkspaceListHeader
        connection={connectionPresentation}
        connectionName={selectedConnection?.name}
        onChangeSearch={setSessionSearch}
        onCloseSearch={closeSearch}
        onOpenConnections={() => {
          Keyboard.dismiss();
          navigation.navigate("Connections");
        }}
        onOpenSearch={() => setSearchOpen(true)}
        search={sessionSearch}
        searchEditable={workspaceSelection.followedProjectIds.length > 0}
        searchOpen={searchOpen}
        topInset={tablet ? 0 : insets.top}
        trailing={
          tablet ? (
            <WorkspaceHeaderActions
              navigate={(destination) => navigation.navigate(destination)}
              onNewSession={() => navigation.navigate("NewSession")}
            />
          ) : null
        }
      />
      <FlatList
        ListEmptyComponent={
          <SessionEmptyState
            error={workspaceSelection.sessionsError}
            hasLocation={workspaceSelection.followedProjectIds.length > 0}
            loading={workspaceSelection.sessionsLoading}
            search={deferredSessionSearch}
            onChooseProjects={() => navigation.navigate("FollowedProjects")}
            onRetry={() => void refresh()}
            refreshing={refreshing}
          />
        }
        ListFooterComponent={
          deferredSessionSearch && workspaceSelection.hasNextPage ? (
            <View style={styles.listFooter}>
              <ActionButton
                busy={workspaceSelection.sessionsFetchingNextPage}
                label="Load more results"
                onPress={() => void workspaceSelection.fetchNextPage()}
                secondary
              />
            </View>
          ) : null
        }
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        data={inboxItems}
        extraData={fontScale}
        keyboardShouldPersistTaps="handled"
        key={`workspace-sessions:${fontScale}`}
        keyExtractor={(item) => item.key}
        maxToRenderPerBatch={12}
        initialNumToRender={12}
        refreshControl={
          <RefreshControl
            onRefresh={() => void refresh()}
            refreshing={refreshing}
            tintColor={palette.signal}
          />
        }
        renderItem={({ item }) =>
          item.type === "group" ? (
            <GroupSeparator item={item} onPress={() => toggleGroup(item.group)} />
          ) : (
            <SessionRow
              onActions={() => setActionSession(item.row.session)}
              largeText={largeText}
              onDelete={() => confirmDelete(item.row.session, item.row.projectLabel)}
              onPress={() => openSession(item.row)}
              row={item.row}
            />
          )
        }
        updateCellsBatchingPeriod={40}
        windowSize={7}
      />
      <WorkspaceNewSessionAction
        // The search field unmounts on close without a reliable blur, so key off searchOpen.
        showSettings={!tablet && !searchOpen}
        onNavigate={(destination) => navigation.navigate(destination)}
        eligible={!tablet && !searchOpen}
        onPress={() => navigation.navigate("NewSession")}
      />
      {actionSession && connectionId ? (
        <SessionActionSheet
          key={`${connectionId}:${actionSession.id}`}
          connectionId={connectionId}
          session={actionSession}
          onClose={() => setActionSession(undefined)}
          onDeleted={() => setActionSession(undefined)}
        />
      ) : null}
    </ShellFrame>
  );
}

export function SessionScreen({ navigation, route }: SessionProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [screenFocused, setScreenFocused] = useState(() => navigation.isFocused?.() ?? true);
  useEffect(() => {
    const focus = navigation.addListener?.("focus", () => setScreenFocused(true));
    const blur = navigation.addListener?.("blur", () => setScreenFocused(false));
    return () => {
      focus?.();
      blur?.();
    };
  }, [navigation]);
  const transcriptPreferences = useTranscriptPreferences();
  const runtime = useConnectionRuntime();
  const modelFavorites = useModelFavorites(runtime.connectionId, runtime.connectionUpdatedAtMs);
  const workspaceSelection = useWorkspaceSelection();
  const queryClient = useQueryClient();
  const { fontScale, width } = useWindowDimensions();
  const screenHeight = Dimensions.get("screen").height;
  const largeText = usesLargeTextLayout(fontScale);
  const { connectionId: routeConnectionId, focusComposer, location, sessionID } = route.params;
  const connectionId = runtime.connectionId;
  const client = runtime.restClient;
  const routeSessionScope = `${routeConnectionId}\u0000${sessionID}\u0000${location.directory}\u0000${location.workspaceID ?? ""}`;
  const [sessionTab, setSessionTab] = useState<{ scope: string; tab: "session" | "changes" }>({
    scope: routeSessionScope,
    tab: "session",
  });
  const selectedTab = sessionTab.scope === routeSessionScope ? sessionTab.tab : "session";
  const [sessionQueryScope, setSessionQueryScope] = useState({
    location,
    routeSessionScope,
  });
  const sessionQueryLocation =
    sessionQueryScope.routeSessionScope === routeSessionScope
      ? sessionQueryScope.location
      : location;
  const [liveFollowEnabled, setLiveFollowEnabled] = useState(true);
  const reducedMotion = useReducedMotion();
  // New rows and lines land below the anchored row, then the native list scrolls
  // them into view, so streamed text slides up instead of popping in.
  const smoothLiveEdge = liveFollowEnabled && !reducedMotion;
  const smoothLiveEdgeRef = useRef(smoothLiveEdge);
  smoothLiveEdgeRef.current = smoothLiveEdge;
  const [transcriptSize, setTranscriptSize] = useState({ scope: "", viewport: 0, content: 0 });
  const [latestJumpPending, setLatestJumpPending] = useState(false);
  const [composerDockHeight, setComposerDockHeight] = useState(66);
  const [composerDockScreenBottom, setComposerDockScreenBottom] = useState(0);
  const [composerKeyboardOffset, setComposerKeyboardOffset] = useState(0);
  const [mentionSearch, setMentionSearch] = useState<string>();
  const deferredMentionSearch = useDeferredValue(mentionSearch);
  const composerDockRef = useRef<View>(null);
  const measuredComposerDockScreenHeightRef = useRef<number | undefined>(undefined);
  const transcriptListRef = useRef<FlatList<TranscriptListItem>>(null);
  const liveFollowEnabledRef = useRef(true);
  const latestJumpPendingRef = useRef(false);
  const userScrollSessionRef = useRef(false);
  const userScrollSettleTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const followFrameRef = useRef<number>(null);
  const lastScrollOffsetRef = useRef(0);
  const sessionQuery = useQuery({
    enabled: Boolean(client && connectionId === routeConnectionId),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getOpenCodeSession(client, sessionID, { signal });
    },
    queryKey: openCodeQueryKeys.session(
      connectionId ?? "unselected",
      sessionQueryLocation,
      sessionID,
    ),
  });
  const session = sessionQuery.data;
  const sessionTitle = connectionId === routeConnectionId ? session?.title?.trim() : undefined;
  useEffect(() => {
    navigation.setOptions({ title: sessionTitle || "Untitled session" });
  }, [navigation, sessionTitle]);
  const sessionLocation = session?.location ?? sessionQueryLocation;
  const sessionLocationReady = Boolean(
    sessionQuery.isSuccess && session && locationsEqual(session.location, sessionQueryLocation),
  );
  useEffect(() => {
    void routeSessionScope;
    setActionsOpen(false);
  }, [routeSessionScope]);
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Session actions"
          accessibilityState={{ disabled: !sessionLocationReady }}
          android_ripple={borderlessRipple}
          disabled={!sessionLocationReady}
          onPress={() => {
            Keyboard.dismiss();
            setActionsOpen(true);
          }}
          style={({ pressed }) => [
            styles.sessionActionsButton,
            !sessionLocationReady && styles.disabled,
            pressed && Platform.OS === "ios" && styles.pressed,
          ]}
        >
          <Feather accessible={false} name="more-horizontal" size={20} color={palette.ink} />
        </Pressable>
      ),
    });
  }, [navigation, sessionLocationReady]);
  const vcsQuery = useQuery({
    enabled: Boolean(client && connectionId === routeConnectionId && sessionLocationReady),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getOpenCodeVcs(client, sessionLocation, { signal });
    },
    queryKey: openCodeQueryKeys.vcs(connectionId ?? "unselected", sessionLocation),
  });
  const messagesQuery = useInfiniteQuery({
    enabled: Boolean(client && connectionId === routeConnectionId && sessionLocationReady),
    getNextPageParam: (lastPage: SessionMessagesResponse) => lastPage.cursor.next ?? undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<SessionMessagesResponse> => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return listOpenCodeMessages(
        client,
        sessionID,
        pageParam
          ? { cursor: pageParam, limit: messagePageSize }
          : { limit: messagePageSize, order: "desc" },
        { signal },
      );
    },
    queryKey: openCodeQueryKeys.messages(connectionId ?? "unselected", sessionLocation, sessionID, {
      limit: messagePageSize,
      order: "desc",
    }),
  });
  const mentionFilesQuery = useQuery({
    enabled: Boolean(
      client &&
        connectionId === routeConnectionId &&
        sessionLocationReady &&
        deferredMentionSearch !== undefined,
    ),
    queryFn: ({ signal }) => {
      if (!client || deferredMentionSearch === undefined) throw new Error("CONNECTION_NOT_READY");
      return findOpenCodeFiles(client, sessionLocation, deferredMentionSearch, {
        limit: mentionFileLimit,
        signal,
      });
    },
    queryKey: openCodeQueryKeys.fileFind(
      routeConnectionId,
      sessionLocation,
      deferredMentionSearch ?? "",
      mentionFileLimit,
    ),
  });
  const currentBranch = vcsQuery.data?.data.branch.current;
  const branch = currentBranch
    ? ({
        name: currentBranch,
        stale: vcsQuery.isError || runtime.status !== "connected",
        state: "known",
      } as const)
    : vcsQuery.isError || runtime.status !== "connected"
      ? ({ state: "unavailable" } as const)
      : vcsQuery.isPending
        ? ({ state: "loading" } as const)
        : ({ state: "none" } as const);
  const messagePages = messagesQuery.data?.pages;
  const messages = useMemo(() => flattenTranscriptPages(messagePages), [messagePages]);
  const { items: projectedTranscriptItems, footers: transcriptFooters } =
    buildTranscriptPresentation(
      messages,
      transcriptPreferences.detailed,
      transcriptPreferences.reasoning,
    );
  const draft = useSessionDraft(routeConnectionId, sessionID);
  const execution = useSessionExecution({
    client: sessionLocationReady ? client : undefined,
    connectionId,
    draftReady: draft.loaded,
    draftRevision: draft.revision,
    location: sessionLocation,
    messages,
    onAdmissionConfirmed: draft.clearDraft,
    persistDraft: draft.persistDraft,
    refetchMessages: async () => messagesQuery.refetch(),
    routeConnectionId,
    session,
    sessionID,
  });
  const activeSessions = execution.activeSessions;
  const transcriptSubagentStates = useMemo(
    () => subagentStates(messages, activeSessions, sessionID),
    [activeSessions, messages, sessionID],
  );
  const transcriptItems: TranscriptListItem[] = [
    ...execution.pendingPrompts,
    ...projectedTranscriptItems,
  ];
  const sessionPermissions = workspaceSelection.permissions.filter(
    (request) => request.sessionID === sessionID,
  );
  const sessionForms = workspaceSelection.forms.filter((form) => form.sessionID === sessionID);
  const sessionMutationScope = `${routeConnectionId}\u0000${sessionID}`;
  const transcriptPageCount = messagesQuery.data?.pages.length ?? 0;
  const canLoadOlder = Boolean(
    messagesQuery.hasNextPage && transcriptPageCount < maxTranscriptPages,
  );
  const transcriptMeasureScope = JSON.stringify([
    routeSessionScope,
    sessionLocation.directory,
    (sessionLocation as LocationRef).workspaceID ?? null,
    fontScale,
  ]);
  const autoFillTranscript = Boolean(
    canLoadOlder &&
      screenFocused &&
      selectedTab === "session" &&
      sessionLocationReady &&
      connectionId === routeConnectionId &&
      runtime.status === "connected" &&
      liveFollowEnabled &&
      !messagesQuery.isPending &&
      !messagesQuery.isError &&
      transcriptSize.scope === transcriptMeasureScope &&
      transcriptSize.viewport > 0 &&
      transcriptSize.content > 0 &&
      transcriptSize.content < transcriptSize.viewport - space.md,
  );
  const showOlderContextLoading = useDelayedVisibility(autoFillTranscript, transcriptMeasureScope);
  useEffect(() => {
    void transcriptPageCount;
    if (!autoFillTranscript || messagesQuery.isFetching) return;
    // Let native layout reflect the latest compact rows before requesting another page.
    const frame = requestAnimationFrame(() => {
      void messagesQuery.fetchNextPage().catch(() => undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    autoFillTranscript,
    messagesQuery.fetchNextPage,
    messagesQuery.isFetching,
    transcriptPageCount,
  ]);
  const openSubagent = useCallback(
    (childSessionID: string) => {
      navigation.push("Session", {
        connectionId: routeConnectionId,
        location: sessionLocation,
        sessionID: childSessionID,
      });
    },
    [navigation, routeConnectionId, sessionLocation],
  );
  const openDiff = useCallback(() => {
    navigation.push("Diff", {
      connectionId: routeConnectionId,
      location: sessionLocation,
      mode: "working",
    });
  }, [navigation, routeConnectionId, sessionLocation]);

  useEffect(() => {
    if (!session || locationsEqual(session.location, sessionQueryLocation)) return;
    queryClient.setQueryData(
      openCodeQueryKeys.session(routeConnectionId, session.location, sessionID),
      session,
    );
    setSessionQueryScope({ location: session.location, routeSessionScope });
  }, [queryClient, routeConnectionId, routeSessionScope, session, sessionID, sessionQueryLocation]);

  useEffect(() => {
    if (!sessionLocationReady) return;
    workspaceSelection.setLocation(sessionLocation);
  }, [sessionLocation, sessionLocationReady, workspaceSelection.setLocation]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;

    function updateKeyboardFrame(event: KeyboardEvent) {
      Keyboard.scheduleLayoutAnimation(event);
      setComposerKeyboardOffset(
        getComposerDockKeyboardOffset(
          composerDockScreenBottom,
          event.endCoordinates.screenY,
          iosKeyboardTransparentTopInset,
        ),
      );
    }

    function clearKeyboardFrame(event: KeyboardEvent) {
      Keyboard.scheduleLayoutAnimation(event);
      setComposerKeyboardOffset(0);
    }

    const frameSubscriptions = [
      Keyboard.addListener("keyboardWillChangeFrame", updateKeyboardFrame),
      Keyboard.addListener("keyboardDidShow", updateKeyboardFrame),
    ];
    const hideSubscription = Keyboard.addListener("keyboardWillHide", clearKeyboardFrame);
    return () => {
      for (const subscription of frameSubscriptions) subscription.remove();
      hideSubscription.remove();
    };
  }, [composerDockScreenBottom]);

  useEffect(() => {
    void sessionMutationScope;
    if (userScrollSettleTimerRef.current !== null) {
      clearTimeout(userScrollSettleTimerRef.current);
      userScrollSettleTimerRef.current = null;
    }
    if (followFrameRef.current !== null) {
      cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }
    userScrollSessionRef.current = false;
    lastScrollOffsetRef.current = 0;
    liveFollowEnabledRef.current = true;
    latestJumpPendingRef.current = false;
    setLiveFollowEnabled(true);
    setLatestJumpPending(false);
    return () => {
      if (userScrollSettleTimerRef.current !== null) {
        clearTimeout(userScrollSettleTimerRef.current);
        userScrollSettleTimerRef.current = null;
      }
      if (followFrameRef.current !== null) {
        cancelAnimationFrame(followFrameRef.current);
        followFrameRef.current = null;
      }
    };
  }, [sessionMutationScope]);

  useEffect(() => {
    recordTranscriptResidentSet(transcriptPageCount, messages.length);
  }, [messages.length, transcriptPageCount]);

  function transitionLiveFollow(event: TranscriptLiveFollowEvent) {
    const next = resolveTranscriptLiveFollow(liveFollowEnabledRef.current, event);
    if (next === liveFollowEnabledRef.current) return;
    liveFollowEnabledRef.current = next;
    setLiveFollowEnabled(next);
  }

  function clearUserScrollSettle() {
    if (userScrollSettleTimerRef.current === null) return;
    clearTimeout(userScrollSettleTimerRef.current);
    userScrollSettleTimerRef.current = null;
  }

  function cancelFollowFrame() {
    if (followFrameRef.current === null) return;
    cancelAnimationFrame(followFrameRef.current);
    followFrameRef.current = null;
  }

  function isAtLiveEdge(offset = lastScrollOffsetRef.current) {
    return offset <= liveEdgeThreshold;
  }

  function recordTranscriptOffset(rawOffset: number) {
    const offset = Math.max(0, rawOffset);
    lastScrollOffsetRef.current = offset;
    if (latestJumpPendingRef.current && isAtLiveEdge(offset)) {
      latestJumpPendingRef.current = false;
      setLatestJumpPending(false);
    }
    return offset;
  }

  function scheduleLiveEdgeScroll() {
    if (
      !liveFollowEnabledRef.current ||
      transcriptItems.length === 0 ||
      followFrameRef.current !== null
    ) {
      return;
    }
    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = null;
      if (!liveFollowEnabledRef.current) return;
      recordTranscriptFollowCorrection();
      transcriptListRef.current?.scrollToOffset({ animated: false, offset: 0 });
    });
  }

  function handleTranscriptScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const offset = recordTranscriptOffset(event.nativeEvent.contentOffset.y);
    const atLiveEdge = isAtLiveEdge(offset);
    transitionLiveFollow({
      isAtLiveEdge: atLiveEdge,
      type: "scroll",
      userScrollSessionActive: userScrollSessionRef.current,
    });
  }

  function handleScrollBeginDrag() {
    clearUserScrollSettle();
    if (latestJumpPendingRef.current) {
      latestJumpPendingRef.current = false;
      setLatestJumpPending(false);
    }
    userScrollSessionRef.current = true;
    transitionLiveFollow({ type: "user-scroll-begin" });
  }

  function finishUserScroll(releaseIsAtLiveEdge?: boolean) {
    clearUserScrollSettle();
    const userScrollSessionActive = userScrollSessionRef.current;
    userScrollSessionRef.current = false;
    transitionLiveFollow({
      isAtLiveEdge: releaseIsAtLiveEdge ?? isAtLiveEdge(),
      type: "user-scroll-end",
      userScrollSessionActive,
    });
  }

  function handleScrollEndDrag(event: NativeSyntheticEvent<NativeScrollEvent>) {
    clearUserScrollSettle();
    const offset = recordTranscriptOffset(event.nativeEvent.contentOffset.y);
    const releaseIsAtLiveEdge = isAtLiveEdge(offset);
    userScrollSettleTimerRef.current = setTimeout(
      () => finishUserScroll(releaseIsAtLiveEdge),
      userScrollSettleMs,
    );
  }

  function handleMomentumScrollBegin() {
    if (userScrollSessionRef.current) clearUserScrollSettle();
  }

  function handleMomentumScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    recordTranscriptOffset(event.nativeEvent.contentOffset.y);
    finishUserScroll();
  }

  function scrollToLatest() {
    clearUserScrollSettle();
    cancelFollowFrame();
    userScrollSessionRef.current = false;
    latestJumpPendingRef.current = true;
    setLatestJumpPending(true);
    recordTranscriptLatestJump();
    transitionLiveFollow({ type: "reset" });
    transcriptListRef.current?.scrollToOffset({ animated: true, offset: 0 });
    void Haptics.selectionAsync().catch(() => undefined);
  }

  function measureComposerDock() {
    if (
      !needsComposerDockMeasurement(
        measuredComposerDockScreenHeightRef.current,
        screenHeight,
        composerKeyboardOffset > 0,
      )
    ) {
      return;
    }
    composerDockRef.current?.measureInWindow((_x, y, _width, height) => {
      measuredComposerDockScreenHeightRef.current = screenHeight;
      const screenBottom = y + height;
      setComposerDockScreenBottom((current) =>
        Math.abs(current - screenBottom) < 1 ? current : screenBottom,
      );
    });
  }

  function measureComposerContent(event: LayoutChangeEvent) {
    const height = event.nativeEvent.layout.height;
    setComposerDockHeight((current) => (Math.abs(current - height) < 1 ? current : height));
  }

  if (connectionId !== routeConnectionId) {
    return (
      <ShellFrame
        active="Workspace"
        navigate={(section) =>
          section === "Workspace" ? navigation.popTo("Workspace") : navigation.navigate(section)
        }
      >
        <View style={styles.staleRoute}>
          <InlineError message="This session belongs to a different connection." />
          <ActionButton label="Back to workspace" onPress={() => navigation.popTo("Workspace")} />
        </View>
      </ShellFrame>
    );
  }

  const composerDockContent = (
    <View onLayout={measureComposerContent}>
      <SessionBackgroundTasks
        key={routeSessionScope}
        activeSessions={activeSessions}
        sessionID={sessionID}
        messages={
          sessionLocationReady && runtime.status === "connected" && !messagesQuery.isError
            ? messages
            : []
        }
        onOpenChild={openSubagent}
      />
      <SessionExecutionPanel
        hideInterrupt
        hideStatus
        active={execution.active}
        admissions={execution.admissions}
        busyAction={execution.busyAction}
        canBackground={execution.canBackground}
        formRequests={
          sessionForms.length > 0 ? (
            <FormRequestList
              focusSingle={!isTabletShell(width) && sessionPermissions.length === 0}
              client={client}
              connectionId={connectionId}
              formLocations={workspaceSelection.formLocations}
              forms={sessionForms}
              location={sessionLocation}
            />
          ) : undefined
        }
        inbox={execution.inbox}
        onAllowRetry={execution.allowRetry}
        onCancelInbox={execution.cancelInbox}
        onCheckAdmission={execution.reconcileAdmission}
        onInterrupt={execution.interrupt}
        onBackground={execution.background}
        onReplyPermission={workspaceSelection.replyPermission}
        onSteerInbox={execution.steerInbox}
        failedPermissionReplyId={workspaceSelection.failedPermissionReplyId}
        permissions={sessionPermissions}
        projectedMessageIds={execution.projectedMessageIds}
        replyingPermissionId={workspaceSelection.replyingPermissionId}
      />
      <SessionComposer
        onInterrupt={execution.interrupt}
        interruptDisabled={
          Boolean(execution.busyAction) || !sessionLocationReady || runtime.status !== "connected"
        }
        stopping={execution.busyAction === "interrupt"}
        active={execution.active}
        agent={execution.selectedAgent}
        agents={execution.agents}
        agentCatalog={execution.agentCatalog}
        modelCatalog={execution.modelCatalog}
        favorites={modelFavorites}
        commands={execution.commands}
        completionLoading={execution.completionLoading}
        completionUnavailable={execution.completionUnavailable}
        delivery={execution.delivery}
        disabled={execution.submitDisabled || !draft.loaded || !sessionLocationReady}
        draft={draft.draft}
        editable={draft.loaded && sessionLocationReady}
        error={execution.error ?? draft.error}
        focusOnMount={focusComposer}
        largeText={largeText}
        location={sessionLocation}
        mentionAgents={execution.mentionAgents}
        mentionFiles={
          deferredMentionSearch === mentionSearch ? (mentionFilesQuery.data?.data ?? []) : []
        }
        mentionLoading={
          execution.mentionLoading ||
          (mentionSearch !== undefined &&
            (mentionFilesQuery.isPending || deferredMentionSearch !== mentionSearch))
        }
        mentions={draft.mentions}
        mentionUnavailable={execution.mentionUnavailable || mentionFilesQuery.isError}
        model={execution.selectedModel}
        models={execution.models}
        onAgentChange={execution.switchAgent}
        onDraftChange={draft.setDraft}
        onModelChange={execution.switchModel}
        onMentionSearchChange={setMentionSearch}
        onSubmit={(intent) => execution.submit(draft.draft, intent)}
        skills={execution.skills}
      />
    </View>
  );

  return (
    <ShellFrame
      active="Workspace"
      branch={branch}
      sessionTabs={{
        active: selectedTab,
        onSelect: (tab) => {
          Keyboard.dismiss();
          setSessionTab({ scope: routeSessionScope, tab });
        },
      }}
      navigate={(section) =>
        section === "Workspace" ? navigation.popTo("Workspace") : navigation.navigate(section)
      }
    >
      {selectedTab === "changes" ? (
        <SessionChanges
          connectionId={routeConnectionId}
          location={sessionLocation}
          mode="working"
        />
      ) : null}
      <View
        accessibilityLabel="Keyboard-aware session"
        style={[styles.transcriptContainer, selectedTab === "changes" && { display: "none" }]}
        accessibilityElementsHidden={selectedTab === "changes"}
        importantForAccessibility={selectedTab === "changes" ? "no-hide-descendants" : "auto"}
      >
        <SessionShellScope.Provider
          value={{
            client,
            connectionId: routeConnectionId,
            location: sessionLocation,
            enabled: Boolean(
              client &&
                connectionId === routeConnectionId &&
                sessionLocationReady &&
                screenFocused &&
                selectedTab === "session",
            ),
          }}
        >
          <SessionSubagentStates.Provider value={transcriptSubagentStates}>
            <Animated.FlatList
              accessibilityLabel="Session transcript"
              contentContainerStyle={[
                styles.detailContent,
                largeText && styles.detailContentLargeText,
              ]}
              data={transcriptItems}
              extraData={fontScale}
              initialNumToRender={12}
              inverted
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              keyboardShouldPersistTaps="handled"
              key={`session-transcript:${transcriptMeasureScope}`}
              keyExtractor={(message) => message.id}
              ListEmptyComponent={
                messagesQuery.isPending ? (
                  <View style={styles.transcriptState}>
                    <ActivityIndicator
                      accessibilityLabel="Loading transcript"
                      color={palette.signal}
                    />
                  </View>
                ) : messagesQuery.isError ? (
                  <View style={styles.transcriptState}>
                    <InlineError
                      message={
                        messagesQuery.error instanceof Error &&
                        messagesQuery.error.message === "MALFORMED_MESSAGE_LIST"
                          ? "This server returned unsupported transcript data."
                          : "The transcript could not be loaded. Refresh and try again."
                      }
                    />
                  </View>
                ) : null
              }
              ListFooterComponent={
                <View style={styles.detailHeader}>
                  {sessionQuery.isPending ? <ActivityIndicator color={palette.signal} /> : null}
                  {sessionQuery.isError ? (
                    <InlineError message="The session could not be loaded." />
                  ) : null}
                  {canLoadOlder && !autoFillTranscript ? (
                    <Button
                      label={messagesQuery.isFetchingNextPage ? "Loading" : "Load older"}
                      onPress={() => {
                        if (!messagesQuery.isFetchingNextPage) void messagesQuery.fetchNextPage();
                      }}
                      variant="text"
                    />
                  ) : null}
                  {showOlderContextLoading ? (
                    <Text dynamicTypeRamp={typeRamp.footnote} style={styles.transcriptLimit}>
                      Loading earlier context
                    </Text>
                  ) : null}
                  {messagesQuery.isFetchNextPageError ? (
                    <InlineError message="Earlier context could not be loaded. Tap Load older to retry." />
                  ) : null}
                  {!canLoadOlder && messagesQuery.hasNextPage ? (
                    <Text dynamicTypeRamp={typeRamp.footnote} style={styles.transcriptLimit}>
                      Older messages are not loaded on this device.
                    </Text>
                  ) : null}
                </View>
              }
              // The inverted list draws its header below the newest row.
              ListHeaderComponent={
                execution.active ? (
                  <View style={styles.workingStatus}>
                    <SessionWorkingStatus
                      hideInterrupt
                      busyAction={execution.busyAction}
                      canBackground={execution.canBackground}
                      onBackground={execution.background}
                      onInterrupt={execution.interrupt}
                      waitingFor={
                        sessionPermissions.length > 0
                          ? "permission"
                          : sessionForms.length > 0
                            ? "input"
                            : undefined
                      }
                    />
                  </View>
                ) : null
              }
              {...(smoothLiveEdge ? { itemLayoutAnimation: liveEdgeRowTransition } : {})}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              maxToRenderPerBatch={12}
              onContentSizeChange={(_width, height) => {
                setTranscriptSize((current) =>
                  current.scope === transcriptMeasureScope && current.content === height
                    ? current
                    : {
                        scope: transcriptMeasureScope,
                        viewport: current.scope === transcriptMeasureScope ? current.viewport : 0,
                        content: height,
                      },
                );
                scheduleLiveEdgeScroll();
              }}
              onLayout={(event) => {
                const height = event.nativeEvent.layout.height;
                setTranscriptSize((current) =>
                  current.scope === transcriptMeasureScope && current.viewport === height
                    ? current
                    : {
                        scope: transcriptMeasureScope,
                        viewport: height,
                        content: current.scope === transcriptMeasureScope ? current.content : 0,
                      },
                );
                scheduleLiveEdgeScroll();
              }}
              onMomentumScrollBegin={handleMomentumScrollBegin}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              onScroll={handleTranscriptScroll}
              onScrollBeginDrag={handleScrollBeginDrag}
              onScrollEndDrag={handleScrollEndDrag}
              ref={transcriptListRef}
              renderItem={({ item }) =>
                item.type === "pending-prompt" ? (
                  <PendingPromptRow preview={item} largeText={largeText} />
                ) : item.type === "activity-group" ? (
                  <TranscriptActivityGroup
                    waitingFor={
                      sessionPermissions.length > 0
                        ? "permission"
                        : sessionForms.length > 0
                          ? "input"
                          : undefined
                    }
                    item={item}
                    largeText={largeText}
                    showReasoning={transcriptPreferences.reasoning}
                    onOpenDiff={openDiff}
                    onOpenSubagent={openSubagent}
                  />
                ) : item.type === "updates-group" ? (
                  <TranscriptUpdatesGroup
                    item={item}
                    largeText={largeText}
                    onOpenSubagent={openSubagent}
                  />
                ) : (
                  <SessionTranscriptRow
                    hideFooter={!transcriptFooters.has(item.id)}
                    turnDuration={transcriptFooters.get(item.id) ?? null}
                    detailed={transcriptPreferences.detailed}
                    showReasoning={transcriptPreferences.reasoning}
                    largeText={largeText}
                    message={item}
                    modelName={
                      item.type === "assistant"
                        ? execution.models.find(
                            (model) =>
                              model.id === item.model.id &&
                              model.providerID === item.model.providerID,
                          )?.name
                        : undefined
                    }
                    onOpenDiff={openDiff}
                    onOpenSubagent={openSubagent}
                  />
                )
              }
              scrollEventThrottle={16}
              style={styles.transcriptList}
              updateCellsBatchingPeriod={40}
              windowSize={7}
            />
          </SessionSubagentStates.Provider>
        </SessionShellScope.Provider>
        {(!liveFollowEnabled || latestJumpPending) && transcriptItems.length > 0 ? (
          <Pressable
            accessibilityHint="Returns to new transcript output and resumes live follow"
            accessibilityLabel="Scroll to latest"
            accessibilityRole="button"
            onPress={scrollToLatest}
            style={({ pressed }) => [
              styles.latestButton,
              { bottom: composerDockHeight + composerKeyboardOffset + space.sm },
              pressed && styles.pressed,
            ]}
          >
            <Feather
              accessibilityElementsHidden
              color={palette.ink}
              importantForAccessibility="no-hide-descendants"
              name="arrow-down"
              size={24}
            />
          </Pressable>
        ) : null}
        <View
          pointerEvents="none"
          style={{ height: composerDockHeight + composerKeyboardOffset, flexShrink: 0 }}
        />
        {Platform.OS === "android" ? (
          <KeyboardStickyView
            accessibilityLabel="Keyboard composer dock"
            style={styles.composerDock}
          >
            {composerDockContent}
          </KeyboardStickyView>
        ) : (
          <View
            accessibilityLabel="Keyboard composer dock"
            onLayout={measureComposerDock}
            ref={composerDockRef}
            style={[styles.composerDock, { bottom: composerKeyboardOffset }]}
          >
            {composerDockContent}
          </View>
        )}
      </View>
      {actionsOpen && sessionQuery.data && sessionLocationReady ? (
        <SessionActionSheet
          key={JSON.stringify([routeSessionScope, sessionLocation])}
          connectionId={routeConnectionId}
          session={sessionQuery.data}
          branch={currentBranch}
          branchStale={branch.state === "known" && branch.stale}
          onClose={() => setActionsOpen(false)}
          onDeleted={() => {
            setActionsOpen(false);
            navigation.popTo("Workspace");
          }}
        />
      ) : null}
    </ShellFrame>
  );
}

function SessionRow({
  largeText,
  onDelete,
  onActions,
  onPress,
  row,
}: {
  largeText: boolean;
  onDelete: () => void;
  onActions: () => void;
  onPress: () => void;
  row: FollowedInboxRow;
}) {
  const { session } = row;
  const { fontScale } = useWindowDimensions();
  const blocked = row.attentionCount > 0;
  const title = session.title || "Untitled session";
  return (
    <ReanimatedSwipeable
      containerStyle={styles.swipeContainer}
      enableTrackpadTwoFingerGesture
      onSwipeableWillOpen={() => {
        void Haptics.selectionAsync().catch(() => undefined);
      }}
      overshootRight={false}
      renderRightActions={(_progress, _translation, swipeable) => (
        <Pressable
          accessibilityLabel={`Delete ${title}`}
          accessibilityRole="button"
          android_ripple={rowRipple}
          onPress={() => {
            swipeable.close();
            onDelete();
          }}
          style={({ pressed }) => [
            styles.swipeDelete,
            pressed && Platform.OS === "ios" && styles.pressed,
          ]}
        >
          <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.swipeDeleteLabel}>
            Delete
          </Text>
        </Pressable>
      )}
    >
      <Pressable
        accessibilityActions={[
          { name: "activate" },
          { label: "Delete session", name: "delete" },
          { label: "Session actions", name: "options" },
        ]}
        accessibilityHint="Opens the session. Long press for rename or delete"
        accessibilityLabel={sessionAccessibilityLabel(row)}
        accessibilityRole="button"
        android_ripple={rowRipple}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "activate") onPress();
          if (nativeEvent.actionName === "delete") onDelete();
          if (nativeEvent.actionName === "options") onActions();
        }}
        onPress={onPress}
        onLongPress={onActions}
        style={({ pressed }) => [
          styles.sessionRow,
          pressed && Platform.OS === "ios" && styles.pressed,
        ]}
      >
        <ProjectAvatar
          icon={row.projectIcon}
          lineHeight={typography.body.lineHeight * fontScale}
          name={row.projectLabel}
        />
        <View style={styles.sessionCopy}>
          <View style={styles.sessionTitleRow}>
            <Text
              dynamicTypeRamp={typeRamp.body}
              numberOfLines={largeText ? 3 : 1}
              style={styles.sessionTitle}
            >
              {title}
            </Text>
            {/* One body line tall, so the trailing status centers on the title's first line. */}
            <View
              style={[styles.sessionTrailing, { height: typography.body.lineHeight * fontScale }]}
              testID="session-row-trailing"
            >
              {blocked ? (
                <>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.sessionAttentionMarker}
                    testID="session-row-attention-marker"
                  />
                  <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.sessionStatusBlocked}>
                    {row.attentionLabel || "Needs input"}
                  </Text>
                </>
              ) : row.active ? (
                <WorkingIndicator />
              ) : (
                <Text dynamicTypeRamp={typeRamp.footnote} style={styles.sessionTime}>
                  {formatSessionTime(session.time.updated)}
                </Text>
              )}
            </View>
          </View>
          <Text
            dynamicTypeRamp={typeRamp.footnote}
            numberOfLines={largeText ? 2 : 1}
            style={styles.sessionProject}
          >
            {row.worktreeLabel ? `${row.projectLabel} · ${row.worktreeLabel}` : row.projectLabel}
          </Text>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

function GroupSeparator({
  item,
  onPress,
}: {
  item: Extract<WorkspaceInboxItem, { type: "group" }>;
  onPress: () => void;
}) {
  const label = workspaceGroupLabels[item.group];
  return (
    <Pressable
      accessibilityHint={item.collapsed ? "Expands the group" : "Collapses the group"}
      accessibilityLabel={`${label}, ${item.count} ${item.count === 1 ? "session" : "sessions"}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: !item.collapsed }}
      android_ripple={rowRipple}
      onPress={onPress}
      style={({ pressed }) => [
        styles.groupSeparator,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
      testID={`session-list-group-${item.group}`}
    >
      <Text dynamicTypeRamp={typeRamp.footnote} numberOfLines={1} style={styles.groupLabel}>
        {label}
      </Text>
      <View style={styles.groupRule} />
      <Feather
        accessible={false}
        color={palette.dim}
        name={item.collapsed ? "chevron-down" : "chevron-up"}
        size={16}
      />
    </Pressable>
  );
}

function SessionEmptyState({
  error,
  hasLocation,
  loading,
  onChooseProjects,
  onRetry,
  refreshing,
  search,
}: {
  error: boolean;
  hasLocation: boolean;
  loading: boolean;
  onChooseProjects: () => void;
  onRetry: () => void;
  refreshing: boolean;
  search: string;
}) {
  if (error) {
    return (
      <View style={styles.emptyState}>
        <InlineError message="Sessions could not be loaded." />
        <RetryButton busy={refreshing} onPress={onRetry} />
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.emptyState}>
        <ActivityIndicator accessibilityLabel="Loading sessions" color={palette.signal} />
      </View>
    );
  }
  if (!hasLocation) {
    return (
      <View style={styles.emptyState}>
        <Feather accessible={false} color={palette.dim} name="folder" size={36} />
        <Text
          accessibilityRole="header"
          dynamicTypeRamp={typeRamp.headline}
          style={styles.emptyTitle}
        >
          No projects followed yet
        </Text>
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.emptyCopy}>
          Sessions from the projects you follow show up here. You can also start a session in any
          project on this server.
        </Text>
        <Button
          align="center"
          label="Choose projects"
          onPress={onChooseProjects}
          style={styles.emptyAction}
          variant="primary"
        />
      </View>
    );
  }
  return (
    <View style={styles.emptyState}>
      <Text dynamicTypeRamp={typeRamp.headline} style={styles.emptyTitle}>
        {search ? "No sessions match this search." : "No sessions yet."}
      </Text>
    </View>
  );
}

function RetryButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return <Button busy={busy} label="Retry" onPress={onPress} size="compact" />;
}

function ListSectionHeader({ count, label }: { count: number; label: string }) {
  return (
    <View
      accessibilityLabel={`${label}, ${count}`}
      accessibilityRole="header"
      accessible
      style={styles.listSectionHeader}
    >
      <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.listSectionTitle}>
        {label}
      </Text>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.countLabel}>
        {count}
      </Text>
    </View>
  );
}

function HeaderAction({
  accessibilityHint,
  accessibilityLabel,
  attention,
  disabled,
  label,
  onPress,
}: {
  accessibilityHint: string;
  accessibilityLabel?: string;
  attention?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerAction,
        attention && styles.headerActionAttention,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text
        dynamicTypeRamp={typeRamp.control}
        style={[styles.headerActionLabel, attention && styles.headerActionLabelAttention]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
      {message}
    </Text>
  );
}

function formatSessionTime(value: number) {
  const elapsedMs = Date.now() - value;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "Now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  try {
    return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return "Earlier";
  }
}

function locationsEqual(first: LocationRef, second: LocationRef) {
  return (
    first.directory === second.directory &&
    (first.workspaceID ?? null) === (second.workspaceID ?? null)
  );
}

function sessionTimeDescription(value: number) {
  const elapsedMs = Date.now() - value;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) return "Updated just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `Updated ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
  try {
    return `Updated ${new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
  } catch {
    return "Updated earlier";
  }
}

function sessionAccessibilityLabel(row: FollowedInboxRow) {
  const { session } = row;
  const states = [
    row.projectLabel,
    row.worktreeLabel ? `Worktree ${row.worktreeLabel}` : undefined,
    row.active ? "Working" : undefined,
    row.attentionCount > 0 ? row.attentionLabel || "Needs input" : undefined,
    session.time.archived ? "Archived" : undefined,
    session.outcome ? sentenceCase(session.outcome) : undefined,
    sessionTimeDescription(session.time.updated),
  ].filter(Boolean);
  return `Open session ${session.title || "Untitled session"}${states.length > 0 ? `. ${states.join(". ")}` : ""}`;
}

function sentenceCase(value: string) {
  return value ? `${value[0]?.toLocaleUpperCase()}${value.slice(1).toLocaleLowerCase()}` : value;
}

const styles = StyleSheet.create({
  composerDock: { bottom: 0, left: 0, position: "absolute", right: 0, zIndex: 20 },
  workingStatus: { paddingHorizontal: space.md },
  connectionNotice: { ...typography.footnote, color: palette.warm, marginBottom: 2 },
  countLabel: { ...typography.footnote, color: palette.dim },
  disabled: { opacity: disabledOpacity },
  detailContent: {
    alignSelf: "center",
    maxWidth: 720,
    paddingBottom: 80,
    width: "100%",
  },
  detailContentLargeText: { paddingBottom: 140 },
  detailHeader: { paddingHorizontal: space.md, paddingTop: space.md },
  emptyAction: { marginTop: space.xs },
  emptyCopy: { ...typography.subheadline, color: palette.dim, textAlign: "center" },
  emptyState: {
    alignItems: "center",
    gap: space.sm,
    minHeight: 160,
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
  },
  emptyTitle: { ...typography.headline, color: palette.ink, textAlign: "center" },
  error: { ...typography.subheadline, color: palette.danger },
  headerAction: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: space.md,
  },
  headerActionAttention: { borderColor: palette.warm },
  headerActionLabel: { ...typography.control, color: palette.ink },
  headerActionLabelAttention: { color: palette.warm },
  groupLabel: { ...typography.footnote, color: palette.dim, flexShrink: 1 },
  groupRule: { backgroundColor: palette.border, flex: 1, height: StyleSheet.hairlineWidth },
  groupSeparator: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: space.md,
  },
  homeHeader: { paddingHorizontal: space.md },
  latestButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: "center",
    height: 48,
    width: 48,
    position: "absolute",
    zIndex: 1,
  },
  listContent: {
    alignSelf: "center",
    maxWidth: 760,
    paddingBottom: 80,
    width: "100%",
  },
  listFooter: { alignItems: "center", padding: space.lg },
  listSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: space.lg,
    paddingBottom: space.sm,
  },
  listSectionTitle: { ...typography.sectionLabel, color: palette.dim, flex: 1 },
  pressed: { opacity: pressedOpacity },
  notice: { alignItems: "flex-start", gap: space.xs, marginBottom: space.xs },
  sessionActionsButton: {
    alignItems: "center",
    height: minTouchTarget,
    justifyContent: "center",
    width: minTouchTarget,
  },
  sessionProject: { ...typography.footnote, color: palette.dim, flexShrink: 1 },
  sessionAttentionMarker: {
    backgroundColor: palette.warm,
    borderRadius: radius.pill,
    height: 7,
    width: 7,
  },
  sessionCopy: { flex: 1, gap: space.xs / 2, minWidth: 0 },
  sessionRow: {
    alignItems: "flex-start",
    backgroundColor: palette.background,
    flexDirection: "row",
    gap: space.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  sessionStatusBlocked: { ...typography.sectionLabel, color: palette.warm },
  sessionTime: { ...typography.footnote, color: palette.dim },
  sessionTrailing: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: space.xs,
    justifyContent: "flex-end",
  },
  sessionTitleRow: { alignItems: "flex-start", flexDirection: "row", gap: space.sm },
  sessionTitle: { ...typography.body, color: palette.ink, flex: 1, minWidth: 0 },
  workspaceActions: { alignItems: "center", flexDirection: "row", gap: space.sm },
  staleRoute: { alignSelf: "center", maxWidth: 640, padding: space.lg, width: "100%" },
  swipeContainer: { backgroundColor: palette.background },
  swipeDelete: {
    alignItems: "center",
    backgroundColor: palette.danger,
    justifyContent: "center",
    minWidth: 82,
    paddingHorizontal: space.sm,
  },
  swipeDeleteLabel: { ...typography.sectionLabel, color: palette.background },
  transcriptContainer: { flex: 1 },
  transcriptList: { flex: 1 },
  transcriptState: { alignItems: "center", minHeight: 140, padding: space.lg },
  transcriptLimit: {
    ...typography.footnote,
    color: palette.dim,
    paddingBottom: space.sm,
    textAlign: "right",
  },
});
