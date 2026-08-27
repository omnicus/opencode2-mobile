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
  type SessionMessageInfo,
  type SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useConnections } from "../connections/connections-context";
import type { RootStackParamList } from "../navigation/root-navigation";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import type { FollowedInboxRow } from "../state/followed-project-inbox";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import {
  recordTranscriptFollowCorrection,
  recordTranscriptLatestJump,
  recordTranscriptResidentSet,
} from "../state/transcript-performance";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { deleteSessionLocalState } from "../storage/prompt-admission-repository";
import {
  displayTitleMaxFontSizeMultiplier,
  palette,
  radius,
  space,
  typeRamp,
  usesLargeTextLayout,
} from "../theme";
import { ActionButton, getConnectionPresentation, isTabletShell, ShellFrame } from "./app-shell";
import { FormRequestList } from "./form-request-list";
import { SessionComposer } from "./session-composer";
import { loadOpenCodeSessionTreeIds } from "./session-deletion";
import { SessionExecutionPanel } from "./session-execution-panel";
import { SessionTranscriptRow } from "./session-transcript";
import {
  resolveTranscriptLiveFollow,
  type TranscriptLiveFollowEvent,
} from "./session-transcript-live-follow";
import { flattenTranscriptPages } from "./session-transcript-model";
import { useSessionDraft } from "./use-session-draft";
import { useSessionExecution } from "./use-session-execution";
import {
  getComposerDockKeyboardOffset,
  needsComposerDockMeasurement,
} from "./workspace-screen-model";

type WorkspaceProps = NativeStackScreenProps<RootStackParamList, "Workspace">;
type SessionProps = NativeStackScreenProps<RootStackParamList, "Session">;

const messagePageSize = 40;
const maxTranscriptPages = 5;
const iosKeyboardTransparentTopInset = 32;
const liveEdgeThreshold = 2;
const userScrollSettleMs = 160;
const mentionFileLimit = 20;
const unresolvedLocation = { directory: "__unresolved__" } satisfies LocationRef;

export function WorkspaceScreen({ navigation }: WorkspaceProps) {
  const db = useSQLiteContext();
  const runtime = useConnectionRuntime();
  const workspaceSelection = useWorkspaceSelection();
  const connections = useConnections();
  const queryClient = useQueryClient();
  const { fontScale, width } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
  const tablet = isTabletShell(width);
  const connectionId = runtime.connectionId;
  const client = runtime.restClient;
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedDirectory, setSelectedDirectory] = useState<string>();
  const [sessionSearch, setSessionSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const removeAbortRef = useRef<AbortController>(null);
  const refreshGenerationRef = useRef(0);
  const deferredSessionSearch = useDeferredValue(sessionSearch.trim());

  useEffect(() => {
    void connectionId;
    setSelectedProjectId(undefined);
    setSelectedDirectory(undefined);
    setSessionSearch("");
    refreshGenerationRef.current += 1;
    setRefreshing(false);
  }, [connectionId]);

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
  const mutationScope = `${connectionId ?? ""}\u0000${location?.directory ?? ""}\u0000${location?.workspaceID ?? ""}`;

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

  const inboxItems = workspaceInboxItems(workspaceSelection.inbox, Boolean(deferredSessionSearch));
  const ambiguousProjectIDs = ambiguousInboxProjectIDs(workspaceSelection.inbox);
  const sessionCount =
    workspaceSelection.inbox.needsYou.length +
    workspaceSelection.inbox.working.length +
    workspaceSelection.inbox.recent.length;
  const selectedConnection = connections.profiles.find(
    (profile) => profile.id === connections.selectedProfileId,
  );

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

  function confirmDelete(session: SessionInfo) {
    const host = selectedConnection?.name ?? "selected server";
    const childWarning = session.parentID
      ? "This is a child session."
      : "Deleting a parent also deletes all child sessions.";
    Alert.alert(
      "Delete session?",
      `Host: ${host}\nProject: ${session.projectID}\nLocation: ${session.location.directory}\n\n${childWarning}`,
      [
        { style: "cancel", text: "Cancel" },
        { onPress: () => removeMutation.mutate(session), style: "destructive", text: "Delete" },
      ],
    );
  }

  const connectionPresentation = getConnectionPresentation(
    runtime.status,
    runtime.reconnectAttempt,
  );
  const connectionName = selectedConnection?.name ?? "OpenCode";
  const header = (
    <View style={[styles.homeHeader, !tablet && styles.homeHeaderPhone]}>
      {tablet ? (
        <View style={[styles.homeTitleRow, largeText && styles.homeTitleRowLargeText]}>
          <View style={styles.homeTitleCopy}>
            <Text
              dynamicTypeRamp={typeRamp.control}
              style={styles.serverLabel}
              numberOfLines={largeText ? undefined : 1}
            >
              {connectionName}
            </Text>
            <Text
              accessibilityRole="header"
              dynamicTypeRamp={typeRamp.heading}
              maxFontSizeMultiplier={displayTitleMaxFontSizeMultiplier}
              style={styles.homeTitle}
            >
              Sessions
            </Text>
          </View>
          <HeaderAction
            accessibilityHint="Choose a project for a new session"
            emphasized
            label="New"
            onPress={() => navigation.navigate("NewSession")}
          />
        </View>
      ) : null}

      <View style={[styles.workspaceActions, largeText && styles.workspaceActionsLargeText]}>
        <Pressable
          accessibilityLabel={`${connectionName}, ${connectionPresentation.label}. Manage connections`}
          accessibilityRole="button"
          onPress={() => navigation.navigate("Connections")}
          style={({ pressed }) => [styles.connectionLine, pressed && styles.pressed]}
        >
          <View
            style={[
              styles.connectionDot,
              runtime.status === "connected" ? styles.connectionDotLive : styles.connectionDotMuted,
            ]}
          />
          <Text numberOfLines={largeText ? undefined : 1} style={styles.connectionName}>
            {connectionName}
          </Text>
          <Text style={styles.connectionLabel}>{connectionPresentation.label}</Text>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.connectionDisclosure}
          >
            &gt;
          </Text>
        </Pressable>
        {!tablet ? (
          <>
            {workspaceSelection.pendingCount > 0 ? (
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
            ) : null}
            <HeaderAction
              accessibilityHint="Choose a project for a new session"
              emphasized
              label="New"
              onPress={() => navigation.navigate("NewSession")}
            />
          </>
        ) : null}
      </View>
      {runtime.status !== "connected" ? (
        <Text accessibilityLiveRegion="polite" style={styles.connectionNotice}>
          {runtime.cacheMetadata
            ? "Showing cached shell data until the server reconnects."
            : "Waiting for current server data."}
        </Text>
      ) : null}
      <View style={styles.searchField}>
        <TextInput
          accessibilityLabel="Search sessions"
          autoCapitalize="none"
          autoCorrect={false}
          editable={workspaceSelection.followedProjectIds.length > 0}
          keyboardAppearance="dark"
          onChangeText={setSessionSearch}
          placeholder="Search sessions"
          placeholderTextColor={palette.dim}
          style={styles.searchInput}
          value={sessionSearch}
        />
        {sessionSearch ? (
          <Pressable
            accessibilityLabel="Clear session search"
            accessibilityRole="button"
            onPress={() => setSessionSearch("")}
            style={styles.clearSearch}
          >
            <Text style={styles.clearSearchLabel}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {deferredSessionSearch ? (
        <View style={styles.listSectionHeader}>
          <Text style={styles.listSectionTitle}>Search results</Text>
          <Text style={styles.countLabel}>{sessionCount}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <ShellFrame
      active="Workspace"
      hideConnectionBar
      navigate={(section) => navigation.navigate(section)}
    >
      <FlatList
        ListEmptyComponent={
          <SessionEmptyState
            error={workspaceSelection.sessionsError}
            hasLocation={workspaceSelection.followedProjectIds.length > 0}
            loading={workspaceSelection.sessionsLoading}
            search={deferredSessionSearch}
          />
        }
        ListFooterComponent={
          workspaceSelection.hasNextPage ? (
            <View style={styles.listFooter}>
              <ActionButton
                label="Load older"
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
          item.type === "section" ? (
            <View style={[styles.listSectionHeader, styles.inboxSectionHeader]}>
              <Text style={styles.listSectionTitle}>{item.label}</Text>
              <Text style={styles.countLabel}>{item.count}</Text>
            </View>
          ) : (
            <SessionRow
              largeText={largeText}
              onDelete={() => confirmDelete(item.row.session)}
              onOpenChild={(child) => {
                if (!connectionId) return;
                navigation.navigate("Session", {
                  connectionId,
                  location: child.location,
                  sessionID: child.id,
                });
              }}
              onPress={() => openSession(item.row)}
              row={item.row}
              section={item.section}
              showLocation={ambiguousProjectIDs.has(item.row.session.projectID)}
            />
          )
        }
        updateCellsBatchingPeriod={40}
        windowSize={7}
      />
    </ShellFrame>
  );
}

export function SessionScreen({ navigation, route }: SessionProps) {
  const runtime = useConnectionRuntime();
  const workspaceSelection = useWorkspaceSelection();
  const { fontScale } = useWindowDimensions();
  const screenHeight = Dimensions.get("screen").height;
  const largeText = usesLargeTextLayout(fontScale);
  const { connectionId: routeConnectionId, focusComposer, location, sessionID } = route.params;
  const connectionId = runtime.connectionId;
  const client = runtime.restClient;
  const [liveFollowEnabled, setLiveFollowEnabled] = useState(true);
  const [latestJumpPending, setLatestJumpPending] = useState(false);
  const [composerDockHeight, setComposerDockHeight] = useState(66);
  const [composerDockScreenBottom, setComposerDockScreenBottom] = useState(0);
  const [composerKeyboardOffset, setComposerKeyboardOffset] = useState(0);
  const [mentionSearch, setMentionSearch] = useState<string>();
  const deferredMentionSearch = useDeferredValue(mentionSearch);
  const composerDockRef = useRef<View>(null);
  const measuredComposerDockScreenHeightRef = useRef<number | undefined>(undefined);
  const transcriptListRef = useRef<FlatList<SessionMessageInfo>>(null);
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
    queryKey: openCodeQueryKeys.session(connectionId ?? "unselected", location, sessionID),
  });
  const session = sessionQuery.data;
  const sessionLocation = session?.location ?? location;
  const vcsQuery = useQuery({
    enabled: Boolean(client && connectionId === routeConnectionId),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getOpenCodeVcs(client, sessionLocation, { signal });
    },
    queryKey: openCodeQueryKeys.vcs(connectionId ?? "unselected", sessionLocation),
  });
  const messagesQuery = useInfiniteQuery({
    enabled: Boolean(client && connectionId === routeConnectionId),
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
    queryKey: openCodeQueryKeys.messages(connectionId ?? "unselected", location, sessionID, {
      limit: messagePageSize,
      order: "desc",
    }),
  });
  const mentionFilesQuery = useQuery({
    enabled: Boolean(
      client && connectionId === routeConnectionId && deferredMentionSearch !== undefined,
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
  const messages = flattenTranscriptPages(messagesQuery.data?.pages);
  const draft = useSessionDraft(routeConnectionId, sessionID);
  const execution = useSessionExecution({
    client,
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
  const sessionPermissions = workspaceSelection.permissions.filter(
    (request) => request.sessionID === sessionID,
  );
  const sessionForms = workspaceSelection.forms.filter((form) => form.sessionID === sessionID);
  const sessionMutationScope = `${routeConnectionId}\u0000${sessionID}`;
  const transcriptPageCount = messagesQuery.data?.pages.length ?? 0;
  const canLoadOlder = Boolean(
    messagesQuery.hasNextPage && transcriptPageCount < maxTranscriptPages,
  );
  const openSubagent = useCallback(
    (childSessionID: string) => {
      navigation.push("Session", {
        connectionId: routeConnectionId,
        location,
        sessionID: childSessionID,
      });
    },
    [location, navigation, routeConnectionId],
  );
  const openDiff = useCallback(() => {
    navigation.push("Diff", {
      connectionId: routeConnectionId,
      location,
      mode: "working",
    });
  }, [location, navigation, routeConnectionId]);

  useEffect(() => {
    workspaceSelection.setLocation(location);
  }, [location, workspaceSelection.setLocation]);

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
    if (!liveFollowEnabledRef.current || messages.length === 0 || followFrameRef.current !== null) {
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
          <ActionButton label="BACK TO WORKSPACE" onPress={() => navigation.popTo("Workspace")} />
        </View>
      </ShellFrame>
    );
  }

  const composerDockContent = (
    <View onLayout={measureComposerContent}>
      <SessionExecutionPanel
        active={execution.active}
        admissions={execution.admissions}
        busyAction={execution.busyAction}
        formRequests={
          sessionForms.length > 0 ? (
            <FormRequestList
              client={client}
              connectionId={connectionId}
              formLocations={workspaceSelection.formLocations}
              forms={sessionForms}
              location={location}
            />
          ) : undefined
        }
        inbox={execution.inbox}
        onAllowRetry={execution.allowRetry}
        onCancelInbox={execution.cancelInbox}
        onCheckAdmission={execution.reconcileAdmission}
        onInterrupt={execution.interrupt}
        onQueueInbox={execution.queueInbox}
        onReplyPermission={workspaceSelection.replyPermission}
        onSteerInbox={execution.steerInbox}
        permissionReplyError={workspaceSelection.permissionReplyError}
        permissions={sessionPermissions}
        projectedMessageIds={execution.projectedMessageIds}
        replyingPermissionId={workspaceSelection.replyingPermissionId}
      />
      <SessionComposer
        active={execution.active}
        agent={execution.selectedAgent}
        agents={execution.agents}
        commands={execution.commands}
        completionLoading={execution.completionLoading}
        completionUnavailable={execution.completionUnavailable}
        delivery={execution.delivery}
        disabled={execution.submitDisabled || !draft.loaded}
        draft={draft.draft}
        editable={draft.loaded}
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
        onDeliveryChange={execution.setDelivery}
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
      navigate={(section) =>
        section === "Workspace" ? navigation.popTo("Workspace") : navigation.navigate(section)
      }
    >
      <View accessibilityLabel="Keyboard-aware session" style={styles.transcriptContainer}>
        <FlatList
          accessibilityLabel="Session transcript"
          contentContainerStyle={[styles.detailContent, largeText && styles.detailContentLargeText]}
          data={messages}
          extraData={fontScale}
          initialNumToRender={12}
          inverted
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          key={`session-transcript:${fontScale}`}
          keyExtractor={(message) => message.id}
          ListEmptyComponent={
            messagesQuery.isPending ? (
              <View style={styles.transcriptState}>
                <ActivityIndicator accessibilityLabel="Loading transcript" color={palette.signal} />
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
              {canLoadOlder ? (
                <SmallButton
                  label={messagesQuery.isFetchingNextPage ? "Loading" : "Load older"}
                  onPress={() => {
                    if (!messagesQuery.isFetchingNextPage) void messagesQuery.fetchNextPage();
                  }}
                />
              ) : null}
              {!canLoadOlder && messagesQuery.hasNextPage ? (
                <Text style={styles.transcriptLimit}>
                  Older messages are not loaded on this device.
                </Text>
              ) : null}
            </View>
          }
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          maxToRenderPerBatch={12}
          onContentSizeChange={scheduleLiveEdgeScroll}
          onMomentumScrollBegin={handleMomentumScrollBegin}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          onScroll={handleTranscriptScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          ref={transcriptListRef}
          renderItem={({ item }) => (
            <SessionTranscriptRow
              largeText={largeText}
              message={item}
              onOpenDiff={openDiff}
              onOpenSubagent={openSubagent}
            />
          )}
          scrollEventThrottle={16}
          style={styles.transcriptList}
          updateCellsBatchingPeriod={40}
          windowSize={7}
        />
        {(!liveFollowEnabled || latestJumpPending) && messages.length > 0 ? (
          <Pressable
            accessibilityHint="Returns to new transcript output and resumes live follow"
            accessibilityLabel="Scroll to latest"
            accessibilityRole="button"
            onPress={scrollToLatest}
            style={({ pressed }) => [
              styles.latestButton,
              largeText && styles.latestButtonLargeText,
              pressed && styles.pressed,
            ]}
          >
            <Text dynamicTypeRamp={typeRamp.control} style={styles.latestButtonLabel}>
              Latest
            </Text>
          </Pressable>
        ) : null}
        <View pointerEvents="none" style={{ height: composerDockHeight }} />
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
    </ShellFrame>
  );
}

function SessionRow({
  largeText,
  onDelete,
  onOpenChild,
  onPress,
  row,
  section,
  showLocation,
}: {
  largeText: boolean;
  onDelete: () => void;
  onOpenChild: (child: SessionInfo) => void;
  onPress: () => void;
  row: FollowedInboxRow;
  section: WorkspaceInboxSection;
  showLocation: boolean;
}) {
  const { session } = row;
  const active = row.active;
  const blocked = row.attentionCount > 0;
  const showOutcome =
    Boolean(session.outcome) &&
    (section !== "recent" || session.outcome?.toLocaleLowerCase() !== "succeeded");
  const showMetadata =
    active ||
    blocked ||
    row.activeChildCount > 0 ||
    row.attentionCount > 1 ||
    Boolean(session.time.archived) ||
    showOutcome;
  return (
    <ReanimatedSwipeable
      containerStyle={styles.swipeContainer}
      enableTrackpadTwoFingerGesture
      onSwipeableWillOpen={() => {
        void Haptics.selectionAsync().catch(() => undefined);
      }}
      overshootRight={false}
      renderRightActions={(_progress, _translation, swipeable) => (
        <View style={styles.swipeActions}>
          <Pressable
            accessibilityLabel={`Delete ${session.title || "Untitled session"}`}
            accessibilityRole="button"
            onPress={() => {
              swipeable.close();
              onDelete();
            }}
            style={styles.swipeDelete}
          >
            <Text style={styles.swipeDeleteLabel}>Delete</Text>
          </Pressable>
        </View>
      )}
    >
      <View style={styles.sessionGroup}>
        <Pressable
          accessibilityActions={[{ name: "activate" }, { label: "Delete session", name: "delete" }]}
          accessibilityHint="Opens the session. More actions include delete"
          accessibilityLabel={sessionAccessibilityLabel(row)}
          accessibilityRole="button"
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "activate") onPress();
            if (nativeEvent.actionName === "delete") onDelete();
          }}
          onPress={onPress}
          style={({ pressed }) => [
            styles.sessionRow,
            largeText && styles.sessionRowLargeText,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.sessionMain}>
            <View style={styles.sessionTopRow}>
              <Text numberOfLines={1} style={styles.sessionProject}>
                {row.projectLabel}
              </Text>
              <Text style={styles.sessionTime}>{formatSessionTime(session.time.updated)}</Text>
            </View>
            <Text
              dynamicTypeRamp={typeRamp.subheading}
              numberOfLines={largeText ? 4 : 2}
              style={styles.sessionTitle}
            >
              {session.title || "Untitled session"}
            </Text>
            {showMetadata ? (
              <View style={styles.sessionMetadata}>
                {active ? (
                  <Text style={[styles.sessionStatus, styles.sessionStatusActive]}>Working</Text>
                ) : null}
                {blocked ? (
                  <Text style={[styles.sessionStatus, styles.sessionStatusBlocked]}>
                    Needs input
                  </Text>
                ) : null}
                {row.activeChildCount > 0 ? (
                  <Text style={styles.sessionMetaLabel}>
                    {row.activeChildCount} background{" "}
                    {row.activeChildCount === 1 ? "task" : "tasks"}
                  </Text>
                ) : null}
                {row.attentionCount > 1 ? (
                  <Text style={styles.sessionMetaLabel}>{row.attentionCount} requests</Text>
                ) : null}
                {session.time.archived ? (
                  <Text style={styles.sessionMetaLabel}>Archived</Text>
                ) : null}
                {showOutcome && session.outcome ? (
                  <Text style={styles.sessionMetaLabel}>{sentenceCase(session.outcome)}</Text>
                ) : null}
              </View>
            ) : null}
            {showLocation ? (
              <Text numberOfLines={largeText ? 2 : 1} style={styles.sessionLocation}>
                {session.location.directory}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {row.children.map((child) => (
          <Pressable
            accessibilityLabel={`${child.attentionCount > 0 ? "Needs input: " : child.active ? "Working: " : "Child: "}${child.session.title || "Untitled child session"}`}
            accessibilityRole="button"
            key={child.session.id}
            onPress={() => onOpenChild(child.session)}
            style={({ pressed }) => [styles.childRow, pressed && styles.pressed]}
          >
            <View style={styles.childBranch} />
            <Text numberOfLines={2} style={styles.childTitle}>
              {child.session.title || "Untitled child session"}
            </Text>
            <Text style={child.attentionCount > 0 ? styles.childAttention : styles.childState}>
              {child.attentionCount > 0 ? "Needs input" : child.active ? "Working" : "Child"}
            </Text>
          </Pressable>
        ))}
      </View>
    </ReanimatedSwipeable>
  );
}

function SessionEmptyState({
  error,
  hasLocation,
  loading,
  search,
}: {
  error: boolean;
  hasLocation: boolean;
  loading: boolean;
  search: string;
}) {
  if (error) {
    return (
      <View style={styles.emptyState}>
        <InlineError message="Sessions could not be loaded. Pull to refresh and try again." />
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
  return (
    <View style={styles.emptyState}>
      <Text style={styles.sectionTitle}>
        {!hasLocation
          ? "Follow a project to build this inbox."
          : search
            ? "No sessions match this search."
            : "No root sessions in followed projects."}
      </Text>
    </View>
  );
}

function HeaderAction({
  accessibilityHint,
  accessibilityLabel,
  attention,
  disabled,
  emphasized,
  label,
  onPress,
}: {
  accessibilityHint: string;
  accessibilityLabel?: string;
  attention?: boolean;
  disabled?: boolean;
  emphasized?: boolean;
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
        emphasized && styles.headerActionEmphasized,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text
        dynamicTypeRamp={typeRamp.control}
        style={[
          styles.headerActionLabel,
          attention && styles.headerActionLabelAttention,
          emphasized && styles.headerActionLabelEmphasized,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
    >
      <Text dynamicTypeRamp={typeRamp.control} style={styles.smallButtonLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <Text accessibilityRole="alert" style={styles.error}>
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

function sessionAccessibilityLabel(row: FollowedInboxRow) {
  const { session } = row;
  const states = [
    row.projectLabel,
    row.active ? "Working" : undefined,
    row.attentionCount > 0 ? "Needs input" : undefined,
    row.activeChildCount > 0 ? `${row.activeChildCount} background tasks` : undefined,
    session.time.archived ? "Archived" : undefined,
    session.outcome ? sentenceCase(session.outcome) : undefined,
  ].filter(Boolean);
  return `Open session ${session.title || "Untitled session"}${states.length > 0 ? `. ${states.join(". ")}` : ""}`;
}

type WorkspaceInboxSection = "needs-you" | "recent" | "working";

type WorkspaceInboxItem =
  | { count: number; key: string; label: string; type: "section" }
  | {
      key: string;
      row: FollowedInboxRow;
      section: WorkspaceInboxSection;
      type: "session";
    };

function workspaceInboxItems(
  inbox: ReturnType<typeof useWorkspaceSelection>["inbox"],
  flattenSections: boolean,
) {
  const items: WorkspaceInboxItem[] = [];
  for (const [key, label, rows] of [
    ["needs-you", "Needs you", inbox.needsYou],
    ["working", "Working", inbox.working],
    ["recent", "Recent", inbox.recent],
  ] as const) {
    if (rows.length === 0) continue;
    if (!flattenSections) {
      items.push({ count: rows.length, key: `section:${key}`, label, type: "section" });
    }
    items.push(
      ...rows.map((row) => ({ key: row.session.id, row, section: key, type: "session" as const })),
    );
  }
  return items;
}

function ambiguousInboxProjectIDs(inbox: ReturnType<typeof useWorkspaceSelection>["inbox"]) {
  const locationsByProject = new Map<string, Set<string>>();
  for (const row of [...inbox.needsYou, ...inbox.working, ...inbox.recent]) {
    const locations = locationsByProject.get(row.session.projectID) ?? new Set<string>();
    locations.add(
      `${row.session.location.directory}\u0000${row.session.location.workspaceID ?? ""}`,
    );
    locationsByProject.set(row.session.projectID, locations);
  }
  return new Set(
    [...locationsByProject.entries()]
      .filter(([, locations]) => locations.size > 1)
      .map(([projectID]) => projectID),
  );
}

function sentenceCase(value: string) {
  return value ? `${value[0]?.toLocaleUpperCase()}${value.slice(1).toLocaleLowerCase()}` : value;
}

const styles = StyleSheet.create({
  composerDock: { bottom: 0, left: 0, position: "absolute", right: 0, zIndex: 20 },
  childAttention: { color: palette.warm, fontSize: 11, fontWeight: "800" },
  childBranch: { backgroundColor: palette.border, height: 1, width: 18 },
  childRow: {
    alignItems: "center",
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.md,
  },
  childState: { color: palette.signal, fontSize: 11, fontWeight: "800" },
  childTitle: { color: palette.ink, flex: 1, fontSize: 13, fontWeight: "700" },
  backgroundCount: { color: palette.warm, fontSize: 12, fontWeight: "700", marginTop: 3 },
  badge: {
    backgroundColor: palette.signalDark,
    borderColor: palette.signal,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeLabel: { color: palette.signal, fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  badgeLabelMuted: { color: palette.dim },
  badgeMuted: { backgroundColor: palette.card, borderColor: palette.border },
  badges: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  clearSearch: { justifyContent: "center", minHeight: 44, paddingLeft: space.sm },
  clearSearchLabel: { color: palette.signal, fontSize: 13, fontWeight: "700" },
  connectionDot: { borderRadius: 4, height: 7, marginRight: 8, width: 7 },
  connectionDotLive: { backgroundColor: palette.signal },
  connectionDotMuted: { backgroundColor: palette.warm },
  connectionLabel: { color: palette.dim, fontSize: 12, fontWeight: "600", marginLeft: 6 },
  connectionDisclosure: { color: palette.dim, fontSize: 14, marginLeft: 8 },
  connectionLine: {
    alignItems: "center",
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: 12,
  },
  connectionName: { color: palette.ink, flexShrink: 1, fontSize: 12, fontWeight: "700" },
  connectionNotice: { color: palette.warm, fontSize: 12, lineHeight: 18, marginBottom: 2 },
  contextLabel: { color: palette.dim, fontSize: 12, fontWeight: "600" },
  contextRow: {
    alignItems: "center",
    borderBottomColor: palette.border,
    borderTopColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 62,
    paddingVertical: space.sm,
  },
  contextRowLargeText: { alignItems: "flex-start", flexDirection: "column", gap: space.xs },
  contextRowCopy: { flex: 1, minWidth: 0 },
  contextValue: { color: palette.ink, fontSize: 15, marginTop: 4 },
  countLabel: { color: palette.dim, fontSize: 13, fontWeight: "600" },
  deleteButton: {
    alignItems: "center",
    borderColor: palette.danger,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: space.lg,
    minHeight: 52,
    paddingHorizontal: space.md,
  },
  deleteLabel: { color: palette.danger, fontSize: 12, fontWeight: "900", letterSpacing: 0.8 },
  disabled: { opacity: 0.45 },
  detailContent: {
    alignSelf: "center",
    maxWidth: 720,
    paddingBottom: 80,
    width: "100%",
  },
  detailContentLargeText: { paddingBottom: 140 },
  detailHeader: { paddingHorizontal: space.lg, paddingTop: space.lg },
  emptyState: { alignItems: "center", minHeight: 160, padding: space.xl },
  error: { color: palette.danger, fontSize: 14, lineHeight: 20 },
  eyebrow: { color: palette.signal, fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  headerAction: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 15,
  },
  headerActionAttention: { borderColor: palette.warm },
  headerActionEmphasized: { backgroundColor: palette.signal, borderColor: palette.signal },
  headerActionLabel: { color: palette.ink, fontSize: 14, fontWeight: "700" },
  headerActionLabelAttention: { color: palette.warm },
  headerActionLabelEmphasized: { color: palette.background },
  headingCopy: { flex: 1, minWidth: 180 },
  homeHeader: { paddingHorizontal: space.lg, paddingTop: space.lg },
  homeHeaderPhone: { paddingTop: space.sm },
  homeTitle: {
    color: palette.ink,
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1.2,
    lineHeight: 39,
    marginTop: 2,
  },
  homeTitleCopy: { flex: 1, minWidth: 120 },
  homeTitleRow: { alignItems: "center", flexDirection: "row", gap: space.sm },
  homeTitleRowLargeText: { alignItems: "flex-start", flexDirection: "column" },
  input: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: palette.ink,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  latestButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: palette.signal,
    borderRadius: 999,
    justifyContent: "center",
    marginBottom: space.sm,
    marginHorizontal: space.lg,
    minHeight: 44,
    minWidth: 76,
    paddingHorizontal: space.md,
    position: "relative",
  },
  latestButtonLargeText: {
    maxWidth: "75%",
    paddingVertical: space.sm,
  },
  latestButtonLabel: { color: palette.background, fontSize: 13, fontWeight: "800" },
  listContent: {
    alignSelf: "center",
    maxWidth: 760,
    paddingBottom: 80,
    width: "100%",
  },
  listFooter: { alignItems: "center", padding: space.lg },
  inboxSectionHeader: { paddingHorizontal: space.lg },
  listSectionHeader: {
    alignItems: "center",
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    marginTop: space.lg,
    paddingBottom: space.sm,
  },
  listSectionTitle: { color: palette.ink, flex: 1, fontSize: 14, fontWeight: "700" },
  muted: { color: palette.dim, fontSize: 14, lineHeight: 21, marginTop: space.xs },
  newSessionCopy: { color: palette.dim, fontSize: 15, lineHeight: 22, marginTop: space.xs },
  newSessionIntro: { marginBottom: space.sm },
  newSessionPrompt: {
    color: palette.ink,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.7,
    lineHeight: 34,
  },
  optionList: { gap: space.sm, marginTop: space.sm },
  optionPicker: {
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: space.md,
  },
  pathText: { color: palette.dim, fontSize: 12, lineHeight: 18, marginTop: space.xs },
  pickerRow: {
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 52,
    padding: 12,
  },
  pickerRowSelected: { backgroundColor: palette.signalDark, borderColor: palette.signal },
  pickerTitle: { color: palette.ink, fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.7 },
  scopeAction: { color: palette.signal, fontSize: 13, fontWeight: "700", marginLeft: space.sm },
  scopeActionLargeText: { marginLeft: 0, marginTop: space.xs },
  searchField: {
    alignItems: "center",
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: space.sm,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  searchInput: { color: palette.ink, flex: 1, fontSize: 15, minHeight: 46, paddingVertical: 10 },
  sectionCard: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: space.md,
    padding: space.md,
  },
  sectionHeading: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  sectionLabel: { color: palette.warm, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  sectionTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 23,
    marginTop: 3,
  },
  selectionMark: { color: palette.signal, fontSize: 12, fontWeight: "600", marginLeft: space.sm },
  serverLabel: { color: palette.dim, fontSize: 12, fontWeight: "600" },
  sessionMain: { flex: 1, minWidth: 0 },
  sessionGroup: { backgroundColor: palette.card },
  sessionLocation: {
    color: palette.dim,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 11,
    marginTop: 4,
  },
  sessionMetadata: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: 4 },
  sessionMetaLabel: { color: palette.dim, fontSize: 12 },
  sessionProject: { color: palette.ink, fontSize: 12, fontWeight: "700" },
  sessionRow: {
    alignItems: "center",
    backgroundColor: palette.background,
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 68,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  sessionRowLargeText: { alignItems: "flex-start" },
  sessionStatus: { fontSize: 12, fontWeight: "700" },
  sessionStatusActive: { color: palette.signal },
  sessionStatusBlocked: { color: palette.warm },
  sessionTime: { color: palette.dim, fontSize: 12, marginLeft: space.sm },
  sessionTitle: {
    color: palette.ink,
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
    marginTop: 4,
    minWidth: 0,
  },
  sessionTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  workspaceActions: { alignItems: "center", flexDirection: "row", gap: space.sm },
  workspaceActionsLargeText: { alignItems: "stretch", flexDirection: "column" },
  sheetRow: {
    alignItems: "center",
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 62,
    paddingHorizontal: 2,
    paddingVertical: space.sm,
  },
  sheetRowCopy: { flex: 1, minWidth: 0 },
  sheetRowSelected: { backgroundColor: palette.signalDark },
  sheetRowSubtitle: { color: palette.dim, fontSize: 12, lineHeight: 17, marginTop: 3 },
  sheetRowTitle: { color: palette.ink, fontSize: 15, fontWeight: "700" },
  sheetSection: { marginTop: space.xs },
  sheetSectionLabel: {
    color: palette.dim,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: space.xs,
  },
  smallButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: space.sm,
  },
  smallButtonLabel: { color: palette.signal, fontSize: 13, fontWeight: "700" },
  staleRoute: { alignSelf: "center", maxWidth: 640, padding: space.lg, width: "100%" },
  swipeActions: { flexDirection: "row" },
  swipeContainer: { backgroundColor: palette.background },
  swipeDelete: {
    alignItems: "center",
    backgroundColor: palette.danger,
    justifyContent: "center",
    minWidth: 82,
    paddingHorizontal: space.sm,
  },
  swipeDeleteLabel: { color: palette.background, fontSize: 12, fontWeight: "700" },
  title: { color: palette.ink, fontSize: 34, fontWeight: "700", letterSpacing: -1, lineHeight: 40 },
  titleInput: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: palette.ink,
    fontSize: 18,
    lineHeight: 25,
    minHeight: 118,
    padding: space.md,
  },
  transcriptCount: { color: palette.dim, fontSize: 12, marginTop: 3 },
  transcriptContainer: { flex: 1 },
  transcriptList: { flex: 1 },
  transcriptActions: { alignItems: "center", flexDirection: "row" },
  transcriptActionsLargeText: {
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginTop: space.xs,
  },
  transcriptHeading: {
    alignItems: "center",
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: space.lg,
    minHeight: 54,
    paddingBottom: space.sm,
  },
  transcriptHeadingLargeText: {
    alignItems: "stretch",
    flexDirection: "column",
    justifyContent: "flex-start",
  },
  transcriptState: { alignItems: "center", minHeight: 140, padding: space.lg },
  transcriptLimit: {
    color: palette.dim,
    fontSize: 11,
    paddingBottom: space.sm,
    textAlign: "right",
  },
});
