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
  type OpenCodeClient,
  type SessionInfo,
  type SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useSQLiteContext } from "expo-sqlite";
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import Animated, { LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../components/button";
import { announceOnIOS, useAnnouncement } from "../components/use-announcement";
import { useDelayedVisibility } from "../components/use-delayed-visibility";
import { useReducedMotion } from "../components/use-reduced-motion";
import { useConnections } from "../connections/connections-context";
import type { RootStackParamList } from "../navigation/root-navigation";
import { WorkspaceHeaderActions } from "../navigation/workspace-header-actions";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { type FollowedInboxRow, locationKey } from "../state/followed-project-inbox";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { recordTranscriptResidentSet } from "../state/transcript-performance";
import { useTranscriptPreferences } from "../state/transcript-preferences";
import { useModelFavorites } from "../state/use-model-favorites";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import type { CollapsibleInboxSection } from "../storage/session-inbox-repository";
import {
  disabledOpacity,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  rippleFeedback,
  space,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";
import {
  ActionButton,
  getConnectionPresentation,
  isTabletShell,
  PendingInteractions,
  ShellFrame,
} from "./app-shell";
import { SessionChanges } from "./diff-screen";
import { FormRequestList } from "./form-request-list";
import { PullRequestList } from "./pull-request-list";
import { SessionActionSheet } from "./session-action-sheet";
import { SessionBackgroundTasks } from "./session-background-tasks";
import { SessionComposer } from "./session-composer";
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
import { flattenTranscriptPages, subagentStates } from "./session-transcript-model";
import { useInboxBranches } from "./use-inbox-branches";
import { useMarkSessionViewed } from "./use-mark-session-viewed";
import { useSessionDraft } from "./use-session-draft";
import { useSessionExecution } from "./use-session-execution";
import { WorkspaceBottomMenu, type WorkspaceTab } from "./workspace-bottom-menu";
import { WorkspaceListHeader } from "./workspace-list-header";
import {
  type TranscriptLiveFollow,
  useTranscriptLiveFollow,
  useTranscriptLiveFollowReset,
} from "./workspace-screen-live-follow";
import {
  attentionNoticeText,
  attentionNoticeVisible,
  connectionNoticeText,
  getComposerDockKeyboardOffset,
  mentionFileState,
  needsComposerDockMeasurement,
  pendingShortcutLabels,
  searchResultItems,
  selectFollowedProject,
  sessionBranchState,
  sessionWaitingFor,
  shouldAutoFillTranscript,
  type TranscriptSize,
  transcriptLoadErrorMessage,
  type WorkspaceInboxItem,
  withTranscriptContentSize,
  withTranscriptViewportSize,
  workspaceInboxItems,
  workspaceSectionLabels,
} from "./workspace-screen-model";
import { useRemoveSessionMutation } from "./workspace-screen-remove-session";
import { SessionRow } from "./workspace-screen-session-row";

type WorkspaceProps = NativeStackScreenProps<RootStackParamList, "Workspace">;
type SessionProps = NativeStackScreenProps<RootStackParamList, "Session">;
type WorkspaceNavigation = WorkspaceProps["navigation"];
type SessionNavigation = SessionProps["navigation"];
type FocusNavigation = Pick<WorkspaceNavigation, "addListener" | "isFocused">;
type WorkspaceSelection = ReturnType<typeof useWorkspaceSelection>;
type ShellSection = Parameters<Parameters<typeof ShellFrame>[0]["navigate"]>[0];
type SessionExecution = ReturnType<typeof useSessionExecution>;
type SessionDraft = ReturnType<typeof useSessionDraft>;
type SessionMessagesQuery = ReturnType<typeof useSessionMessagesQuery>;
type ComposerDockState = ReturnType<typeof useComposerDock>;
type SessionMessages = ReturnType<typeof flattenTranscriptPages>;
type TranscriptFooters = ReturnType<typeof buildTranscriptPresentation>["footers"];
type Refetchable = { refetch: () => Promise<unknown> };

const messagePageSize = 40;
const maxTranscriptPages = 5;
const iosKeyboardTransparentTopInset = 32;
// While following, rows ease to their new layout when the newest row grows: older text slides
// up and new lines rise in from the bottom edge. Reanimated animates each row's frame in the
// commit that changes it, so no frame shows the jump. A critically damped spring at this rate
// moves one 22-point line at up to about 140 pt/s and settles in about 0.33 s, close to the
// OpenCode iOS app.
const liveEdgeRowTransition = LinearTransition.springify().mass(1).stiffness(289).damping(34);
const mentionFileLimit = 20;
const unresolvedLocation = { directory: "__unresolved__" } satisfies LocationRef;
const rowRipple = rippleFeedback.row;
const borderlessRipple = rippleFeedback.borderless;
// Keeps the last rows of every Sessions tab clear of the floating bottom menu.
const bottomMenuInset = 96;

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
  const {
    actionSession,
    deferredSessionSearch,
    refreshGenerationRef,
    refreshing,
    searchOpen,
    selectedDirectory,
    selectedProjectId,
    sessionSearch,
    setActionSession,
    setRefreshing,
    setSearchOpen,
    setSelectedDirectory,
    setSelectedProjectId,
    setSessionSearch,
    setTab,
    showAttentionNotice,
    showConnectionNotice,
    tab,
  } = useWorkspaceListState(connectionId, workspaceSelection.attentionCoverage, runtime.status);
  const screenFocused = useScreenFocused(navigation);
  useWorkspaceBackHandlers({
    screenFocused,
    searchOpen,
    setSearchOpen,
    setSessionSearch,
    setTab,
    tab,
  });
  const { defaultDirectory, defaultProjectId, projects } = useWorkspaceProjects(
    client,
    connectionId,
  );
  useFollowedProjectSelection({
    defaultDirectory,
    defaultProjectId,
    projects,
    selectedProjectId,
    setSelectedDirectory,
    setSelectedProjectId,
    workspaceSelection,
  });
  const removeAbortRef = useRef<AbortController>(null);
  const { location, locationQuery, mutationScope, requestedLocation } = useWorkspaceLocation(
    client,
    connectionId,
    selectedDirectory,
  );
  useWorkspaceSelectionSync({
    deferredSessionSearch,
    location,
    mutationScope,
    removeAbortRef,
    setLocation: workspaceSelection.setLocation,
    setSearch: workspaceSelection.setSearch,
  });

  const inbox = workspaceSelection.inbox;
  const inboxItems: WorkspaceInboxItem[] = deferredSessionSearch
    ? searchResultItems(inbox)
    : workspaceInboxItems(inbox, {
        archived: workspaceSelection.archivedExpanded,
        working: workspaceSelection.workingExpanded,
      });
  // With only running sessions, the idle state still says nothing needs you, above Working.
  const onlyWorking =
    !deferredSessionSearch &&
    inbox.working.length > 0 &&
    inbox.needsYou.length + inbox.recent.length + inbox.archived.length === 0;
  const sessionCount =
    inbox.needsYou.length + inbox.working.length + inbox.recent.length + inbox.archived.length;
  const branches = useInboxBranches(
    [...inbox.needsYou, ...inbox.working, ...inbox.recent, ...inbox.archived],
    workspaceSelection.projects,
  );
  const selectedConnectionName = connections.profiles.find(
    (profile) => profile.id === connections.selectedProfileId,
  )?.name;
  const connectionPresentation = getConnectionPresentation(
    runtime.status,
    runtime.reconnectAttempt,
  );

  function closeSearch() {
    setSessionSearch("");
    setSearchOpen(false);
    Keyboard.dismiss();
  }

  function renderRow(row: FollowedInboxRow) {
    return (
      <SessionRow
        branch={branches.get(locationKey(row.session.location))}
        key={row.session.id}
        largeText={largeText}
        onActions={() => setActionSession(row.session)}
        onArchive={() => setSessionArchived(workspaceSelection, row.session, !row.archived)}
        onDelete={() =>
          confirmSessionDelete(row.session, row.projectLabel, selectedConnectionName, () =>
            removeMutation.mutate(row.session),
          )
        }
        onPress={() => openSession(row)}
        row={row}
      />
    );
  }

  const removeMutation = useRemoveSessionMutation({
    client,
    connectionId,
    db,
    queryClient,
    removeAbortRef,
  });

  async function refresh() {
    if (refreshing) return;
    await trackRefresh(refreshGenerationRef, setRefreshing, () =>
      refetchWorkspace(workspaceSelection, locationQuery, requestedLocation),
    );
  }

  function openSession(row: FollowedInboxRow) {
    if (!connectionId) return;
    navigation.navigate("Session", {
      connectionId,
      location: row.targetLocation,
      sessionID: row.targetSessionID,
    });
  }

  const attentionNotice = attentionNoticeText(
    showAttentionNotice,
    workspaceSelection.attentionCoverage.freshness,
  );
  const connectionNotice = connectionNoticeText(
    showConnectionNotice,
    Boolean(runtime.cacheMetadata),
  );
  useAnnouncement(attentionNotice);
  useAnnouncement(connectionNotice);
  useAnnouncement(workspaceSelection.sessionsError && "Sessions could not be loaded.");

  const header = (
    <WorkspaceSessionsHeader
      attentionNotice={attentionNotice}
      connectionNotice={connectionNotice}
      deferredSearch={deferredSessionSearch}
      onOpenApprovals={() => {
        closeSearch();
        setTab("approvals");
      }}
      onRetry={() => void refresh()}
      pendingCount={workspaceSelection.pendingCount}
      refreshing={refreshing}
      retryable={workspaceSelection.attentionCoverage.freshness !== "stale"}
      search={sessionSearch}
      sessionCount={sessionCount}
      tablet={tablet}
    />
  );
  const emptyState = (
    <SessionEmptyState
      error={workspaceSelection.sessionsError}
      hasLocation={workspaceSelection.followedProjectIds.length > 0}
      hasWorking={onlyWorking}
      loading={workspaceSelection.sessionsLoading}
      search={deferredSessionSearch}
      onChooseProjects={() => navigation.navigate("FollowedProjects")}
      onRetry={() => void refresh()}
      refreshing={refreshing}
    />
  );

  return (
    <ShellFrame
      active="Workspace"
      hideConnectionBar
      navigate={(section) => navigation.navigate(section)}
    >
      <WorkspaceListHeader
        connection={connectionPresentation}
        connectionName={selectedConnectionName}
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
        showSearch={tab === "chat"}
        topInset={tablet ? 0 : insets.top}
        trailing={
          <WorkspaceHeaderActions
            navigate={(destination) => navigation.navigate(destination)}
            onNewSession={tablet ? () => navigation.navigate("NewSession") : undefined}
          />
        }
      />
      <WorkspaceSecondaryTab active={screenFocused} navigation={navigation} tab={tab} />
      {/* Chat stays mounted on the other tabs so its scroll position and groups survive. */}
      <View style={[styles.tabPanel, tab !== "chat" && styles.hiddenPanel]}>
        <FlatList
          ListEmptyComponent={emptyState}
          ListFooterComponent={renderSearchResultsFooter({
            busy: workspaceSelection.sessionsFetchingNextPage,
            hasNextPage: workspaceSelection.hasNextPage,
            onLoadMore: () => void workspaceSelection.fetchNextPage(),
            search: deferredSessionSearch,
          })}
          ListHeaderComponent={
            <>
              {header}
              {onlyWorking ? emptyState : null}
            </>
          }
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
            item.type === "header" ? (
              <InboxSectionHeader
                count={item.count}
                expanded={item.expanded}
                onToggle={() => toggleInboxSection(workspaceSelection, item, reducedMotion)}
                section={item.section}
              />
            ) : (
              renderRow(item.row)
            )
          }
          updateCellsBatchingPeriod={40}
          windowSize={7}
        />
      </View>
      {tablet ? null : (
        <WorkspaceBottomMenu
          active={tab}
          // The search field unmounts on close without a reliable blur, so key off searchOpen.
          hidden={searchOpen}
          onNewSession={() => navigation.navigate("NewSession")}
          onSelect={(next) => {
            if (next === tab) return;
            Keyboard.dismiss();
            void Haptics.selectionAsync().catch(() => undefined);
            setTab(next);
          }}
        />
      )}
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

function useWorkspaceListState(
  connectionId: string | undefined,
  attentionCoverage: WorkspaceSelection["attentionCoverage"],
  runtimeStatus: ReturnType<typeof useConnectionRuntime>["status"],
) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedDirectory, setSelectedDirectory] = useState<string>();
  const [sessionSearch, setSessionSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionSession, setActionSession] = useState<SessionInfo>();
  const [tab, setTab] = useState<WorkspaceTab>("chat");
  const presentationScope = connectionId ?? "unselected";
  const showAttentionNotice = useDelayedVisibility(
    attentionNoticeVisible(attentionCoverage),
    presentationScope,
  );
  const showConnectionNotice = useDelayedVisibility(
    runtimeStatus !== "connected",
    presentationScope,
  );
  const [refreshing, setRefreshing] = useState(false);
  const refreshGenerationRef = useRef(0);
  const deferredSessionSearch = useDeferredValue(sessionSearch.trim());

  useEffect(() => {
    void connectionId;
    setSelectedProjectId(undefined);
    setSelectedDirectory(undefined);
    setSessionSearch("");
    setSearchOpen(false);
    setActionSession(undefined);
    setTab("chat");
    refreshGenerationRef.current += 1;
    setRefreshing(false);
  }, [connectionId]);

  return {
    actionSession,
    deferredSessionSearch,
    refreshGenerationRef,
    refreshing,
    searchOpen,
    selectedDirectory,
    selectedProjectId,
    sessionSearch,
    setActionSession,
    setRefreshing,
    setSearchOpen,
    setSelectedDirectory,
    setSelectedProjectId,
    setSessionSearch,
    setTab,
    showAttentionNotice,
    showConnectionNotice,
    tab,
  };
}

function useScreenFocused(navigation: FocusNavigation) {
  const [screenFocused, setScreenFocused] = useState(() => navigation.isFocused?.() ?? true);
  useEffect(() => {
    const focus = navigation.addListener?.("focus", () => setScreenFocused(true));
    const blur = navigation.addListener?.("blur", () => setScreenFocused(false));
    return () => {
      focus?.();
      blur?.();
    };
  }, [navigation]);
  return screenFocused;
}

function useWorkspaceBackHandlers({
  screenFocused,
  searchOpen,
  setSearchOpen,
  setSessionSearch,
  setTab,
  tab,
}: {
  screenFocused: boolean;
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  setSessionSearch: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<WorkspaceTab>>;
  tab: WorkspaceTab;
}) {
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
  }, [screenFocused, searchOpen, setSearchOpen, setSessionSearch]);

  // Android back returns to Chat before it can leave the screen.
  useEffect(() => {
    if (tab === "chat" || !screenFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setTab("chat");
      return true;
    });
    return () => subscription.remove();
  }, [screenFocused, setTab, tab]);
}

function useWorkspaceProjects(
  client: OpenCodeClient | undefined,
  connectionId: string | undefined,
) {
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
  return {
    defaultDirectory: defaultLocationQuery.data?.directory,
    defaultProjectId: defaultLocationQuery.data?.project.id,
    projects: projectsQuery.data ?? [],
  };
}

function useFollowedProjectSelection({
  defaultDirectory,
  defaultProjectId,
  projects,
  selectedProjectId,
  setSelectedDirectory,
  setSelectedProjectId,
  workspaceSelection,
}: {
  defaultDirectory: string | undefined;
  defaultProjectId: string | undefined;
  projects: ReturnType<typeof useWorkspaceProjects>["projects"];
  selectedProjectId: string | undefined;
  setSelectedDirectory: Dispatch<SetStateAction<string | undefined>>;
  setSelectedProjectId: Dispatch<SetStateAction<string | undefined>>;
  workspaceSelection: WorkspaceSelection;
}) {
  useEffect(() => {
    if (workspaceSelection.preferencesLoading) return;
    if (selectedProjectId && workspaceSelection.followedProjectIds.includes(selectedProjectId)) {
      return;
    }
    const project = selectFollowedProject(
      projects,
      workspaceSelection.followedProjectIds,
      defaultProjectId,
      defaultDirectory,
    );
    if (!project) return;
    setSelectedProjectId(project.id);
    setSelectedDirectory(project.directory);
  }, [
    defaultDirectory,
    defaultProjectId,
    projects,
    selectedProjectId,
    setSelectedDirectory,
    setSelectedProjectId,
    workspaceSelection.followedProjectIds,
    workspaceSelection.preferencesLoading,
  ]);
}

function useWorkspaceLocation(
  client: OpenCodeClient | undefined,
  connectionId: string | undefined,
  selectedDirectory: string | undefined,
) {
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
  return {
    location,
    locationQuery,
    mutationScope: `${connectionId ?? ""}\u0000${location?.directory ?? ""}`,
    requestedLocation,
  };
}

function useWorkspaceSelectionSync({
  deferredSessionSearch,
  location,
  mutationScope,
  removeAbortRef,
  setLocation,
  setSearch,
}: {
  deferredSessionSearch: string;
  location: ReturnType<typeof useWorkspaceLocation>["location"];
  mutationScope: string;
  removeAbortRef: RefObject<AbortController | null>;
  setLocation: WorkspaceSelection["setLocation"];
  setSearch: WorkspaceSelection["setSearch"];
}) {
  useEffect(() => {
    setSearch(deferredSessionSearch);
  }, [deferredSessionSearch, setSearch]);

  useEffect(() => {
    void mutationScope;
    return () => {
      removeAbortRef.current?.abort();
    };
  }, [mutationScope, removeAbortRef]);

  useEffect(() => {
    setLocation(location);
  }, [location, setLocation]);
}

async function trackRefresh(
  generationRef: RefObject<number>,
  setRefreshing: Dispatch<SetStateAction<boolean>>,
  load: () => Promise<unknown>,
) {
  const generation = generationRef.current + 1;
  generationRef.current = generation;
  setRefreshing(true);
  try {
    await load();
  } finally {
    if (generationRef.current === generation) setRefreshing(false);
  }
}

function refetchWorkspace(
  workspaceSelection: Refetchable,
  locationQuery: Refetchable,
  requestedLocation: LocationRef | undefined,
) {
  return Promise.all([
    workspaceSelection.refetch(),
    ...(requestedLocation ? [locationQuery.refetch()] : []),
  ]);
}

function toggleInboxSection(
  workspaceSelection: Pick<WorkspaceSelection, "setSectionExpanded">,
  { expanded, section }: { expanded: boolean; section: CollapsibleInboxSection },
  reducedMotion: boolean,
) {
  const expanding = !expanded;
  if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  workspaceSelection.setSectionExpanded(section, expanding);
  announceOnIOS(`${workspaceSectionLabels[section]} ${expanding ? "expanded" : "collapsed"}`);
}

function setSessionArchived(
  workspaceSelection: Pick<WorkspaceSelection, "archiveSession">,
  session: SessionInfo,
  archived: boolean,
) {
  void workspaceSelection.archiveSession(session, archived).then(
    () => {
      void Haptics.selectionAsync().catch(() => undefined);
      announceOnIOS(archived ? "Session archived" : "Session unarchived");
    },
    () =>
      Alert.alert(
        archived ? "Archive failed" : "Unarchive failed",
        "The session did not change. Refresh and try again.",
      ),
  );
}

function confirmSessionDelete(
  session: SessionInfo,
  projectLabel: string,
  hostName: string | undefined,
  onDelete: () => void,
) {
  const host = hostName ?? "selected server";
  const childWarning = session.parentID
    ? "This is a child session."
    : "Deleting a parent also deletes all child sessions.";
  Alert.alert(
    "Delete session?",
    `Host: ${host}\nProject: ${projectLabel}\nLocation: ${session.location.directory}\n\n${childWarning}`,
    [
      { style: "cancel", text: "Cancel" },
      { onPress: onDelete, style: "destructive", text: "Delete" },
    ],
  );
}

function WorkspaceSessionsHeader({
  attentionNotice,
  connectionNotice,
  deferredSearch,
  onOpenApprovals,
  onRetry,
  pendingCount,
  refreshing,
  retryable,
  search,
  sessionCount,
  tablet,
}: {
  attentionNotice: string | undefined;
  connectionNotice: string | undefined;
  deferredSearch: string;
  onOpenApprovals: () => void;
  onRetry: () => void;
  pendingCount: number;
  refreshing: boolean;
  retryable: boolean;
  search: string;
  sessionCount: number;
  tablet: boolean;
}) {
  const pending = pendingShortcutLabels(pendingCount);
  return (
    <View style={styles.homeHeader}>
      {/* Search hides the bottom menu, so it keeps a way to the Approvals tab. */}
      {!tablet && search && pendingCount > 0 ? (
        <View style={styles.workspaceActions}>
          <HeaderAction
            accessibilityHint="Closes search and opens Approvals"
            accessibilityLabel={pending.accessibilityLabel}
            attention
            label={pending.label}
            onPress={onOpenApprovals}
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
          {retryable ? <RetryButton busy={refreshing} onPress={onRetry} /> : null}
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
      {deferredSearch ? <ListSectionHeader count={sessionCount} label="Search results" /> : null}
    </View>
  );
}

function WorkspaceSecondaryTab({
  active,
  navigation,
  tab,
}: {
  active: boolean;
  navigation: WorkspaceNavigation;
  tab: WorkspaceTab;
}) {
  if (tab === "pulls") {
    return (
      <PullRequestList
        active={active}
        onChooseProjects={() => navigation.navigate("FollowedProjects")}
      />
    );
  }
  if (tab === "approvals") {
    return (
      <PendingInteractions
        bottomInset={bottomMenuInset}
        heading={false}
        onNavigate={(destination) => navigation.navigate(destination)}
      />
    );
  }
  return null;
}

function renderSearchResultsFooter({
  busy,
  hasNextPage,
  onLoadMore,
  search,
}: {
  busy: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
  search: string;
}) {
  if (!search || !hasNextPage) return null;
  return (
    <View style={styles.listFooter}>
      <ActionButton busy={busy} label="Load more results" onPress={onLoadMore} secondary />
    </View>
  );
}

export function SessionScreen({ navigation, route }: SessionProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const screenFocused = useScreenFocused(navigation);
  const transcriptPreferences = useTranscriptPreferences();
  const runtime = useConnectionRuntime();
  const modelFavorites = useModelFavorites(runtime.connectionId, runtime.connectionUpdatedAtMs);
  const workspaceSelection = useWorkspaceSelection();
  const queryClient = useQueryClient();
  const { fontScale, width } = useWindowDimensions();
  const screenHeight = Dimensions.get("screen").height;
  const largeText = usesLargeTextLayout(fontScale);
  const { connectionId: routeConnectionId, focusComposer, sessionID } = route.params;
  const connectionId = runtime.connectionId;
  const client = runtime.restClient;
  const {
    routeSessionScope,
    selectedTab,
    sessionQueryLocation,
    setSessionQueryScope,
    setSessionTab,
  } = useSessionRouteScope(route.params);
  const follow = useTranscriptLiveFollow();
  const reducedMotion = useReducedMotion();
  // New rows and lines land below the anchored row, then the native list scrolls
  // them into view, so streamed text slides up instead of popping in.
  const smoothLiveEdge = follow.liveFollowEnabled && !reducedMotion;
  const smoothLiveEdgeRef = useRef(smoothLiveEdge);
  smoothLiveEdgeRef.current = smoothLiveEdge;
  const [transcriptSize, setTranscriptSize] = useState<TranscriptSize>({
    scope: "",
    viewport: 0,
    content: 0,
  });
  const dock = useComposerDock(screenHeight);
  const [mentionSearch, setMentionSearch] = useState<string>();
  const deferredMentionSearch = useDeferredValue(mentionSearch);
  const { session, sessionLocation, sessionLocationReady, sessionQuery, sessionTitle } =
    useSessionRecord({
      client,
      connectionId,
      location: sessionQueryLocation,
      routeConnectionId,
      sessionID,
    });
  useMarkSessionViewed({
    client: connectionId === routeConnectionId ? (client ?? undefined) : undefined,
    enabled: screenFocused,
    session,
  });
  useSessionHeaderOptions({
    navigation,
    routeSessionScope,
    sessionLocationReady,
    sessionTitle,
    setActionsOpen,
  });
  const resourcesReady = Boolean(
    client && connectionId === routeConnectionId && sessionLocationReady,
  );
  const vcsQuery = useSessionVcsQuery(client, connectionId, sessionLocation, resourcesReady);
  const messagesQuery = useSessionMessagesQuery({
    client,
    connectionId,
    enabled: resourcesReady,
    location: sessionLocation,
    sessionID,
  });
  const mentionFilesQuery = useMentionFilesQuery({
    client,
    enabled: resourcesReady,
    location: sessionLocation,
    routeConnectionId,
    search: deferredMentionSearch,
  });
  const currentBranch = vcsQuery.data?.data.branch.current;
  const branch = sessionBranchState(
    currentBranch,
    vcsQuery.isError || runtime.status !== "connected",
    vcsQuery.isPending,
  );
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
  const waitingFor = sessionWaitingFor(sessionPermissions.length, sessionForms.length);
  const sessionMutationScope = `${routeConnectionId}\u0000${sessionID}`;
  const connected = runtime.status === "connected";
  const {
    autoFillTranscript,
    canLoadOlder,
    showOlderContextLoading,
    transcriptMeasureScope,
    transcriptPageCount,
  } = useTranscriptAutoFill({
    connected: connectionId === routeConnectionId && connected,
    fontScale,
    liveFollowEnabled: follow.liveFollowEnabled,
    messagesQuery,
    ready: sessionLocationReady,
    routeSessionScope,
    sessionLocation,
    transcriptSize,
    visible: screenFocused && selectedTab === "session",
  });
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

  useAdoptSessionLocation({
    queryClient,
    routeConnectionId,
    routeSessionScope,
    session,
    sessionID,
    sessionLocation,
    sessionLocationReady,
    sessionQueryLocation,
    setLocation: workspaceSelection.setLocation,
    setSessionQueryScope,
  });

  useIosComposerKeyboardOffset(dock.composerDockScreenBottom, dock.setComposerKeyboardOffset);

  useTranscriptLiveFollowReset(sessionMutationScope, follow);

  useEffect(() => {
    recordTranscriptResidentSet(transcriptPageCount, messages.length);
  }, [messages.length, transcriptPageCount]);

  if (connectionId !== routeConnectionId) {
    return (
      <ShellFrame
        active="Workspace"
        navigate={(section) => navigateFromSession(navigation, section)}
      >
        <StaleSessionRoute navigation={navigation} />
      </ShellFrame>
    );
  }

  const changesTab = selectedTab === "changes";
  const composerDockContent = (
    <View onLayout={dock.measureComposerContent}>
      <SessionDockPanel
        activeSessions={activeSessions}
        client={client}
        connectionId={connectionId}
        execution={execution}
        failedPermissionReplyId={workspaceSelection.failedPermissionReplyId}
        formLocations={workspaceSelection.formLocations}
        messages={visibleBackgroundMessages(
          messages,
          sessionLocationReady && connected,
          messagesQuery.isError,
        )}
        onOpenChild={openSubagent}
        onReplyPermission={workspaceSelection.replyPermission}
        permissions={sessionPermissions}
        replyingPermissionId={workspaceSelection.replyingPermissionId}
        routeSessionScope={routeSessionScope}
        sessionForms={sessionForms}
        sessionID={sessionID}
        sessionLocation={sessionLocation}
        tablet={isTabletShell(width)}
      />
      <SessionDockComposer
        connected={connected}
        deferredMentionSearch={deferredMentionSearch}
        draft={draft}
        execution={execution}
        favorites={modelFavorites}
        focusComposer={focusComposer}
        largeText={largeText}
        mentionFilesQuery={mentionFilesQuery}
        mentionSearch={mentionSearch}
        onMentionSearchChange={setMentionSearch}
        sessionLocation={sessionLocation}
        sessionLocationReady={sessionLocationReady}
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
      navigate={(section) => navigateFromSession(navigation, section)}
    >
      {changesTab ? (
        <SessionChanges
          connectionId={routeConnectionId}
          location={sessionLocation}
          mode="working"
        />
      ) : null}
      <View
        accessibilityLabel="Keyboard-aware session"
        style={[styles.transcriptContainer, changesTab && { display: "none" }]}
        accessibilityElementsHidden={changesTab}
        importantForAccessibility={changesTab ? "no-hide-descendants" : "auto"}
      >
        <SessionShellScope.Provider
          value={{
            client,
            connectionId: routeConnectionId,
            location: sessionLocation,
            enabled: resourcesReady && screenFocused && selectedTab === "session",
          }}
        >
          <SessionSubagentStates.Provider value={transcriptSubagentStates}>
            <SessionTranscriptList
              autoFillTranscript={autoFillTranscript}
              canLoadOlder={canLoadOlder}
              execution={execution}
              follow={follow}
              fontScale={fontScale}
              items={transcriptItems}
              largeText={largeText}
              measureScope={transcriptMeasureScope}
              messagesQuery={messagesQuery}
              onContentSizeChange={(_width, height) => {
                setTranscriptSize((current) =>
                  withTranscriptContentSize(current, transcriptMeasureScope, height),
                );
                follow.scheduleLiveEdgeScroll(transcriptItems.length);
              }}
              onLayout={(event) => {
                const height = event.nativeEvent.layout.height;
                setTranscriptSize((current) =>
                  withTranscriptViewportSize(current, transcriptMeasureScope, height),
                );
                follow.scheduleLiveEdgeScroll(transcriptItems.length);
              }}
              onOpenDiff={openDiff}
              onOpenSubagent={openSubagent}
              onRetrySession={() => void sessionQuery.refetch()}
              sessionError={sessionQuery.isError}
              sessionPending={sessionQuery.isPending}
              showOlderContextLoading={showOlderContextLoading}
              smoothLiveEdge={smoothLiveEdge}
              transcriptFooters={transcriptFooters}
              transcriptPreferences={transcriptPreferences}
              waitingFor={waitingFor}
            />
          </SessionSubagentStates.Provider>
        </SessionShellScope.Provider>
        <ScrollToLatestButton
          bottom={dock.composerDockHeight + dock.composerKeyboardOffset + space.sm}
          follow={follow}
          itemCount={transcriptItems.length}
        />
        <View
          pointerEvents="none"
          style={{ height: dock.composerDockHeight + dock.composerKeyboardOffset, flexShrink: 0 }}
        />
        <ComposerDock dock={dock}>{composerDockContent}</ComposerDock>
      </View>
      <SessionScreenActionSheet
        branch={branch}
        currentBranch={currentBranch}
        navigation={navigation}
        onClose={() => setActionsOpen(false)}
        open={actionsOpen && sessionLocationReady}
        routeConnectionId={routeConnectionId}
        routeSessionScope={routeSessionScope}
        session={sessionQuery.data}
        sessionLocation={sessionLocation}
      />
    </ShellFrame>
  );
}

function useSessionRouteScope({
  connectionId,
  location,
  sessionID,
}: SessionProps["route"]["params"]) {
  const routeSessionScope = `${connectionId}\u0000${sessionID}\u0000${location.directory}\u0000${location.workspaceID ?? ""}`;
  const [sessionTab, setSessionTab] = useState<{ scope: string; tab: "session" | "changes" }>({
    scope: routeSessionScope,
    tab: "session",
  });
  const [sessionQueryScope, setSessionQueryScope] = useState({
    location,
    routeSessionScope,
  });
  return {
    routeSessionScope,
    selectedTab: sessionTab.scope === routeSessionScope ? sessionTab.tab : "session",
    sessionQueryLocation:
      sessionQueryScope.routeSessionScope === routeSessionScope
        ? sessionQueryScope.location
        : location,
    setSessionQueryScope,
    setSessionTab,
  };
}

function useSessionRecord({
  client,
  connectionId,
  location,
  routeConnectionId,
  sessionID,
}: {
  client: OpenCodeClient | undefined;
  connectionId: string | undefined;
  location: LocationRef;
  routeConnectionId: string;
  sessionID: string;
}) {
  const sessionQuery = useQuery({
    enabled: Boolean(client && connectionId === routeConnectionId),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getOpenCodeSession(client, sessionID, { signal });
    },
    queryKey: openCodeQueryKeys.session(connectionId ?? "unselected", location, sessionID),
  });
  const session = sessionQuery.data;
  return {
    session,
    sessionLocation: session?.location ?? location,
    sessionLocationReady: Boolean(
      sessionQuery.isSuccess && session && locationsEqual(session.location, location),
    ),
    sessionQuery,
    sessionTitle: connectionId === routeConnectionId ? session?.title?.trim() : undefined,
  };
}

function useSessionHeaderOptions({
  navigation,
  routeSessionScope,
  sessionLocationReady,
  sessionTitle,
  setActionsOpen,
}: {
  navigation: SessionNavigation;
  routeSessionScope: string;
  sessionLocationReady: boolean;
  sessionTitle: string | undefined;
  setActionsOpen: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    navigation.setOptions({ title: sessionTitle || "Untitled session" });
  }, [navigation, sessionTitle]);
  useEffect(() => {
    void routeSessionScope;
    setActionsOpen(false);
  }, [routeSessionScope, setActionsOpen]);
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
  }, [navigation, sessionLocationReady, setActionsOpen]);
}

function useSessionVcsQuery(
  client: OpenCodeClient | undefined,
  connectionId: string | undefined,
  location: LocationRef,
  enabled: boolean,
) {
  return useQuery({
    enabled,
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getOpenCodeVcs(client, location, { signal });
    },
    queryKey: openCodeQueryKeys.vcs(connectionId ?? "unselected", location),
  });
}

function useSessionMessagesQuery({
  client,
  connectionId,
  enabled,
  location,
  sessionID,
}: {
  client: OpenCodeClient | undefined;
  connectionId: string | undefined;
  enabled: boolean;
  location: LocationRef;
  sessionID: string;
}) {
  return useInfiniteQuery({
    enabled,
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
}

function useMentionFilesQuery({
  client,
  enabled,
  location,
  routeConnectionId,
  search,
}: {
  client: OpenCodeClient | undefined;
  enabled: boolean;
  location: LocationRef;
  routeConnectionId: string;
  search: string | undefined;
}) {
  return useQuery({
    enabled: enabled && search !== undefined,
    queryFn: ({ signal }) => {
      if (!client || search === undefined) throw new Error("CONNECTION_NOT_READY");
      return findOpenCodeFiles(client, location, search, {
        limit: mentionFileLimit,
        signal,
      });
    },
    queryKey: openCodeQueryKeys.fileFind(
      routeConnectionId,
      location,
      search ?? "",
      mentionFileLimit,
    ),
  });
}

function useTranscriptAutoFill({
  connected,
  fontScale,
  liveFollowEnabled,
  messagesQuery,
  ready,
  routeSessionScope,
  sessionLocation,
  transcriptSize,
  visible,
}: {
  connected: boolean;
  fontScale: number;
  liveFollowEnabled: boolean;
  messagesQuery: SessionMessagesQuery;
  ready: boolean;
  routeSessionScope: string;
  sessionLocation: LocationRef;
  transcriptSize: TranscriptSize;
  visible: boolean;
}) {
  const transcriptPageCount = messagesQuery.data?.pages.length ?? 0;
  const canLoadOlder = Boolean(
    messagesQuery.hasNextPage && transcriptPageCount < maxTranscriptPages,
  );
  const transcriptMeasureScope = JSON.stringify([
    routeSessionScope,
    sessionLocation.directory,
    sessionLocation.workspaceID ?? null,
    fontScale,
  ]);
  const autoFillTranscript = shouldAutoFillTranscript({
    canLoadOlder,
    connected,
    liveFollowEnabled,
    messagesError: messagesQuery.isError,
    messagesPending: messagesQuery.isPending,
    ready,
    size: transcriptSize,
    sizeScope: transcriptMeasureScope,
    viewportSlack: space.md,
    visible,
  });
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
  return {
    autoFillTranscript,
    canLoadOlder,
    showOlderContextLoading,
    transcriptMeasureScope,
    transcriptPageCount,
  };
}

function useAdoptSessionLocation({
  queryClient,
  routeConnectionId,
  routeSessionScope,
  session,
  sessionID,
  sessionLocation,
  sessionLocationReady,
  sessionQueryLocation,
  setLocation,
  setSessionQueryScope,
}: {
  queryClient: ReturnType<typeof useQueryClient>;
  routeConnectionId: string;
  routeSessionScope: string;
  session: SessionInfo | undefined;
  sessionID: string;
  sessionLocation: LocationRef;
  sessionLocationReady: boolean;
  sessionQueryLocation: LocationRef;
  setLocation: WorkspaceSelection["setLocation"];
  setSessionQueryScope: Dispatch<
    SetStateAction<{ location: LocationRef; routeSessionScope: string }>
  >;
}) {
  useEffect(() => {
    if (!session || locationsEqual(session.location, sessionQueryLocation)) return;
    queryClient.setQueryData(
      openCodeQueryKeys.session(routeConnectionId, session.location, sessionID),
      session,
    );
    setSessionQueryScope({ location: session.location, routeSessionScope });
  }, [
    queryClient,
    routeConnectionId,
    routeSessionScope,
    session,
    sessionID,
    sessionQueryLocation,
    setSessionQueryScope,
  ]);

  useEffect(() => {
    if (!sessionLocationReady) return;
    setLocation(sessionLocation);
  }, [sessionLocation, sessionLocationReady, setLocation]);
}

function useComposerDock(screenHeight: number) {
  const [composerDockHeight, setComposerDockHeight] = useState(66);
  const [composerDockScreenBottom, setComposerDockScreenBottom] = useState(0);
  const [composerKeyboardOffset, setComposerKeyboardOffset] = useState(0);
  const composerDockRef = useRef<View>(null);
  const measuredComposerDockScreenHeightRef = useRef<number | undefined>(undefined);

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

  return {
    composerDockHeight,
    composerDockRef,
    composerDockScreenBottom,
    composerKeyboardOffset,
    measureComposerContent,
    measureComposerDock,
    setComposerKeyboardOffset,
  };
}

function useIosComposerKeyboardOffset(
  composerDockScreenBottom: number,
  setComposerKeyboardOffset: Dispatch<SetStateAction<number>>,
) {
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
  }, [composerDockScreenBottom, setComposerKeyboardOffset]);
}

function navigateFromSession(navigation: SessionNavigation, section: ShellSection) {
  return section === "Workspace" ? navigation.popTo("Workspace") : navigation.navigate(section);
}

function visibleBackgroundMessages(
  messages: SessionMessages,
  connectedAndReady: boolean,
  messagesError: boolean,
) {
  return connectedAndReady && !messagesError ? messages : [];
}

function StaleSessionRoute({ navigation }: { navigation: SessionNavigation }) {
  return (
    <View style={styles.staleRoute}>
      <InlineError message="This session belongs to a different connection." />
      <ActionButton
        label="Back to sessions"
        onPress={() => navigation.popTo("Workspace")}
        style={styles.staleRouteAction}
      />
    </View>
  );
}

function SessionScreenActionSheet({
  branch,
  currentBranch,
  navigation,
  onClose,
  open,
  routeConnectionId,
  routeSessionScope,
  session,
  sessionLocation,
}: {
  branch: ReturnType<typeof sessionBranchState>;
  currentBranch: string | undefined;
  navigation: SessionNavigation;
  onClose: () => void;
  open: boolean;
  routeConnectionId: string;
  routeSessionScope: string;
  session: SessionInfo | undefined;
  sessionLocation: LocationRef;
}) {
  if (!open || !session) return null;
  return (
    <SessionActionSheet
      key={JSON.stringify([routeSessionScope, sessionLocation])}
      connectionId={routeConnectionId}
      session={session}
      branch={currentBranch}
      branchStale={branch.state === "known" && branch.stale}
      onClose={onClose}
      onDeleted={() => {
        onClose();
        navigation.popTo("Workspace");
      }}
    />
  );
}

function SessionDockPanel({
  activeSessions,
  client,
  connectionId,
  execution,
  failedPermissionReplyId,
  formLocations,
  messages,
  onOpenChild,
  onReplyPermission,
  permissions,
  replyingPermissionId,
  routeSessionScope,
  sessionForms,
  sessionID,
  sessionLocation,
  tablet,
}: {
  activeSessions: SessionExecution["activeSessions"];
  client: OpenCodeClient | undefined;
  connectionId: string;
  execution: SessionExecution;
  failedPermissionReplyId: WorkspaceSelection["failedPermissionReplyId"];
  formLocations: WorkspaceSelection["formLocations"];
  messages: SessionMessages;
  onOpenChild: (sessionID: string) => void;
  onReplyPermission: WorkspaceSelection["replyPermission"];
  permissions: WorkspaceSelection["permissions"];
  replyingPermissionId: WorkspaceSelection["replyingPermissionId"];
  routeSessionScope: string;
  sessionForms: WorkspaceSelection["forms"];
  sessionID: string;
  sessionLocation: LocationRef;
  tablet: boolean;
}) {
  return (
    <>
      <SessionBackgroundTasks
        key={routeSessionScope}
        activeSessions={activeSessions}
        sessionID={sessionID}
        messages={messages}
        onOpenChild={onOpenChild}
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
              focusSingle={!tablet && permissions.length === 0}
              client={client}
              connectionId={connectionId}
              formLocations={formLocations}
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
        onReplyPermission={onReplyPermission}
        onSteerInbox={execution.steerInbox}
        failedPermissionReplyId={failedPermissionReplyId}
        permissions={permissions}
        projectedMessageIds={execution.projectedMessageIds}
        replyingPermissionId={replyingPermissionId}
      />
    </>
  );
}

function SessionDockComposer({
  connected,
  deferredMentionSearch,
  draft,
  execution,
  favorites,
  focusComposer,
  largeText,
  mentionFilesQuery,
  mentionSearch,
  onMentionSearchChange,
  sessionLocation,
  sessionLocationReady,
}: {
  connected: boolean;
  deferredMentionSearch: string | undefined;
  draft: SessionDraft;
  execution: SessionExecution;
  favorites: ReturnType<typeof useModelFavorites>;
  focusComposer: boolean | undefined;
  largeText: boolean;
  mentionFilesQuery: ReturnType<typeof useMentionFilesQuery>;
  mentionSearch: string | undefined;
  onMentionSearchChange: (search: string | undefined) => void;
  sessionLocation: LocationRef;
  sessionLocationReady: boolean;
}) {
  const mentions = mentionFileState({
    deferredSearch: deferredMentionSearch,
    executionLoading: execution.mentionLoading,
    executionUnavailable: execution.mentionUnavailable,
    files: mentionFilesQuery.data?.data,
    filesError: mentionFilesQuery.isError,
    filesPending: mentionFilesQuery.isPending,
    search: mentionSearch,
  });
  return (
    <SessionComposer
      onInterrupt={execution.interrupt}
      interruptDisabled={Boolean(execution.busyAction) || !sessionLocationReady || !connected}
      stopping={execution.busyAction === "interrupt"}
      active={execution.active}
      agent={execution.selectedAgent}
      agents={execution.agents}
      agentCatalog={execution.agentCatalog}
      modelCatalog={execution.modelCatalog}
      favorites={favorites}
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
      mentionFiles={mentions.files}
      mentionLoading={mentions.loading}
      mentions={draft.mentions}
      mentionUnavailable={mentions.unavailable}
      model={execution.selectedModel}
      models={execution.models}
      onAgentChange={execution.switchAgent}
      onDraftChange={draft.setDraft}
      onModelChange={execution.switchModel}
      onMentionSearchChange={onMentionSearchChange}
      onSubmit={(intent) => execution.submit(draft.draft, intent)}
      skills={execution.skills}
    />
  );
}

function SessionTranscriptList({
  autoFillTranscript,
  canLoadOlder,
  execution,
  follow,
  fontScale,
  items,
  largeText,
  measureScope,
  messagesQuery,
  onContentSizeChange,
  onLayout,
  onOpenDiff,
  onOpenSubagent,
  onRetrySession,
  sessionError,
  sessionPending,
  showOlderContextLoading,
  smoothLiveEdge,
  transcriptFooters,
  transcriptPreferences,
  waitingFor,
}: {
  autoFillTranscript: boolean;
  canLoadOlder: boolean;
  execution: SessionExecution;
  follow: TranscriptLiveFollow;
  fontScale: number;
  items: TranscriptListItem[];
  largeText: boolean;
  measureScope: string;
  messagesQuery: SessionMessagesQuery;
  onContentSizeChange: (width: number, height: number) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onOpenDiff: () => void;
  onOpenSubagent: (sessionID: string) => void;
  onRetrySession: () => void;
  sessionError: boolean;
  sessionPending: boolean;
  showOlderContextLoading: boolean;
  smoothLiveEdge: boolean;
  transcriptFooters: TranscriptFooters;
  transcriptPreferences: ReturnType<typeof useTranscriptPreferences>;
  waitingFor: ReturnType<typeof sessionWaitingFor>;
}) {
  const rowContext = {
    detailed: transcriptPreferences.detailed,
    footers: transcriptFooters,
    largeText,
    models: execution.models,
    onOpenDiff,
    onOpenSubagent,
    showReasoning: transcriptPreferences.reasoning,
    waitingFor,
  };
  return (
    <Animated.FlatList
      accessibilityLabel="Session transcript"
      contentContainerStyle={[styles.detailContent, largeText && styles.detailContentLargeText]}
      data={items}
      extraData={fontScale}
      initialNumToRender={12}
      inverted
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
      key={`session-transcript:${measureScope}`}
      keyExtractor={(message) => message.id}
      ListEmptyComponent={renderTranscriptEmptyState(messagesQuery, execution.active)}
      ListFooterComponent={
        <TranscriptListFooter
          autoFillTranscript={autoFillTranscript}
          canLoadOlder={canLoadOlder}
          messagesQuery={messagesQuery}
          onRetrySession={onRetrySession}
          sessionError={sessionError}
          sessionPending={sessionPending}
          showOlderContextLoading={showOlderContextLoading}
        />
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
              waitingFor={waitingFor}
            />
          </View>
        ) : null
      }
      {...(smoothLiveEdge ? { itemLayoutAnimation: liveEdgeRowTransition } : {})}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      maxToRenderPerBatch={12}
      onContentSizeChange={onContentSizeChange}
      onLayout={onLayout}
      onMomentumScrollBegin={follow.handleMomentumScrollBegin}
      onMomentumScrollEnd={follow.handleMomentumScrollEnd}
      onScroll={follow.handleTranscriptScroll}
      onScrollBeginDrag={follow.handleScrollBeginDrag}
      onScrollEndDrag={follow.handleScrollEndDrag}
      ref={follow.transcriptListRef}
      renderItem={({ item }) => renderTranscriptItem(item, rowContext)}
      scrollEventThrottle={16}
      style={styles.transcriptList}
      updateCellsBatchingPeriod={40}
      windowSize={7}
    />
  );
}

function renderTranscriptEmptyState(messagesQuery: SessionMessagesQuery, active: boolean) {
  if (messagesQuery.isPending) {
    return (
      <View style={styles.transcriptState}>
        <ActivityIndicator accessibilityLabel="Loading transcript" color={palette.signal} />
      </View>
    );
  }
  if (!messagesQuery.isError) {
    // A working session already shows its status in the list header.
    if (active || !messagesQuery.isSuccess) return null;
    return (
      <View style={[styles.transcriptState, styles.transcriptEmpty]}>
        <Text dynamicTypeRamp={typeRamp.headline} style={styles.transcriptEmptyTitle}>
          No messages yet
        </Text>
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.transcriptEmptyCopy}>
          Send a message to start. Type @ to mention a file or agent, or / for a command.
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.transcriptState, styles.transcriptRetry]}>
      <InlineError message={transcriptLoadErrorMessage(messagesQuery.error)} />
      <RetryButton busy={messagesQuery.isRefetching} onPress={() => void messagesQuery.refetch()} />
    </View>
  );
}

function TranscriptListFooter({
  autoFillTranscript,
  canLoadOlder,
  messagesQuery,
  onRetrySession,
  sessionError,
  sessionPending,
  showOlderContextLoading,
}: {
  autoFillTranscript: boolean;
  canLoadOlder: boolean;
  messagesQuery: SessionMessagesQuery;
  onRetrySession: () => void;
  sessionError: boolean;
  sessionPending: boolean;
  showOlderContextLoading: boolean;
}) {
  return (
    <View style={styles.detailHeader}>
      {sessionPending ? <ActivityIndicator color={palette.signal} /> : null}
      {sessionError ? (
        <View style={styles.transcriptRetry}>
          <InlineError message="The session could not be loaded." />
          <RetryButton busy={false} onPress={onRetrySession} />
        </View>
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
  );
}

function renderTranscriptItem(
  item: TranscriptListItem,
  context: {
    detailed: boolean;
    footers: TranscriptFooters;
    largeText: boolean;
    models: SessionExecution["models"];
    onOpenDiff: () => void;
    onOpenSubagent: (sessionID: string) => void;
    showReasoning: boolean;
    waitingFor: ReturnType<typeof sessionWaitingFor>;
  },
) {
  if (item.type === "pending-prompt") {
    return <PendingPromptRow preview={item} largeText={context.largeText} />;
  }
  if (item.type === "activity-group") {
    return (
      <TranscriptActivityGroup
        waitingFor={context.waitingFor}
        item={item}
        largeText={context.largeText}
        showReasoning={context.showReasoning}
        onOpenDiff={context.onOpenDiff}
        onOpenSubagent={context.onOpenSubagent}
      />
    );
  }
  if (item.type === "updates-group") {
    return (
      <TranscriptUpdatesGroup
        item={item}
        largeText={context.largeText}
        onOpenSubagent={context.onOpenSubagent}
      />
    );
  }
  return (
    <SessionTranscriptRow
      hideFooter={!context.footers.has(item.id)}
      turnDuration={context.footers.get(item.id) ?? null}
      detailed={context.detailed}
      showReasoning={context.showReasoning}
      largeText={context.largeText}
      message={item}
      modelName={
        item.type === "assistant"
          ? context.models.find(
              (model) => model.id === item.model.id && model.providerID === item.model.providerID,
            )?.name
          : undefined
      }
      onOpenDiff={context.onOpenDiff}
      onOpenSubagent={context.onOpenSubagent}
    />
  );
}

function ScrollToLatestButton({
  bottom,
  follow,
  itemCount,
}: {
  bottom: number;
  follow: TranscriptLiveFollow;
  itemCount: number;
}) {
  if ((follow.liveFollowEnabled && !follow.latestJumpPending) || itemCount === 0) return null;
  return (
    <Pressable
      accessibilityHint="Returns to new transcript output and resumes live follow"
      accessibilityLabel="Scroll to latest"
      accessibilityRole="button"
      onPress={follow.scrollToLatest}
      style={({ pressed }) => [styles.latestButton, { bottom }, pressed && styles.pressed]}
    >
      <Feather
        accessibilityElementsHidden
        color={palette.ink}
        importantForAccessibility="no-hide-descendants"
        name="arrow-down"
        size={24}
      />
    </Pressable>
  );
}

function ComposerDock({ children, dock }: { children: ReactNode; dock: ComposerDockState }) {
  if (Platform.OS === "android") {
    return (
      <KeyboardStickyView accessibilityLabel="Keyboard composer dock" style={styles.composerDock}>
        {children}
      </KeyboardStickyView>
    );
  }
  return (
    <View
      accessibilityLabel="Keyboard composer dock"
      onLayout={dock.measureComposerDock}
      ref={dock.composerDockRef}
      style={[styles.composerDock, { bottom: dock.composerKeyboardOffset }]}
    >
      {children}
    </View>
  );
}

// The separator above Working and Archived. It shows the section's count and collapses it.
function InboxSectionHeader({
  count,
  expanded,
  onToggle,
  section,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  section: CollapsibleInboxSection;
}) {
  const label = workspaceSectionLabels[section];
  const sessions = `${section} sessions`;
  return (
    <Pressable
      accessibilityHint={expanded ? `Hides ${sessions}` : `Shows ${sessions}`}
      accessibilityLabel={`${label}, ${count} ${count === 1 ? "session" : "sessions"}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      android_ripple={rowRipple}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.inboxSectionHeader,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
      testID={`${section}-section-toggle`}
    >
      <Text dynamicTypeRamp={typeRamp.footnote} numberOfLines={1} style={styles.inboxSectionLabel}>
        {label}
      </Text>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.inboxSectionCount}>
        {count}
      </Text>
      <View style={styles.inboxSectionChevron}>
        <Feather
          accessible={false}
          color={palette.dim}
          name={expanded ? "chevron-down" : "chevron-right"}
          size={16}
        />
      </View>
    </Pressable>
  );
}

function SessionEmptyState({
  error,
  hasLocation,
  hasWorking,
  loading,
  onChooseProjects,
  onRetry,
  refreshing,
  search,
}: {
  error: boolean;
  hasLocation: boolean;
  hasWorking: boolean;
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
  if (search) {
    return (
      <View style={styles.emptyState}>
        <Feather accessible={false} color={palette.dim} name="search" size={36} />
        <Text
          accessibilityRole="header"
          dynamicTypeRamp={typeRamp.headline}
          style={styles.emptyTitle}
        >
          No matching sessions
        </Text>
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.emptyCopy}>
          Search looks through sessions in the projects you follow. Try a different word.
        </Text>
      </View>
    );
  }
  // Recent starts empty and fills as runs finish, so say what will arrive and when.
  return (
    <View style={styles.emptyState} testID="inbox-idle">
      <Feather accessible={false} color={palette.dim} name="inbox" size={36} />
      <Text
        accessibilityRole="header"
        dynamicTypeRamp={typeRamp.headline}
        style={styles.emptyTitle}
      >
        Nothing needs you right now
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.emptyCopy}>
        {hasWorking
          ? "Sessions show up here when they're new, need your answer, or finish a run. Running sessions are under Working."
          : "Sessions show up here when they're new, need your answer, or finish a run. Start one with New session."}
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
  label,
  onPress,
}: {
  accessibilityHint: string;
  accessibilityLabel?: string;
  attention?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerAction,
        attention && styles.headerActionAttention,
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

function locationsEqual(first: LocationRef, second: LocationRef) {
  return (
    first.directory === second.directory &&
    (first.workspaceID ?? null) === (second.workspaceID ?? null)
  );
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
  hiddenPanel: { display: "none" },
  inboxSectionCount: { ...typography.footnote, color: palette.dim },
  inboxSectionChevron: { marginLeft: "auto" },
  inboxSectionHeader: {
    alignItems: "center",
    borderColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: space.xs,
    minHeight: minTouchTarget,
    paddingHorizontal: space.md,
  },
  inboxSectionLabel: { ...typography.sectionLabel, color: palette.dim, flexShrink: 1 },
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
    paddingBottom: bottomMenuInset,
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
  staleRoute: { alignSelf: "center", maxWidth: 640, padding: space.lg, width: "100%" },
  staleRouteAction: { marginTop: space.md },
  tabPanel: { flex: 1 },
  workspaceActions: { alignItems: "center", flexDirection: "row", gap: space.sm },
  transcriptContainer: { flex: 1 },
  transcriptList: { flex: 1 },
  transcriptState: { alignItems: "center", minHeight: 140, padding: space.lg },
  transcriptEmpty: { gap: space.xs, justifyContent: "center" },
  transcriptEmptyCopy: { ...typography.subheadline, color: palette.dim, textAlign: "center" },
  transcriptEmptyTitle: { ...typography.headline, color: palette.ink, textAlign: "center" },
  transcriptLimit: {
    ...typography.footnote,
    color: palette.dim,
    paddingBottom: space.sm,
    textAlign: "center",
  },
  transcriptRetry: { alignItems: "center", gap: space.sm },
});
