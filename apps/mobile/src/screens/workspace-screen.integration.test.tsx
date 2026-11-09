import Feather from "@expo/vector-icons/Feather";
import { afterEach, expect, jest, test } from "@jest/globals";
import {
  getOpenCodeLocation,
  getOpenCodeSession,
  getOpenCodeVcs,
  interruptOpenCodeSession,
  listOpenCodeAgents,
  listOpenCodeMessages,
  type PermissionRequest,
  type SessionInfo,
  type SessionMessageInfo,
  type SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";
import { type InfiniteData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import {
  AccessibilityInfo,
  Alert,
  BackHandler,
  Dimensions,
  FlatList,
  Keyboard,
  Linking,
  Platform,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { ConnectionEventQueryBridge } from "../state/connection-event-query-bridge";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { WorkspaceSelectionProvider } from "../state/workspace-selection-context";
import { disabledOpacity, palette, pressedOpacity, typography } from "../theme";
import { ShellFrame } from "./app-shell";
import { SessionScreen, WorkspaceScreen } from "./workspace-screen";

jest.mock("../state/transcript-preferences", () => ({
  useTranscriptPreferences: () => ({ detailed: false, reasoning: true }),
}));

const location = {
  directory: "/workspace",
  project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
};
const mockListForms = jest.fn(async () => ({ data: [], location }));
const mockListPermissions = jest.fn(async () => ({ data: [], location }));
const mockGetShell = jest.fn(async () => ({
  location,
  data: {
    id: "sh_background",
    status: "running",
    command: "build",
    cwd: "/workspace",
    shell: "sh",
    file: "/output",
    metadata: {},
    time: { started: 1 },
  },
}));
const mockShellOutput = jest.fn(async () => ({
  location,
  data: { output: "Build progress 50%", cursor: 18, size: 18, truncated: false },
}));
const mockReplyPermission = jest.fn();
const mockSetLocation = jest.fn();
const mockWorkspaceRefetch = jest.fn<() => Promise<void>>(async () => undefined);
let mockWorkspacePermissions: PermissionRequest[] = [];
let mockWorkspaceActive = false;
let mockWorkspaceNeedsAttention = false;
let mockWorkspaceDirectory = "/workspace";
let mockAttentionFreshness: "current" | "reconciling" | "stale" = "current";
let mockAttentionCompleteness: "complete" | "incomplete" = "complete";
const mockSessionNow = Date.now();
let mockWorkingCount = 0;
let mockAttentionOwner: string | undefined;
let mockHasNextSessionPage = false;
let mockSessionsFetchingNextPage = false;
let mockSessionsError = false;
let mockRuntimeStatus: "connected" | "reconnecting" = "connected";
let mockFollowedProjectIds = ["project-1"];
let mockEmptyInbox = false;
let mockArchivedCount = 0;
let mockRowCount = 120;
let mockFinishedStatus: "done" | "failed" | "ready" = "ready";
let mockWorkingExpanded = true;
let mockArchivedExpanded = true;
const mockArchiveSession = jest.fn(async (..._args: unknown[]) => undefined);
const mockSetSectionExpanded = jest.fn((section: "archived" | "working", expanded: boolean) => {
  if (section === "archived") mockArchivedExpanded = expanded;
  else mockWorkingExpanded = expanded;
});
const mockMarkViewed = jest.fn(async (..._args: unknown[]) => undefined);
let mockSelectionProjects: unknown[] = [];
let mockPullRequestFilter: { projectID?: string; status: string } = { status: "all" };
const mockSetPullRequestFilter = jest.fn();
const mockListPullRequests = jest.fn(async (..._args: unknown[]) => ({
  pullRequests: [] as unknown[],
  status: "listed",
}));
const mockFetchNextSessionPage = jest.fn(async () => undefined);
afterEach(() => {
  mockWorkspaceActive = false;
  mockWorkspaceNeedsAttention = false;
  mockWorkspaceDirectory = "/workspace";
  mockAttentionFreshness = "current";
  mockAttentionCompleteness = "complete";
  mockWorkspacePermissions = [];
  mockWorkingCount = 0;
  mockAttentionOwner = undefined;
  mockHasNextSessionPage = false;
  mockSessionsFetchingNextPage = false;
  mockSessionsError = false;
  mockRuntimeStatus = "connected";
  mockFollowedProjectIds = ["project-1"];
  mockEmptyInbox = false;
  mockArchivedCount = 0;
  mockRowCount = 120;
  mockFinishedStatus = "ready";
  mockWorkingExpanded = true;
  mockArchivedExpanded = true;
  mockArchiveSession.mockClear();
  mockSetSectionExpanded.mockClear();
  mockMarkViewed.mockClear();
  mockSelectionProjects = [];
  mockListPullRequests.mockClear();
  mockPullRequestFilter = { status: "all" };
  mockSetPullRequestFilter.mockClear();
});
function mockWorkspaceRow(index: number) {
  const session = {
    cost: 0,
    id: `ses_${index}`,
    location: { directory: mockWorkspaceDirectory },
    projectID: "project-1",
    time: {
      created: mockSessionNow - index,
      idle: mockSessionNow - index,
      updated: mockSessionNow - index,
    },
    title: `Session ${index}`,
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  };
  const attentionCount = mockWorkspaceNeedsAttention && index === 0 ? 1 : 0;
  const active = mockWorkspaceActive || index < mockWorkingCount;
  const targetSessionID =
    attentionCount > 0 && mockAttentionOwner ? mockAttentionOwner : session.id;
  // The last rows are archived when a test asks for some.
  const archived = !active && attentionCount === 0 && index >= mockRowCount - mockArchivedCount;
  return {
    active,
    archived,
    attentionCount,
    projectLabel: "Workspace",
    section:
      attentionCount > 0 ? "needs-you" : active ? "working" : archived ? "archived" : "recent",
    session: archived ? { ...session, time: { ...session.time, archived: 1 } } : session,
    status: attentionCount > 0 ? "approval" : active ? "working" : mockFinishedStatus,
    targetLocation: targetSessionID === session.id ? session.location : { directory: "/child" },
    targetSessionID,
    ...(mockWorkspaceDirectory === "/workspace" ? {} : { worktreeLabel: "workspace-tree" }),
  };
}
function mockWorkspaceRows() {
  return Array.from({ length: mockRowCount }, (_, index) => mockWorkspaceRow(index));
}
const mockDraftDb = {
  getAllAsync: jest.fn(async () => []),
  getFirstAsync: jest.fn(async () => undefined),
  runAsync: jest.fn(async () => undefined),
  withExclusiveTransactionAsync: jest.fn(async (task: (txn: unknown) => Promise<void>) =>
    task(mockDraftDb),
  ),
};

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  backgroundOpenCodeSession: jest.fn(),
  cancelOpenCodeSessionInboxItem: jest.fn(),
  classifyOpenCodeError: jest.fn(() => "UNREACHABLE"),
  listOpenCodeMcpServers: jest.fn(async () => ({ data: [] })),
  createOpenCodeSession: jest.fn(),
  getDefaultOpenCodeModel: jest.fn(async () => ({ data: null, location })),
  getDefaultOpenCodeLocation: jest.fn(async () => location),
  getOpenCodeLocation: jest.fn(async () => location),
  getOpenCodeSession: jest.fn(async () => ({
    cost: 0,
    id: "ses_transcript",
    location: { directory: "/workspace" },
    projectID: "project-1",
    time: { created: 1, updated: 3 },
    title: "Transcript session",
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  })),
  getOpenCodeSessionMessage: jest.fn(),
  getOpenCodeShell: () => mockGetShell(),
  getOpenCodeShellOutput: () => mockShellOutput(),
  isShellNotFoundError: (error: unknown) =>
    (error as { _tag?: string })?._tag === "ShellNotFoundError",
  maxShellOutputBytes: 64 * 1024,
  getOpenCodeVcsDiff: jest.fn(async () => ({ data: [] })),
  getOpenCodeVcs: jest.fn(async () => ({
    data: { branch: { current: "docs/mobile-workflow-screenshots" } },
    location,
  })),
  interruptOpenCodeSession: jest.fn(),
  listActiveOpenCodeSessions: jest.fn(async () => ({})),
  listGitHubPullRequests: (...args: unknown[]) => mockListPullRequests(...args),
  listOpenCodeAgents: jest.fn(async () => ({ data: [], location })),
  listOpenCodeFormRequests: () => mockListForms(),
  listOpenCodeMessages: jest.fn(
    async (_client: unknown, _sessionID: string, input: { cursor?: string }) =>
      input.cursor
        ? {
            cursor: {},
            data: [{ id: "msg_old", text: "Older message", time: { created: 1 }, type: "user" }],
          }
        : {
            cursor: { next: "older" },
            data: [
              {
                agent: "build",
                content: [
                  { text: "Newest answer", type: "text" },
                  {
                    text: "Private reasoning",
                    time: { completed: 4, created: 3 },
                    type: "reasoning",
                  },
                  {
                    text: "Detailed reasoning\nSecond step",
                    time: { completed: 5, created: 3 },
                    type: "reasoning",
                  },
                ],
                id: "msg_assistant",
                model: { id: "model-1", providerID: "provider" },
                time: { created: 3 },
                type: "assistant",
              },
              {
                files: [
                  {
                    data: "c2VjcmV0",
                    mime: "text/plain",
                    name: "note.txt",
                    source: { type: "uri", uri: "file:///private/note.txt" },
                  },
                ],
                id: "msg_user",
                text: "Current question",
                time: { created: 2 },
                type: "user",
              },
            ],
          },
  ),
  listOpenCodeModels: jest.fn(async () => ({ data: [], location })),
  listOpenCodePermissionRequests: () => mockListPermissions(),
  listOpenCodeProjects: jest.fn(async () => [
    {
      canonical: "/workspace",
      id: "project-1",
      sandboxes: [],
      time: { created: 1, updated: 1 },
    },
  ]),
  listOpenCodeSessions: jest.fn(async () => ({
    cursor: {},
    data: Array.from({ length: 120 }, (_, index) => ({
      cost: 0,
      id: `ses_${index}`,
      location: { directory: "/workspace" },
      projectID: "project-1",
      outcome: "succeeded",
      time: { created: mockSessionNow - index, updated: mockSessionNow - index },
      title: `Session ${index}`,
      tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
    })),
  })),
  listOpenCodeSessionInbox: jest.fn(async () => []),
  markOpenCodeSessionViewed: (...args: unknown[]) => mockMarkViewed(...args),
  promptOpenCodeSession: jest.fn(),
  queueOpenCodeSessionInboxItem: jest.fn(),
  removeOpenCodeSession: jest.fn(),
  steerOpenCodeSessionInboxItem: jest.fn(),
  switchOpenCodeSessionAgent: jest.fn(),
  switchOpenCodeSessionModel: jest.fn(),
  renameOpenCodeSession: jest.fn(async () => undefined),
  waitForOpenCodeSession: jest.fn(),
}));
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDraftDb }));
jest.mock("../connections/connections-context", () => ({
  useConnections: () => ({
    profiles: [{ id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  }),
}));
jest.mock("../security/app-lock-context", () => ({
  useAppLock: () => ({ enabled: false, setEnabled: jest.fn() }),
}));
jest.mock("../state/connection-runtime-context", () => ({
  useConnectionRuntime: () => ({
    connectionId: "connection-1",
    reconnectAttempt: 0,
    restClient: {},
    status: mockRuntimeStatus,
  }),
}));
jest.mock("../state/workspace-selection-context", () => ({
  WorkspaceSelectionProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspaceSelection: () => ({
    attentionCoverage: {
      completeness: mockAttentionCompleteness,
      freshness: mockAttentionFreshness,
      failedLocationCount: 0,
      knownLocationCount: 1,
      reasons: [],
      reconciledLocationCount: 1,
      revision: 1,
    },
    blockedSessionIds: new Set(mockWorkspacePermissions.map((request) => request.sessionID)),
    fetchNextPage: mockFetchNextSessionPage,
    followedProjectIds: mockFollowedProjectIds,
    formLocations: new Map(),
    forms: [],
    hasNextPage: mockHasNextSessionPage,
    sessionsFetchingNextPage: mockSessionsFetchingNextPage,
    archiveSession: mockArchiveSession,
    archivedExpanded: mockArchivedExpanded,
    inbox: {
      archived: mockEmptyInbox
        ? []
        : mockWorkspaceRows().filter((row) => row.section === "archived"),
      needsYou: mockWorkspaceNeedsAttention ? [mockWorkspaceRow(0)] : [],
      recent: mockEmptyInbox ? [] : mockWorkspaceRows().filter((row) => row.section === "recent"),
      unmatchedSessionIDs: [],
      working: mockWorkspaceActive
        ? mockWorkspaceRows()
        : mockWorkspaceRows().filter((row) => row.section === "working"),
    },
    interactionsError: false,
    interactionsLoading: false,
    pendingCount: mockWorkspaceNeedsAttention ? 1 : mockWorkspacePermissions.length,
    permissions: mockWorkspacePermissions,
    preferencesLoading: false,
    preferencesSaving: false,
    projects: mockSelectionProjects,
    projectsError: false,
    projectsLoading: false,
    refetch: mockWorkspaceRefetch,
    replyPermission: mockReplyPermission,
    search: "",
    sessionsError: mockSessionsError,
    sessionsLoading: false,
    setFollowedProjectIds: jest.fn(async () => undefined),
    setLocation: mockSetLocation,
    setSearch: jest.fn(),
    setSectionExpanded: mockSetSectionExpanded,
    unavailableProjectIds: [],
    workingExpanded: mockWorkingExpanded,
  }),
}));
jest.mock("../state/use-pull-request-filter", () => ({
  usePullRequestFilter: () => ({
    error: false,
    filter: mockPullRequestFilter,
    loaded: true,
    setFilter: mockSetPullRequestFilter,
  }),
}));
jest.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
}));
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("react-native-keyboard-controller", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    KeyboardStickyView: ({ children, ...props }: { children: ReactNode }) =>
      React.createElement(View, { ...props, testID: "keyboard-sticky-view" }, children),
  };
});

const mockGetSession = jest.mocked(getOpenCodeSession);
const mockGetLocation = jest.mocked(getOpenCodeLocation);
const mockListAgents = jest.mocked(listOpenCodeAgents);
const mockListMessages = jest.mocked(listOpenCodeMessages);

test("shows a muted sent prompt before transcript projection and replaces it by stable ID", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const scope = { directory: "/workspace" };
  const id = "msg_pending_preview";
  queryClient.setQueryData(
    openCodeQueryKeys.promptAdmissions("connection-1", scope, "ses_transcript"),
    [
      {
        id,
        kind: "prompt",
        durable: true,
        status: "steered",
        submittedAtMs: 1,
        previewText: "Pending follow-up",
      },
    ],
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "pending-session",
          name: "Session",
          params: { connectionId: "connection-1", location: scope, sessionID: "ses_transcript" },
        }}
      />
    </QueryClientProvider>,
  );
  await screen.findByText("Pending follow-up");
  let pendingText = screen.getByText("Pending follow-up");
  while (!pendingText.props.selectable && pendingText.parent) pendingText = pendingText.parent;
  expect(pendingText).toHaveStyle({ ...typography.chatBody, color: palette.dim });
  expect(screen.getByText("Sent · waiting for transcript")).toBeOnTheScreen();
  // Exercise a later authoritative REST snapshot, and await its notifications.
  await screen.findByText("Newest answer");
  mockListMessages.mockResolvedValueOnce({
    cursor: {},
    data: [{ id, type: "user", text: "Pending follow-up", time: { created: 1 } }],
  });
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: openCodeQueryKeys.messages("connection-1", scope, "ses_transcript", {
        limit: 40,
        order: "desc",
      }),
    });
    // React Query defers observer notifications to a zero-delay timer. Keep act
    // open through that timer so React commits the snapshot before assertions.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(screen.queryByText("Sent · waiting for transcript")).toBeNull());
  expect(screen.getAllByText("Pending follow-up")).toHaveLength(1);
  let deliveredText = screen.getByText("Pending follow-up");
  while (!deliveredText.props.selectable && deliveredText.parent)
    deliveredText = deliveredText.parent;
  expect(deliveredText).toHaveStyle({ ...typography.chatBody, color: palette.ink });
  view.unmount();
});

test("the top session menu owns dev tools and the second row has no overflow control", async () => {
  const setOptions =
    jest.fn<(options: { title?: string; headerRight?: () => ReactNode }) => void>();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions } as never}
        route={{
          key: "top-menu",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(setOptions).toHaveBeenCalledWith({ title: "Transcript session" }));
    expect(screen.queryByRole("button", { name: "Location options" })).toBeNull();
    const renderHeader = setOptions.mock.calls
      .map(([options]) => options.headerRight)
      .filter(Boolean)
      .at(-1);
    const headerButton = renderHeader?.() as ReactElement<{ onPress: () => void }>;
    act(() => headerButton.props.onPress());
    fireEvent.press(screen.getByRole("button", { name: "Dev tools" }));
    expect(
      await screen.findByText("No MCP servers configured for this location."),
    ).toBeOnTheScreen();
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test("updates the navigation title when the server session name changes", async () => {
  const setOptions = jest.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions } as never}
        route={{
          key: "title-session",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(setOptions).toHaveBeenCalledWith({ title: "Transcript session" }));
  const key = openCodeQueryKeys.session(
    "connection-1",
    { directory: "/workspace" },
    "ses_transcript",
  );
  act(() =>
    queryClient.setQueryData<SessionInfo>(key, (session) =>
      session ? { ...session, title: "Renamed session" } : session,
    ),
  );
  await waitFor(() => expect(setOptions).toHaveBeenLastCalledWith({ title: "Renamed session" }));
  act(() =>
    queryClient.setQueryData<SessionInfo>(key, (session) =>
      session ? { ...session, title: " " } : session,
    ),
  );
  await waitFor(() => expect(setOptions).toHaveBeenLastCalledWith({ title: "Untitled session" }));
  fireEvent.press(screen.getByRole("tab", { name: "Changes" }));
  expect(await screen.findByText("No changes")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Prompt")).toBeNull();
  fireEvent.press(screen.getByRole("tab", { name: "Session" }));
  expect(screen.getByLabelText("Prompt")).toBeOnTheScreen();
  view.unmount();
  queryClient.clear();
});

test("moves only the Android composer dock with the keyboard", async () => {
  const platformOS = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "session-android-keyboard",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );

  try {
    await screen.findByLabelText("Keyboard composer dock");
    expect(screen.getByTestId("keyboard-sticky-view")).toBeOnTheScreen();
    expect(screen.getByLabelText("Keyboard-aware session")).toBeOnTheScreen();
  } finally {
    view.unmount();
    queryClient.clear();
    Object.defineProperty(Platform, "OS", { configurable: true, value: platformOS });
  }
});

test("the single composer Stop interrupts the owning session", async () => {
  jest.mocked(interruptOpenCodeSession).mockClear();
  const queryClient = new QueryClient({
    // Mutation observers can schedule cache collection after unmount. Tests own cleanup.
    defaultOptions: {
      mutations: { gcTime: Infinity },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "session-stop",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  try {
    await screen.findByText("Newest answer");
    act(() =>
      queryClient.setQueryData(openCodeQueryKeys.activeSessions("connection-1"), {
        ses_transcript: { type: "running" },
      }),
    );
    const stop = await screen.findByRole("button", { name: "Stop" });
    expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1);
    expect(
      within(screen.getByLabelText("Session composer")).getByRole("button", { name: "Stop" }),
    ).toBeOnTheScreen();
    fireEvent.press(stop);
    await waitFor(() =>
      expect(interruptOpenCodeSession).toHaveBeenCalledWith(
        expect.anything(),
        "ses_transcript",
        false,
        { signal: expect.anything() },
      ),
    );
    await waitFor(() => {
      expect(queryClient.isMutating()).toBe(0);
      expect(queryClient.isFetching()).toBe(0);
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    });
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test("shows a permission blocking the open session and can reply", async () => {
  mockWorkspacePermissions = [
    {
      action: "shell",
      id: "per_test",
      resources: ["pnpm test"],
      sessionID: "ses_transcript",
    },
  ];
  mockReplyPermission.mockClear();
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "session-permission",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );

  try {
    expect(await screen.findByText("Run shell command")).toBeOnTheScreen();
    expect(screen.getByLabelText("Keyboard composer dock")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Allow once" }));
    expect(mockReplyPermission).toHaveBeenCalledWith("per_test", "ses_transcript", "once");
  } finally {
    mockWorkspacePermissions = [];
    view.unmount();
    queryClient.clear();
  }
});

test("attention rows own requests, with a shortcut only when search hides them", async () => {
  mockWorkspaceNeedsAttention = true;
  const navigate = jest.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>,
  );
  try {
    expect(await screen.findByText("Approval")).toBeOnTheScreen();
    expect(screen.getByTestId("session-row-status-approval")).toHaveStyle({
      color: palette.warm,
    });
    // Rows that need attention lead the list without a header.
    expect(screen.queryByRole("header", { name: /^Needs attention/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "1 known request" })).toBeNull();
    expect(screen.queryByText("Needs you 1")).toBeNull();
    openSearch("Session");
    expect(await screen.findByText("Needs you 1")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Clear session search" }));
    await waitFor(() => expect(screen.queryByText("Needs you 1")).toBeNull());
    fireEvent.changeText(screen.getByLabelText("Search sessions"), "Session");
    fireEvent.press(await screen.findByRole("button", { name: "1 known request" }));
    // The shortcut closes search and opens the Approvals tab in place.
    expect(screen.queryByLabelText("Search sessions")).toBeNull();
    expect(screen.getByRole("tab", { name: "Approvals" })).toBeSelected();
    expect(navigate).not.toHaveBeenCalledWith("Pending");
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test.each([
  ["stale", "complete", "Request status is stale. Reconnect to check pending requests."],
  ["current", "incomplete", "Some request locations could not be checked."],
] satisfies ["current" | "reconciling" | "stale", "complete" | "incomplete", string][])(
  "keeps %s attention coverage explicit",
  async (freshness, completeness, copy) => {
    mockAttentionFreshness = freshness;
    mockAttentionCompleteness = completeness;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceScreen
          navigation={{ navigate: jest.fn() } as never}
          route={{ key: "workspace", name: "Workspace" } as never}
        />
      </QueryClientProvider>,
    );
    try {
      expect(await screen.findByText(copy, {}, { timeout: 2000 })).toBeOnTheScreen();
    } finally {
      view.unmount();
      queryClient.clear();
    }
  },
);

function openSearch(text: string) {
  fireEvent.press(screen.getByRole("button", { name: "Search sessions" }));
  fireEvent.changeText(screen.getByLabelText("Search sessions"), text);
}

function renderWorkspace(navigate = jest.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>,
  );
  return {
    cleanup() {
      view.unmount();
      queryClient.clear();
    },
  };
}

test("the bottom menu keeps New session apart and switches between Chat, PRs, and Approvals", async () => {
  mockSelectionProjects = [
    { canonical: "/workspace", id: "project-1", name: "App", sandboxes: [], time: { created: 1 } },
  ];
  mockListPullRequests.mockResolvedValueOnce({
    pullRequests: [
      {
        author: "octocat",
        branch: "feature/menu",
        draft: false,
        number: 42,
        reviewDecision: "APPROVED",
        title: "Add the session menu",
        url: "https://github.com/acme/app/pull/42",
      },
    ],
    status: "listed",
  });
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const navigate = jest.fn();
  const view = renderWorkspace(navigate);
  try {
    await screen.findByText("Session 0");
    expect(screen.getAllByRole("tab").map((tab) => tab.props.accessibilityLabel)).toEqual([
      "Chat",
      "PRs",
      "Approvals",
    ]);
    expect(screen.getByRole("tab", { name: "Chat" })).toBeSelected();
    fireEvent.press(screen.getByRole("button", { name: "New session" }));
    expect(navigate).toHaveBeenCalledWith("NewSession");
    // PR checks run a command on the server, so none start before the tab opens.
    expect(mockListPullRequests).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole("tab", { name: "PRs" }));
    expect(await screen.findByText("Add the session menu")).toBeOnTheScreen();
    expect(mockListPullRequests).toHaveBeenCalledWith(
      expect.anything(),
      { directory: "/workspace" },
      { signal: expect.anything() },
    );
    expect(screen.getByText("#42 · feature/menu · octocat")).toBeOnTheScreen();
    expect(screen.getByText("Approved")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Search sessions" })).toBeNull();
    fireEvent.press(screen.getByRole("link", { name: /^Pull request 42, Add the session menu/ }));
    expect(open).toHaveBeenCalledWith("https://github.com/acme/app/pull/42");

    fireEvent.press(screen.getByRole("tab", { name: "Approvals" }));
    expect(await screen.findByText("Nothing needs you")).toBeOnTheScreen();
    expect(screen.queryByText("Add the session menu")).toBeNull();

    fireEvent.press(screen.getByRole("tab", { name: "Chat" }));
    expect(screen.getByText("Session 0")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Search sessions" })).toBeOnTheScreen();
  } finally {
    open.mockRestore();
    view.cleanup();
  }
});

test.each([
  ["gh-missing", "GitHub CLI (gh) is not installed on the server."],
  ["no-github-remote", "This project has no GitHub repository."],
] satisfies [string, string][])("the PRs tab explains %s per project", async (reason, copy) => {
  mockSelectionProjects = [
    { canonical: "/workspace", id: "project-1", sandboxes: [], time: { created: 1 } },
  ];
  mockListPullRequests.mockResolvedValueOnce({ reason, status: "unavailable" } as never);
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    fireEvent.press(screen.getByRole("tab", { name: "PRs" }));
    expect(await screen.findByText(copy)).toBeOnTheScreen();
  } finally {
    view.cleanup();
  }
});

const filterPullRequests = [
  {
    branch: "feature/ready",
    draft: false,
    number: 42,
    reviewDecision: "REVIEW_REQUIRED",
    title: "Ready change",
    url: "https://github.com/acme/other/pull/42",
  },
  {
    branch: "feature/draft",
    draft: true,
    number: 7,
    title: "Draft change",
    url: "https://github.com/acme/other/pull/7",
  },
];

test("saved PR filters narrow the list, and only the chosen project is checked", async () => {
  mockFollowedProjectIds = ["project-1", "project-2"];
  mockSelectionProjects = [
    { canonical: "/workspace", id: "project-1", name: "App", sandboxes: [], time: { created: 1 } },
    { canonical: "/other", id: "project-2", name: "Other", sandboxes: [], time: { created: 1 } },
  ];
  mockPullRequestFilter = { projectID: "project-2", status: "draft" };
  mockListPullRequests.mockResolvedValueOnce({
    pullRequests: filterPullRequests,
    status: "listed",
  });
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    fireEvent.press(screen.getByRole("tab", { name: "PRs" }));
    expect(await screen.findByText("Draft change")).toBeOnTheScreen();
    expect(screen.queryByText("Ready change")).toBeNull();
    expect(mockListPullRequests).toHaveBeenCalledTimes(1);
    expect(mockListPullRequests).toHaveBeenCalledWith(
      expect.anything(),
      { directory: "/other" },
      { signal: expect.anything() },
    );
    expect(screen.getByRole("button", { name: "Status filter, Draft" })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Status filter, Draft" }));
    fireEvent.press(screen.getByRole("radio", { name: "Review required" }));
    expect(mockSetPullRequestFilter).toHaveBeenLastCalledWith({
      projectID: "project-2",
      status: "review-required",
    });

    fireEvent.press(screen.getByRole("button", { name: "Project filter, Other" }));
    // The chip's text also reads "Other", so pick the selected sheet option.
    expect(screen.getByRole("radio", { name: "Other", checked: true })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("radio", { name: "All projects" }));
    expect(mockSetPullRequestFilter).toHaveBeenLastCalledWith({ status: "draft" });
  } finally {
    view.cleanup();
  }
});

test("a status with no matches offers to show all statuses", async () => {
  mockSelectionProjects = [
    { canonical: "/workspace", id: "project-1", name: "App", sandboxes: [], time: { created: 1 } },
  ];
  mockPullRequestFilter = { status: "approved" };
  mockListPullRequests.mockResolvedValueOnce({
    pullRequests: filterPullRequests,
    status: "listed",
  });
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    fireEvent.press(screen.getByRole("tab", { name: "PRs" }));
    expect(await screen.findByText("No open pull requests match this status.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Show all statuses" }));
    expect(mockSetPullRequestFilter).toHaveBeenLastCalledWith({ status: "all" });
  } finally {
    view.cleanup();
  }
});

test("Android back returns from another tab to Chat before leaving", async () => {
  const handlers: Array<() => boolean | null | undefined> = [];
  const add = jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, handler) => {
    handlers.push(handler);
    return {
      remove: () => {
        handlers.splice(handlers.indexOf(handler), 1);
      },
    };
  });
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    expect(handlers).toHaveLength(0);
    fireEvent.press(screen.getByRole("tab", { name: "Approvals" }));
    expect(handlers).toHaveLength(1);
    let handled: boolean | null | undefined;
    act(() => {
      handled = handlers[0]?.();
    });
    expect(handled).toBe(true);
    expect(screen.getByRole("tab", { name: "Chat" })).toBeSelected();
    expect(handlers).toHaveLength(0);
  } finally {
    view.cleanup();
    add.mockRestore();
  }
});

test("with no followed projects, offers Choose projects and New session", async () => {
  mockFollowedProjectIds = [];
  mockEmptyInbox = true;
  const navigate = jest.fn();
  const view = renderWorkspace(navigate);
  try {
    expect(
      await screen.findByRole("header", { name: "No projects followed yet" }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(/Sessions from the projects you follow show up here/),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Choose projects" }));
    expect(navigate).toHaveBeenCalledWith("FollowedProjects");
    fireEvent.press(screen.getByRole("button", { name: "New session" }));
    expect(navigate).toHaveBeenCalledWith("NewSession");
  } finally {
    view.cleanup();
  }
});

test("a session load failure offers Retry and announces the error on iOS", async () => {
  mockSessionsError = true;
  mockEmptyInbox = true;
  mockWorkspaceRefetch.mockClear();
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  const view = renderWorkspace();
  try {
    expect(await screen.findByText("Sessions could not be loaded.")).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith("Sessions could not be loaded.");
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockWorkspaceRefetch).toHaveBeenCalledTimes(1));
  } finally {
    announce.mockRestore();
    view.cleanup();
  }
});

test("incomplete request coverage offers Retry", async () => {
  mockAttentionCompleteness = "incomplete";
  mockWorkspaceRefetch.mockClear();
  const view = renderWorkspace();
  try {
    await screen.findByText("Some request locations could not be checked.", {}, { timeout: 2000 });
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockWorkspaceRefetch).toHaveBeenCalledTimes(1));
  } finally {
    view.cleanup();
  }
});

test("rows and the delete prompt use readable names without section headers", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    expect(screen.queryByRole("header")).toBeNull();
    expect(screen.queryByText("Recent")).toBeNull();
    const row = screen.getByRole("button", {
      name: "Open session Session 0. Workspace. Updated just now",
    });
    fireEvent(row, "accessibilityAction", { nativeEvent: { actionName: "delete" } });
    expect(alert).toHaveBeenCalledWith(
      "Delete session?",
      expect.stringContaining("Project: Workspace\n"),
      expect.anything(),
    );
    expect(alert.mock.calls[0]?.[1]).not.toContain("project-1");
  } finally {
    alert.mockRestore();
    view.cleanup();
  }
});

test("brief request reconciliation and history fetches do not flash banners or footers", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const content = () => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>
  );
  const view = render(content());
  await screen.findByText("Session 0");
  const footer = () => screen.UNSAFE_getByType(FlatList).props.ListFooterComponent;
  jest.useFakeTimers();
  try {
    mockAttentionFreshness = "reconciling";
    mockSessionsFetchingNextPage = true;
    mockRuntimeStatus = "reconnecting";
    view.rerender(content());
    expect(screen.queryByText("Checking request status. More sessions may need you.")).toBeNull();
    expect(screen.queryByLabelText("Checking older session history")).toBeNull();
    expect(screen.queryByText("Waiting for current server data.")).toBeNull();
    expect(footer()).toBeNull();
    expect(screen.queryByLabelText("Loading sessions")).toBeNull();
    act(() => jest.advanceTimersByTime(500));
    mockAttentionFreshness = "current";
    mockSessionsFetchingNextPage = false;
    mockRuntimeStatus = "connected";
    view.rerender(content());
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByText("Checking request status. More sessions may need you.")).toBeNull();
    expect(screen.queryByLabelText("Checking older session history")).toBeNull();
    mockAttentionFreshness = "reconciling";
    mockSessionsFetchingNextPage = true;
    mockRuntimeStatus = "reconnecting";
    view.rerender(content());
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByText("Checking request status. More sessions may need you.")).toBeNull();
    expect(screen.queryByLabelText("Checking older session history")).toBeNull();
    expect(footer()).toBeNull();
    expect(screen.queryByLabelText("Loading sessions")).toBeNull();
    expect(screen.getByText("Waiting for current server data.")).toBeOnTheScreen();
  } finally {
    view.unmount();
    queryClient.clear();
    jest.useRealTimers();
  }
});

test("long pressing a session opens grouped management actions", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>,
  );
  try {
    await screen.findByText("Session 0");
    fireEvent(screen.getByRole("button", { name: /^Session 0/ }), "longPress");
    expect(await screen.findByRole("button", { name: "Rename" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Archive" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Delete" })).toBeOnTheScreen();
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

function sessionKeys(view: ReturnType<typeof render>) {
  return view.UNSAFE_getByType(FlatList).props.data.map((item: { key: string }) => item.key);
}

test("lists every Recent row with no paging, then Archived under its own header", async () => {
  mockArchivedCount = 2;
  mockHasNextSessionPage = true;
  mockFetchNextSessionPage.mockClear();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>,
  );
  try {
    await screen.findByText("Session 0");
    expect(sessionKeys(view)).toEqual([
      ...Array.from({ length: 118 }, (_, index) => `ses_${index}`),
      "header:archived",
      "ses_118",
      "ses_119",
    ]);
    expect(screen.queryByRole("header", { name: "Recent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load older sessions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more results" })).toBeNull();
    expect(mockFetchNextSessionPage).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test("the Archived section collapses and expands, and stores it", async () => {
  mockRowCount = 4;
  mockArchivedCount = 2;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const content = () => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>
  );
  const view = render(content());
  try {
    await screen.findByText("Session 0");
    expect(sessionKeys(view)).toEqual(["ses_0", "ses_1", "header:archived", "ses_2", "ses_3"]);
    const toggle = screen.getByRole("button", { name: "Archived, 2 sessions" });
    expect(toggle).toBeExpanded();
    expect(toggle).toHaveProp("accessibilityHint", "Hides archived sessions");
    fireEvent.press(toggle);
    expect(mockSetSectionExpanded).toHaveBeenCalledWith("archived", false);

    // Collapsed, Archived keeps its header and count and drops its rows.
    view.rerender(content());
    expect(sessionKeys(view)).toEqual(["ses_0", "ses_1", "header:archived"]);
    expect(screen.getByRole("button", { name: "Archived, 2 sessions" })).toBeCollapsed();
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test("lists Needs attention and Recent without headers, then Working above Archived", async () => {
  mockWorkspaceNeedsAttention = true;
  mockWorkingCount = 3;
  mockArchivedCount = 2;
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.data.map((item: { key: string }) => item.key)).toEqual([
      "ses_0",
      ...Array.from({ length: 115 }, (_, index) => `ses_${index + 3}`),
      "header:working",
      "ses_1",
      "ses_2",
      "header:archived",
      "ses_118",
      "ses_119",
    ]);
    expect(screen.queryByRole("header", { name: /^Needs attention/ })).toBeNull();
    expect(screen.queryByRole("header", { name: "Recent" })).toBeNull();
    // Working is part of the list, so nothing reserves space for it below.
    expect(list.props.ListFooterComponentStyle).toBeUndefined();
  } finally {
    view.cleanup();
  }
});

test("every working session sits under Working, and the idle state points to it", async () => {
  mockWorkspaceActive = true;
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    const data = screen.UNSAFE_getByType(FlatList).props.data as { key: string }[];
    expect(data[0]).toMatchObject({ count: 120, key: "header:working", section: "working" });
    expect(data).toHaveLength(121);
    // The idle state sits above Working when nothing else is in the list.
    expect(screen.getByRole("header", { name: "Nothing needs you right now" })).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Sessions show up here when they're new, need your answer, or finish a run. Running sessions are under Working.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Working, 120 sessions" })).toBeExpanded();
    expect(
      screen.getByRole("button", { name: /^Open session Session 0\. Workspace\. Working\./ }),
    ).toBeOnTheScreen();
  } finally {
    view.cleanup();
  }
});

test("an empty inbox says where sessions will appear, with no Working section", async () => {
  mockEmptyInbox = true;
  const view = renderWorkspace();
  try {
    expect(await screen.findByText("Nothing needs you right now")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Sessions show up here when they're new, need your answer, or finish a run. Start one with New session.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("working-section-toggle")).toBeNull();
  } finally {
    view.cleanup();
  }
});

test("a row whose child needs input opens the owning child session", async () => {
  mockWorkspaceNeedsAttention = true;
  mockAttentionOwner = "ses_child";
  const navigate = jest.fn();
  const view = renderWorkspace(navigate);
  try {
    const row = await screen.findByRole("button", {
      name: /^Open session Session 0\. Workspace\. Approval\./,
    });
    expect(screen.queryByText("ses_child")).toBeNull();
    fireEvent.press(row);
    expect(navigate).toHaveBeenCalledWith("Session", {
      connectionId: "connection-1",
      location: { directory: "/child" },
      sessionID: "ses_child",
    });
  } finally {
    view.cleanup();
  }
});

test("rows in a live checkout show its branch under the title", async () => {
  mockWorkspaceActive = true;
  mockSelectionProjects = [
    { canonical: "/workspace", id: "project-1", sandboxes: [], time: { created: 1, updated: 1 } },
  ];
  jest.mocked(getOpenCodeVcs).mockClear();
  const view = renderWorkspace();
  try {
    const row = within(
      await screen.findByRole("button", {
        name: /^Open session Session 0\. Workspace\. Branch docs\/mobile-workflow-screenshots\./,
      }),
    );
    expect(row.getByText("Workspace")).toBeOnTheScreen();
    expect(row.getByText("docs/mobile-workflow-screenshots")).toBeOnTheScreen();
    expect(
      row.UNSAFE_queryAllByType(Feather).filter((icon) => icon.props.name === "git-branch"),
    ).toHaveLength(1);
    // Every row shares the location, so its branch loads once.
    expect(getOpenCodeVcs).toHaveBeenCalledTimes(1);
    expect(getOpenCodeVcs).toHaveBeenCalledWith({}, { directory: "/workspace" }, expect.anything());
  } finally {
    view.cleanup();
  }
});

test("rows outside a live checkout show the worktree name without reading it", async () => {
  mockWorkspaceDirectory = "/workspace-tree";
  mockWorkspaceActive = true;
  mockSelectionProjects = [
    { canonical: "/workspace", id: "project-1", sandboxes: [], time: { created: 1, updated: 1 } },
  ];
  jest.mocked(getOpenCodeVcs).mockClear();
  const view = renderWorkspace();
  try {
    const row = within(
      await screen.findByRole("button", {
        name: /^Open session Session 0\. Workspace\. Worktree workspace-tree\. Working\./,
      }),
    );
    expect(row.getByText("workspace-tree")).toBeOnTheScreen();
    expect(row.queryByText("docs/mobile-workflow-screenshots")).toBeNull();
    expect(row.queryByText(/background task/)).toBeNull();
    // Reading VCS would initialize a directory the project no longer lists.
    expect(getOpenCodeVcs).not.toHaveBeenCalled();
  } finally {
    view.cleanup();
  }
});

test("search shows a flat list and pages with Load more results", async () => {
  mockWorkspaceNeedsAttention = true;
  mockWorkingCount = 3;
  mockHasNextSessionPage = true;
  mockFetchNextSessionPage.mockClear();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>,
  );
  try {
    await screen.findByText("Session 0");
    openSearch("Session");
    await waitFor(() => expect(screen.getByText("Search results")).toBeOnTheScreen());
    expect(sessionKeys(view)).toEqual(Array.from({ length: 120 }, (_, index) => `ses_${index}`));
    expect(screen.queryByTestId(/^session-list-group-/)).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Load more results" }));
    expect(mockFetchNextSessionPage).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test("publishes an unchanged resolved location only once", async () => {
  const errors: unknown[][] = [];
  const consoleError = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSelectionProvider>
        <WorkspaceScreen
          navigation={{ navigate: jest.fn() } as never}
          route={{ key: "workspace", name: "Workspace" } as never}
        />
      </WorkspaceSelectionProvider>
    </QueryClientProvider>,
  );

  await screen.findByText("Session 0");
  const publicationsBeforeRerender = mockSetLocation.mock.calls.length;
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSelectionProvider>
        <WorkspaceScreen
          navigation={{ navigate: jest.fn() } as never}
          route={{ key: "workspace", name: "Workspace" } as never}
        />
      </WorkspaceSelectionProvider>
    </QueryClientProvider>,
  );
  expect(mockSetLocation).toHaveBeenCalledTimes(publicationsBeforeRerender);
  expect(
    errors.some((args) => args.some((value) => String(value).includes("Maximum update depth"))),
  ).toBe(false);

  view.unmount();
  queryClient.clear();
  consoleError.mockRestore();
});

test("shows pull-to-refresh chrome only for a user refresh", async () => {
  mockWorkspaceRefetch.mockReset();
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  let resolveUserRefresh: (() => void) | undefined;
  mockWorkspaceRefetch.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveUserRefresh = resolve;
      }),
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSelectionProvider>
        <WorkspaceScreen
          navigation={{ navigate: jest.fn() } as never}
          route={{ key: "workspace", name: "Workspace" } as never}
        />
      </WorkspaceSelectionProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("Session 0");
  expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  fireEvent(screen.UNSAFE_getByType(RefreshControl), "refresh");
  await waitFor(() => expect(mockWorkspaceRefetch).toHaveBeenCalledTimes(1));
  expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);

  await act(async () => resolveUserRefresh?.());
  await waitFor(() => expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false));
  view.unmount();
  queryClient.clear();
});

test("keeps session-list chrome stable during background location updates", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const locationKey = openCodeQueryKeys.location("connection-1", {
    directory: "/workspace",
  });
  queryClient.setQueryData(locationKey, location);
  let resolveLocation: ((value: typeof location) => void) | undefined;
  mockGetLocation.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveLocation = resolve;
      }),
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSelectionProvider>
        <WorkspaceScreen
          navigation={{ navigate: jest.fn() } as never}
          route={{ key: "workspace", name: "Workspace" } as never}
        />
      </WorkspaceSelectionProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("Session 0");
  await waitFor(() => expect(queryClient.getQueryState(locationKey)?.fetchStatus).toBe("fetching"));

  expect(screen.getByLabelText("Search sessions")).toBeOnTheScreen();
  expect(screen.queryByLabelText(/Change new session location/)).toBeNull();
  expect(screen.UNSAFE_getByType(FlatList).props.maintainVisibleContentPosition).toBeUndefined();

  await act(async () => resolveLocation?.(location));
  view.unmount();
  queryClient.clear();
});

test("keeps connection management and new-session controls out of the phone list body", async () => {
  const navigation = { navigate: jest.fn() };
  mockWorkspaceRefetch.mockClear();
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { gcTime: Infinity, networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSelectionProvider>
        <WorkspaceScreen
          navigation={navigation as never}
          route={{ key: "workspace", name: "Workspace" } as never}
        />
      </WorkspaceSelectionProvider>
    </QueryClientProvider>,
  );

  await screen.findByText("Session 0");
  expect(screen.queryByRole("header", { name: "Sessions" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
  expect(screen.queryByLabelText(/Change new session location/)).toBeNull();
  expect(screen.queryByLabelText("Session list")).toBeNull();
  expect(screen.queryByRole("radio")).toBeNull();
  const list = screen.UNSAFE_getByType(FlatList);
  expect(list.props.data.filter((item: { type: string }) => item.type === "session")).toHaveLength(
    120,
  );
  expect(screen.queryByPlaceholderText("Search all sessions")).toBeNull();
  expect(screen.queryByText("120")).toBeNull();
  expect(screen.queryByRole("button", { name: "Load older sessions" })).toBeNull();
  openSearch("Session");
  await waitFor(() => expect(screen.getByText("Search results")).toBeOnTheScreen());
  expect(list.props.data.filter((item: { type: string }) => item.type === "session")).toHaveLength(
    120,
  );
  fireEvent.press(screen.getByRole("button", { name: "Clear session search" }));
  await waitFor(() => expect(screen.queryByText("Search results")).toBeNull());
  expect(screen.queryByText("Succeeded")).toBeNull();

  expect(screen.queryByRole("button", { name: "New" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Manage connections/ })).toBeNull();
  expect(mockWorkspaceRefetch).not.toHaveBeenCalled();

  view.unmount();
  queryClient.clear();
});

test("shows the connection header and new-session action in the tablet shell", async () => {
  const navigate = jest.fn();
  const originalScreen = Dimensions.get("screen");
  const originalWindow = Dimensions.get("window");
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  let view: ReturnType<typeof render> | undefined;

  try {
    Dimensions.set({
      screen: { ...originalScreen, width: 760 },
      window: { ...originalWindow, width: 760 },
    });
    view = render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceSelectionProvider>
          <WorkspaceScreen
            navigation={{ navigate } as never}
            route={{ key: "workspace", name: "Workspace" } as never}
          />
        </WorkspaceSelectionProvider>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Connection Test server, connected" }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("header", { name: "Sessions" })).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "New session" }));
    expect(navigate).toHaveBeenCalledWith("NewSession");
    fireEvent.press(screen.getByRole("button", { name: "Search sessions" }));
    expect(screen.getByLabelText("Search sessions")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
  } finally {
    view?.unmount();
    queryClient.clear();
    Dimensions.set({ screen: originalScreen, window: originalWindow });
  }
});

test("the header names the connection with its status and opens Connections", async () => {
  const navigate = jest.fn();
  const view = renderWorkspace(navigate);
  try {
    const connection = await screen.findByRole("button", {
      name: "Connection Test server, connected",
    });
    expect(connection).toHaveProp("accessibilityHint", "Opens connections");
    expect(within(connection).getByText("Test server")).toHaveProp("numberOfLines", 1);
    expect(
      screen.getByTestId("workspace-connection-status", { includeHiddenElements: true }),
    ).toHaveStyle({ backgroundColor: palette.success });
    fireEvent.press(connection);
    expect(navigate).toHaveBeenCalledWith("Connections");
  } finally {
    view.cleanup();
  }
});

test("search expands over the header, and Close search clears and collapses it", async () => {
  const dismiss = jest.spyOn(Keyboard, "dismiss");
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    expect(screen.queryByPlaceholderText("Search all sessions")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Search sessions" }));
    const field = screen.getByPlaceholderText("Search all sessions");
    expect(field).toHaveProp("autoFocus", true);
    fireEvent(field, "focus");
    expect(screen.queryByRole("button", { name: /^Connection / })).toBeNull();
    expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
    fireEvent.changeText(field, "Session 4");
    await waitFor(() => expect(screen.getByText("Search results")).toBeOnTheScreen());
    fireEvent.press(screen.getByRole("button", { name: "Close search" }));
    expect(dismiss).toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Search all sessions")).toBeNull();
    expect(screen.getByRole("button", { name: "Connection Test server, connected" })).toBeTruthy();
    // The field unmounts without a blur event; the floating controls must still return.
    expect(screen.getByRole("button", { name: "New session" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Settings/ })).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText("Search results")).toBeNull());
    fireEvent.press(screen.getByRole("button", { name: "Search sessions" }));
    expect(screen.getByPlaceholderText("Search all sessions")).toHaveProp("value", "");
  } finally {
    dismiss.mockRestore();
    view.cleanup();
  }
});

test("Android back collapses an open search instead of leaving", async () => {
  const handlers: Array<() => boolean | null | undefined> = [];
  const add = jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, handler) => {
    handlers.push(handler);
    return {
      remove: () => {
        handlers.splice(handlers.indexOf(handler), 1);
      },
    };
  });
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    expect(handlers).toHaveLength(0);
    openSearch("Session");
    expect(handlers).toHaveLength(1);
    let handled: boolean | null | undefined;
    act(() => {
      handled = handlers[0]?.();
    });
    expect(handled).toBe(true);
    expect(screen.queryByPlaceholderText("Search all sessions")).toBeNull();
    expect(handlers).toHaveLength(0);
  } finally {
    add.mockRestore();
    view.cleanup();
  }
});

test("rows show the project and status above the title, as on OpenCode desktop", async () => {
  mockWorkspaceNeedsAttention = true;
  mockWorkingCount = 2;
  mockArchivedCount = 1;
  mockRowCount = 5;
  const view = renderWorkspace();
  try {
    const blocked = within(
      await screen.findByRole("button", { name: /^Open session Session 0\./ }),
    );
    const working = within(screen.getByRole("button", { name: /^Open session Session 1\./ }));
    const finished = within(screen.getByRole("button", { name: /^Open session Session 2\./ }));
    const archived = within(screen.getByRole("button", { name: /^Open session Session 4\./ }));
    for (const row of [blocked, working, finished, archived]) {
      expect(row.getByTestId("project-avatar", { includeHiddenElements: true })).toBeTruthy();
      expect(row.getByText("W", { includeHiddenElements: true })).toBeTruthy();
      expect(row.getByText("Workspace")).toBeOnTheScreen();
    }

    expect(within(blocked.getByTestId("session-row-trailing")).getByText("Approval")).toHaveStyle({
      color: palette.warm,
    });
    // An unread row stands out with a semibold title.
    expect(blocked.getByText("Session 0")).toHaveStyle({ color: palette.ink, fontWeight: "600" });

    const workingStatus = within(working.getByTestId("session-row-trailing")).getByTestId(
      "session-row-status-working",
    );
    expect(workingStatus).toHaveTextContent("Working");
    expect(workingStatus).toHaveProp("accessibilityLabel", "Working");
    expect(working.getByTestId("session-row-copy")).toHaveStyle({ opacity: 0.7 });

    // Read rows show their age and recede.
    expect(within(finished.getByTestId("session-row-trailing")).getByText("now")).toBeOnTheScreen();
    expect(finished.getByText("Session 2")).toHaveStyle({ color: palette.dim });
    expect(archived.getByTestId("session-row-copy")).toHaveStyle({ opacity: 0.5 });
    expect(
      screen.getByRole("button", { name: /^Open session Session 4\. Workspace\. Archived\./ }),
    ).toBeOnTheScreen();
  } finally {
    view.cleanup();
  }
});

test.each([
  ["done", "Done", palette.success],
  ["failed", "Failed", palette.danger],
] satisfies ["done" | "failed", string, string][])(
  "an unread %s run says so in its status color",
  async (status, label, color) => {
    mockFinishedStatus = status;
    const view = renderWorkspace();
    try {
      const row = within(
        await screen.findByRole("button", {
          name: new RegExp(`^Open session Session 0\\. Workspace\\. ${label}\\. Unread\\.`),
        }),
      );
      expect(row.getByText(label)).toHaveStyle({ color });
      expect(row.getByText("Session 0")).toHaveStyle({ fontWeight: "600" });
    } finally {
      view.cleanup();
    }
  },
);

test("swiping a row archives it on the server, and archived rows unarchive", async () => {
  mockArchivedCount = 1;
  mockRowCount = 5;
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    fireEvent(
      screen.getByRole("button", { name: /^Open session Session 0\./ }),
      "accessibilityAction",
      { nativeEvent: { actionName: "archive" } },
    );
    await waitFor(() =>
      expect(mockArchiveSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ses_0" }),
        true,
      ),
    );
    fireEvent(
      screen.getByRole("button", { name: /^Open session Session 4\./ }),
      "accessibilityAction",
      { nativeEvent: { actionName: "archive" } },
    );
    await waitFor(() =>
      expect(mockArchiveSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "ses_4" }),
        false,
      ),
    );
  } finally {
    view.cleanup();
  }
});

test("a failed archive keeps the row and says so", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  mockArchiveSession.mockRejectedValueOnce(new Error("offline"));
  const view = renderWorkspace();
  try {
    await screen.findByText("Session 0");
    fireEvent(
      screen.getByRole("button", { name: /^Open session Session 0\./ }),
      "accessibilityAction",
      { nativeEvent: { actionName: "archive" } },
    );
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Archive failed",
        "The session did not change. Refresh and try again.",
      ),
    );
  } finally {
    alert.mockRestore();
    view.cleanup();
  }
});

test("the Working section collapses and expands, stores it, and announces it on iOS", async () => {
  mockRowCount = 4;
  mockWorkingCount = 2;
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const content = () => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>
  );
  const view = render(content());
  try {
    await screen.findByText("Session 0");
    const toggle = screen.getByRole("button", { name: "Working, 2 sessions" });
    expect(toggle).toHaveProp("accessibilityHint", "Hides working sessions");
    fireEvent.press(toggle);
    expect(mockSetSectionExpanded).toHaveBeenCalledWith("working", false);
    expect(announce).toHaveBeenCalledWith("Working collapsed");

    // The provider stores the choice, so a re-render shows the collapsed section.
    view.rerender(content());
    expect(screen.queryByText("Session 0")).toBeNull();
    expect(screen.getByText("Session 2")).toBeOnTheScreen();
    const collapsed = screen.getByRole("button", { name: "Working, 2 sessions" });
    expect(collapsed).toBeCollapsed();
    expect(collapsed).toHaveProp("accessibilityHint", "Shows working sessions");
    expect(
      within(collapsed)
        .UNSAFE_getAllByType(Feather)
        .map((icon) => icon.props.name),
    ).toEqual(["chevron-right"]);

    fireEvent.press(collapsed);
    expect(mockSetSectionExpanded).toHaveBeenLastCalledWith("working", true);
    view.rerender(content());
    expect(await screen.findByText("Session 0")).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith("Working expanded");
  } finally {
    announce.mockRestore();
    view.unmount();
    queryClient.clear();
  }
});

test("a session with no messages explains how to start", async () => {
  mockListMessages.mockImplementationOnce(async () => ({ cursor: {}, data: [] }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "empty-session",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("No messages yet")).toBeOnTheScreen();
  expect(screen.getByText(/Type @ to mention a file or agent/)).toBeOnTheScreen();
  view.unmount();
  queryClient.clear();
});

test("compact mode groups consecutive tool calls across assistant messages", async () => {
  mockListMessages.mockImplementationOnce(async () => ({
    cursor: {},
    data: ["shell", "glob", "grep"].map((name, index) => ({
      agent: "build",
      id: `msg_tools_${index}`,
      type: "assistant" as const,
      model: { id: "model-1", providerID: "provider" },
      time: { created: index + 1 },
      content: [
        {
          type: "tool" as const,
          id: `tool_${index}`,
          name,
          time: { created: index + 1 },
          state: {
            status: "completed" as const,
            input: {},
            content: [{ type: "text" as const, text: `Result ${index}` }],
          },
        },
      ],
    })),
  }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "grouping",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  const group = await screen.findByRole("button", { name: "3 tool calls" });
  expect(screen.queryByText("Result 0")).toBeNull();
  expect(screen.getByLabelText("Session transcript").props.data).toHaveLength(1);
  fireEvent.press(group);
  expect(screen.getByRole("button", { name: "3 tool calls" }).props.accessibilityState).toEqual({
    expanded: true,
  });
  view.unmount();
  queryClient.clear();
});

test("automatic history fill stops at the existing five-page limit", async () => {
  const previous = mockListMessages.getMockImplementation();
  let pages = 0;
  mockListMessages.mockImplementation(async () => ({
    cursor: { next: `older-${++pages}` },
    data: [],
  }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={
          {
            key: "bounded-history",
            name: "Session",
            params: {
              connectionId: "connection-1",
              location: { directory: "/workspace" },
              sessionID: "ses_transcript",
            },
          } as never
        }
      />
    </QueryClientProvider>,
  );
  try {
    await screen.findByRole("button", { name: "Load older" });
    fireEvent(screen.getByLabelText("Session transcript"), "layout", {
      nativeEvent: { layout: { width: 360, height: 700, x: 0, y: 0 } },
    });
    fireEvent(screen.getByLabelText("Session transcript"), "contentSizeChange", 360, 100);
    expect(
      await screen.findByText("Older messages are not loaded on this device."),
    ).toBeOnTheScreen();
    expect(pages).toBe(5);
  } finally {
    view.unmount();
    queryClient.clear();
    if (previous) mockListMessages.mockImplementation(previous);
  }
});

test.each([180, 900])(
  "compact history respects rendered height %s rather than raw tool count",
  async (contentHeight) => {
    mockListMessages.mockResolvedValueOnce({
      cursor: { next: "older-context" },
      data: Array.from({ length: 40 }, (_, index) => ({
        agent: "build",
        id: `msg_compact_${index}`,
        type: "assistant" as const,
        model: { id: "model-1", providerID: "provider" },
        time: { created: 100 + index },
        content: [
          {
            type: "tool" as const,
            id: `tool_${index}`,
            name: "shell",
            time: { created: 100 + index },
            state: {
              status: "completed" as const,
              input: {},
              content: [{ type: "text" as const, text: "Result" }],
            },
          },
        ],
      })),
    });
    if (contentHeight < 700)
      mockListMessages.mockResolvedValueOnce({
        cursor: {},
        data: [
          { id: "earlier_user", type: "user", text: "Earlier question", time: { created: 1 } },
        ],
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <SessionScreen
          navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
          route={
            {
              key: "compact-context",
              name: "Session",
              params: {
                connectionId: "connection-1",
                location: { directory: "/workspace" },
                sessionID: "ses_transcript",
              },
            } as never
          }
        />
      </QueryClientProvider>,
    );
    try {
      await screen.findByRole("button", { name: "40 tool calls" });
      fireEvent(screen.getByLabelText("Session transcript"), "layout", {
        nativeEvent: { layout: { width: 360, height: 700, x: 0, y: 0 } },
      });
      fireEvent(
        screen.getByLabelText("Session transcript"),
        "contentSizeChange",
        360,
        contentHeight,
      );
      if (contentHeight < 700) {
        expect(await screen.findByText("Earlier question")).toBeOnTheScreen();
        expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
      } else {
        expect(screen.queryByText("Earlier question")).toBeNull();
        expect(screen.getByRole("button", { name: "Load older" })).toBeOnTheScreen();
      }
    } finally {
      view.unmount();
      queryClient.clear();
    }
  },
);

test("renders short thoughts inline and keeps detailed thoughts collapsed", async () => {
  const scrollToOffset = jest
    .spyOn(FlatList.prototype, "scrollToOffset")
    .mockImplementation(() => undefined);
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "session",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
  await waitFor(() => expect(mockListMessages).toHaveBeenCalled());
  await expect(mockGetSession.mock.results.at(-1)?.value).resolves.toMatchObject({
    id: "ses_transcript",
  });
  await expect(mockListMessages.mock.results.at(-1)?.value).resolves.toMatchObject({
    data: expect.any(Array),
  });
  await screen.findByText("Current question");
  expect(screen.queryByRole("header", { name: "Transcript session" })).toBeNull();
  expect(screen.queryByRole("button", { name: "DELETE SESSION" })).toBeNull();
  expect(screen.queryByLabelText("Transcript controls")).toBeNull();
  expect(screen.getByText("Newest answer")).toBeOnTheScreen();
  expect(screen.getByText("note.txt")).toBeOnTheScreen();
  expect(screen.getByText("Private reasoning")).toBeOnTheScreen();
  expect(screen.queryByText("Detailed reasoning\nSecond step")).toBeNull();
  expect(screen.queryByText("c2VjcmV0")).toBeNull();
  expect(screen.queryByText("file:///private/note.txt")).toBeNull();

  fireEvent.press(screen.getByRole("button", { name: /Thought/ }));
  expect(screen.getByText("Detailed reasoning\nSecond step")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Load older" }));
  expect(await screen.findByText("Older message")).toBeOnTheScreen();
  expect(mockListMessages).toHaveBeenLastCalledWith(
    expect.anything(),
    "ses_transcript",
    { cursor: "older", limit: 40 },
    expect.objectContaining({ signal: expect.anything() }),
  );

  const transcript = screen.getByLabelText("Session transcript");
  const scrollEvent = (y: number) => ({
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { height: 1_000, width: 320 },
      layoutMeasurement: { height: 500, width: 320 },
    },
  });
  const liveEdgeEvent = scrollEvent(0);
  const justAwayFromLiveEdge = scrollEvent(3);
  fireEvent(transcript, "scrollBeginDrag", liveEdgeEvent);
  fireEvent.scroll(transcript, justAwayFromLiveEdge);
  fireEvent(transcript, "momentumScrollEnd", justAwayFromLiveEdge);
  expect(screen.getByRole("button", { name: "Scroll to latest" })).toHaveStyle({
    position: "absolute",
    alignSelf: "center",
  });
  expect(screen.queryByText("Latest")).toBeNull();

  fireEvent(transcript, "scrollBeginDrag", justAwayFromLiveEdge);
  fireEvent.scroll(transcript, liveEdgeEvent);
  expect(screen.getByRole("button", { name: "Scroll to latest" })).toBeOnTheScreen();
  fireEvent(transcript, "momentumScrollEnd", liveEdgeEvent);
  expect(screen.queryByRole("button", { name: "Scroll to latest" })).toBeNull();
  const transcriptPosition = () =>
    screen.UNSAFE_getByProps({ accessibilityLabel: "Session transcript" }).props
      .maintainVisibleContentPosition;
  const transcriptRowTransition = () =>
    screen.UNSAFE_getByProps({ accessibilityLabel: "Session transcript" }).props
      .itemLayoutAnimation;
  // Following: rows ease to their new layout as the newest row grows, and the list stays
  // anchored on that row so no frame shows a scroll correction.
  expect(transcriptPosition()).toEqual({ minIndexForVisible: 0 });
  expect(transcriptRowTransition()).toBeDefined();
  scrollToOffset.mockClear();
  fireEvent(transcript, "contentSizeChange", 320, 1_100);
  await waitFor(() => expect(scrollToOffset).toHaveBeenCalledWith({ animated: false, offset: 0 }));
  scrollToOffset.mockClear();
  fireEvent(transcript, "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 220 } },
  });
  await waitFor(() => expect(scrollToOffset).toHaveBeenCalledWith({ animated: false, offset: 0 }));

  fireEvent(transcript, "scrollBeginDrag", liveEdgeEvent);
  fireEvent.scroll(transcript, justAwayFromLiveEdge);
  fireEvent(transcript, "momentumScrollEnd", justAwayFromLiveEdge);
  scrollToOffset.mockClear();
  fireEvent(transcript, "contentSizeChange", 320, 1_200);
  fireEvent(transcript, "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 500 } },
  });
  expect(scrollToOffset).not.toHaveBeenCalled();
  // Reading older text: no row animation competes with the position the list keeps.
  expect(transcriptRowTransition()).toBeUndefined();
  fireEvent.press(screen.getByRole("button", { name: "Scroll to latest" }));
  expect(scrollToOffset).toHaveBeenCalledWith({ animated: true, offset: 0 });
  fireEvent.scroll(transcript, scrollEvent(120));
  expect(screen.getByRole("button", { name: "Scroll to latest" })).toBeOnTheScreen();
  fireEvent(transcript, "momentumScrollEnd", liveEdgeEvent);
  expect(screen.queryByRole("button", { name: "Scroll to latest" })).toBeNull();

  view.unmount();
  queryClient.clear();
  scrollToOffset.mockRestore();
});

test("Reduce Motion keeps live-edge follow instant", async () => {
  // React Native's Jest setup already mocks this; set its value instead of restoring a spy.
  const reduceMotion = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
  reduceMotion.mockResolvedValue(true);
  const scrollToOffset = jest
    .spyOn(FlatList.prototype, "scrollToOffset")
    .mockImplementation(() => undefined);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "session",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  try {
    await screen.findByText("Current question");
    const transcript = screen.getByLabelText("Session transcript");
    await waitFor(() =>
      expect(
        screen.UNSAFE_getByProps({ accessibilityLabel: "Session transcript" }).props
          .itemLayoutAnimation,
      ).toBeUndefined(),
    );
    expect(
      screen.UNSAFE_getByProps({ accessibilityLabel: "Session transcript" }).props
        .maintainVisibleContentPosition,
    ).toEqual({ minIndexForVisible: 0 });
    scrollToOffset.mockClear();
    fireEvent(transcript, "contentSizeChange", 320, 1_100);
    await waitFor(() =>
      expect(scrollToOffset).toHaveBeenCalledWith({ animated: false, offset: 0 }),
    );
  } finally {
    view.unmount();
    queryClient.clear();
    scrollToOffset.mockRestore();
    reduceMotion.mockResolvedValue(false);
  }
});

test("waits for and adopts a moved session's authoritative location", async () => {
  const routeLocation = { directory: "/workspace" };
  const movedLocation = { directory: "/workspace/moved" };
  const movedSession = {
    cost: 0,
    id: "ses_moved",
    location: movedLocation,
    projectID: "project-1",
    time: { created: 1, updated: 3 },
    title: "Moved session",
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  } satisfies SessionInfo;
  let resolveSession: ((session: SessionInfo) => void) | undefined;
  const pendingSession = new Promise<SessionInfo>((resolve) => {
    resolveSession = resolve;
  });
  const previousGetSession = mockGetSession.getMockImplementation();
  const previousListMessages = mockListMessages.getMockImplementation();
  mockGetSession.mockImplementation(() => pendingSession);
  mockListMessages.mockImplementation(async () => ({
    cursor: {},
    data: [
      {
        agent: "build",
        content: [
          {
            id: "tool-patch",
            name: "patch",
            state: {
              content: [{ text: "Applied", type: "text" }],
              input: { patchText: "*** Begin Patch\n*** End Patch" },
              status: "completed",
            },
            time: { completed: 2, created: 1 },
            type: "tool",
          },
        ],
        id: "msg_edit",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1 },
        type: "assistant",
      },
    ],
  }));
  mockListMessages.mockClear();
  mockListAgents.mockClear();
  mockSetLocation.mockClear();
  const push = jest.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={
          { goBack: jest.fn(), navigate: jest.fn(), push, setOptions: jest.fn() } as never
        }
        route={{
          key: "session-moved",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: routeLocation,
            sessionID: "ses_moved",
          },
        }}
      />
    </QueryClientProvider>,
  );

  try {
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    expect(screen.getByLabelText("Prompt").props.editable).toBe(false);
    expect(mockListMessages).not.toHaveBeenCalled();
    expect(mockListAgents).not.toHaveBeenCalled();
    expect(mockSetLocation).not.toHaveBeenCalled();

    await act(async () => resolveSession?.(movedSession));

    await waitFor(() => expect(mockListMessages).toHaveBeenCalled());
    await waitFor(() => expect(mockListAgents).toHaveBeenCalled());
    expect(mockListAgents).toHaveBeenLastCalledWith(
      expect.anything(),
      movedLocation,
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(mockSetLocation).toHaveBeenLastCalledWith(movedLocation);
    expect(screen.getByLabelText("Prompt").props.editable).toBe(true);
    expect(
      queryClient.getQueryData(
        openCodeQueryKeys.session("connection-1", movedLocation, "ses_moved"),
      ),
    ).toEqual(movedSession);
    expect(
      queryClient.getQueryData(
        openCodeQueryKeys.messages("connection-1", routeLocation, "ses_moved", {
          limit: 40,
          order: "desc",
        }),
      ),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(
        openCodeQueryKeys.messages("connection-1", movedLocation, "ses_moved", {
          limit: 40,
          order: "desc",
        }),
      ),
    ).toBeDefined();

    fireEvent.press(await screen.findByRole("button", { name: "1 tool calls" }));
    fireEvent.press(screen.getByRole("button", { name: /Patch.*Show/ }));
    fireEvent.press(await screen.findByRole("button", { name: "Review current changes" }));
    expect(push).toHaveBeenCalledWith("Diff", {
      connectionId: "connection-1",
      location: movedLocation,
      mode: "working",
    });
  } finally {
    view.unmount();
    queryClient.clear();
    if (previousGetSession) mockGetSession.mockImplementation(previousGetSession);
    if (previousListMessages) mockListMessages.mockImplementation(previousListMessages);
  }
});

test("expanded background shell follows command output after the session is idle", async () => {
  mockListMessages.mockImplementationOnce(async () => ({
    cursor: {},
    data: [
      {
        type: "assistant",
        id: "msg_background",
        agent: "build",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1, completed: 2 },
        content: [
          {
            type: "tool",
            id: "tool_background",
            name: "shell",
            time: { created: 1, completed: 2 },
            state: {
              status: "completed",
              input: { command: "build" },
              metadata: { status: "running", shellID: "sh_background" },
              content: [
                {
                  type: "text",
                  text: "Command moved to the background. You will be notified when it finishes.",
                },
              ],
            },
          },
        ],
      },
    ],
  }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "background-shell",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  try {
    fireEvent.press(await screen.findByRole("button", { name: "1 tool calls" }));
    fireEvent.press(screen.getByRole("button", { name: /Shell.*Show/ }));
    expect(await screen.findByText("Build progress 50%")).toBeOnTheScreen();
    expect(screen.queryByText(/Command moved to the background/)).toBeNull();
    mockGetShell.mockResolvedValueOnce({
      location,
      data: {
        id: "sh_background",
        status: "exited",
        command: "build",
        cwd: "/workspace",
        shell: "sh",
        file: "/output",
        metadata: {},
        time: { started: 1 },
      },
    });
    mockShellOutput.mockResolvedValueOnce({
      location,
      data: {
        output: "\nBuild complete",
        cursor: 33,
        size: 33,
        truncated: false,
      },
    });
    act(() =>
      new ConnectionEventQueryBridge(queryClient, "connection-1", (flush) => flush()).apply({
        type: "shell.exited",
        id: "evt_shell",
        created: 3,
        location,
        data: { id: "sh_background", status: "exited", exit: 0 },
      }),
    );
    expect(await screen.findByText("Build progress 50%\nBuild complete")).toBeOnTheScreen();
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test("shows running background subagents and opens their child sessions", async () => {
  mockListMessages.mockImplementationOnce(async () => ({
    cursor: {},
    data: [
      {
        agent: "build",
        content: [
          {
            id: "tool-subagent",
            name: "subagent",
            state: {
              content: [
                {
                  text: '<task id="ses_child" state="running">\n<task_result>\nWorking\n</task_result>\n</task>',
                  type: "text",
                },
              ],
              input: {
                background: true,
                description: "Inspect event handling",
                subagent_type: "explore",
              },
              metadata: { background: true, sessionId: "ses_child" },
              status: "completed",
            },
            time: { created: 3 },
            type: "tool",
          },
        ],
        id: "msg_subagent",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 3 },
        type: "assistant",
      },
    ],
  }));
  const push = jest.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={
          { goBack: jest.fn(), navigate: jest.fn(), push, setOptions: jest.fn() } as never
        }
        route={{
          key: "session-subagent",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("Inspect event handling")).toBeOnTheScreen();
  fireEvent.press(
    screen.getByRole("button", { name: /^Background subagent, Inspect event handling/ }),
  );
  expect(push).toHaveBeenCalledWith("Session", {
    connectionId: "connection-1",
    fromParent: true,
    location: { directory: "/workspace" },
    sessionID: "ses_child",
  });

  view.unmount();
  queryClient.clear();
});

test("does not rerender stable transcript rows when a streaming row changes", async () => {
  let stableTextReads = 0;
  const stableMessage = new Proxy<SessionMessageInfo>(
    { id: "msg_stable", text: "Stable question", time: { created: 2 }, type: "user" },
    {
      get(target, property, receiver) {
        if (property === "text") stableTextReads += 1;
        return Reflect.get(target, property, receiver);
      },
    },
  );
  const streamingMessage: SessionMessageInfo = {
    agent: "build",
    content: [{ text: "First fragment", type: "text" }],
    id: "msg_streaming",
    model: { id: "model-1", providerID: "provider" },
    time: { created: 3 },
    type: "assistant",
  };
  mockListMessages.mockImplementationOnce(async () => ({
    cursor: {},
    data: [streamingMessage, stableMessage],
  }));
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={
          {
            goBack: jest.fn(),
            navigate: jest.fn(),
            push: jest.fn(),
            setOptions: jest.fn(),
          } as never
        }
        route={{
          key: "session-row-stability",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );

  await screen.findByText("Stable question");
  const initialStableTextReads = stableTextReads;
  const messageKey = openCodeQueryKeys.messages(
    "connection-1",
    { directory: "/workspace" },
    "ses_transcript",
    { limit: 40, order: "desc" },
  );
  act(() => {
    queryClient.setQueryData<InfiniteData<SessionMessagesResponse, string | undefined>>(
      messageKey,
      (current) => {
        if (!current) throw new Error("TEST_TRANSCRIPT_CACHE_MISSING");
        return {
          ...current,
          pages: current.pages.map((page, pageIndex) =>
            pageIndex === 0
              ? {
                  ...page,
                  data: [
                    {
                      ...streamingMessage,
                      content: [{ text: "Second fragment", type: "text" }],
                    },
                    stableMessage,
                  ],
                }
              : page,
          ),
        };
      },
    );
  });

  await screen.findByText("Second fragment");
  expect(stableTextReads).toBe(initialStableTextReads);

  view.unmount();
  queryClient.clear();
});

test("remeasures the transcript when the system font scale changes", async () => {
  const originalWindow = { ...Dimensions.get("window") };
  const originalScreen = { ...Dimensions.get("screen") };
  const defaultFontScale = 1;
  const accessibilityFontScale = 3.143;
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  act(() => {
    Dimensions.set({
      screen: { ...originalScreen, fontScale: defaultFontScale },
      window: { ...originalWindow, fontScale: defaultFontScale },
    });
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "session-font-scale",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );

  try {
    await screen.findByText("Newest answer");
    expect(screen.UNSAFE_getByType(FlatList).props.extraData).toBe(defaultFontScale);
    expect(screen.getByRole("button", { name: /Thought/ })).toHaveStyle({
      flexDirection: "row",
    });
    expect(screen.queryByText("Test server")).toBeNull();
    const normalScaleAwayFromLiveEdge = {
      nativeEvent: {
        contentOffset: { x: 0, y: 120 },
        contentSize: { height: 1_000, width: 320 },
        layoutMeasurement: { height: 500, width: 320 },
      },
    };
    const normalScaleLiveEdge = {
      ...normalScaleAwayFromLiveEdge,
      nativeEvent: {
        ...normalScaleAwayFromLiveEdge.nativeEvent,
        contentOffset: { x: 0, y: 0 },
      },
    };
    const normalScaleTranscript = screen.getByLabelText("Session transcript");
    fireEvent(normalScaleTranscript, "scrollBeginDrag", normalScaleAwayFromLiveEdge);
    fireEvent.scroll(normalScaleTranscript, normalScaleAwayFromLiveEdge);
    expect(screen.getByRole("button", { name: "Scroll to latest" })).toHaveStyle({
      position: "absolute",
    });
    fireEvent(normalScaleTranscript, "momentumScrollEnd", normalScaleLiveEdge);
    fireEvent.press(screen.getByRole("button", { name: /Thought/ }));
    expect(screen.getByText("Detailed reasoning\nSecond step")).toBeOnTheScreen();

    act(() => {
      Dimensions.set({
        screen: { ...originalScreen, fontScale: accessibilityFontScale },
        window: { ...originalWindow, fontScale: accessibilityFontScale },
      });
    });

    expect(screen.UNSAFE_getByType(FlatList).props.extraData).toBe(accessibilityFontScale);
    expect(screen.getByRole("button", { name: /Thought/ })).toHaveStyle({
      flexDirection: "column",
    });
    expect(screen.queryByText("Detailed reasoning\nSecond step")).toBeNull();
    expect(screen.queryByText("Test server")).toBeNull();
    expect(screen.getByRole("tab", { name: "Changes" })).toBeOnTheScreen();

    const awayFromLiveEdge = {
      nativeEvent: {
        contentOffset: { x: 0, y: 120 },
        contentSize: { height: 1_000, width: 320 },
        layoutMeasurement: { height: 500, width: 320 },
      },
    };
    const transcript = screen.getByLabelText("Session transcript");
    fireEvent(transcript, "scrollBeginDrag", awayFromLiveEdge);
    fireEvent.scroll(transcript, awayFromLiveEdge);
    expect(screen.getByRole("button", { name: "Scroll to latest" })).toHaveStyle({
      position: "absolute",
    });
  } finally {
    act(() => {
      Dimensions.set({ screen: originalScreen, window: originalWindow });
    });
    view.unmount();
    queryClient.clear();
  }
});

test("measures the iOS composer dock and lifts it above the keyboard", async () => {
  const addListener = jest.spyOn(Keyboard, "addListener");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "session-ios-keyboard",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  const keyboardListener = (eventName: string) =>
    addListener.mock.calls.filter(([name]) => name === eventName).at(-1)?.[1] as (
      event: unknown,
    ) => void;
  const spacerHeight = () =>
    screen
      .UNSAFE_getAllByProps({ pointerEvents: "none" })
      .map((element) => StyleSheet.flatten(element.props.style))
      .find((style) => style?.flexShrink === 0)?.height;
  try {
    const dock = await screen.findByLabelText("Keyboard composer dock");
    const measureInWindow = jest.mocked(
      screen.UNSAFE_getByProps({ accessibilityLabel: "Keyboard composer dock" }).instance
        .measureInWindow,
    );
    measureInWindow.mockImplementation(
      (callback: (x: number, y: number, width: number, height: number) => void) =>
        callback(0, 700, 390, 100),
    );
    const content = dock.children[0] as typeof dock;
    fireEvent(content, "layout", { nativeEvent: { layout: { height: 120 } } });
    fireEvent(content, "layout", { nativeEvent: { layout: { height: 120.4 } } });
    expect(spacerHeight()).toBe(120);
    fireEvent(dock, "layout", { nativeEvent: { layout: { height: 100 } } });
    expect(measureInWindow).toHaveBeenCalledTimes(1);

    act(() => keyboardListener("keyboardWillChangeFrame")({ endCoordinates: { screenY: 500 } }));
    expect(dock).toHaveStyle({ bottom: 268 });
    expect(spacerHeight()).toBe(388);
    fireEvent(dock, "layout", { nativeEvent: { layout: { height: 100 } } });
    expect(measureInWindow).toHaveBeenCalledTimes(1);

    act(() => keyboardListener("keyboardWillHide")({}));
    expect(dock).toHaveStyle({ bottom: 0 });
    expect(spacerHeight()).toBe(120);
  } finally {
    addListener.mockRestore();
    view.unmount();
    queryClient.clear();
  }
});

test("the session actions button stays disabled until the session location is confirmed", async () => {
  const setOptions =
    jest.fn<(options: { title?: string; headerRight?: () => ReactNode }) => void>();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions } as never}
        route={{
          key: "session-actions-button",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  const headerButtons = () =>
    setOptions.mock.calls
      .map(([options]) => options.headerRight)
      .filter((headerRight) => headerRight !== undefined)
      .map(
        (headerRight) =>
          headerRight() as ReactElement<{
            disabled: boolean;
            style: (state: { pressed: boolean }) => unknown;
          }>,
      );
  try {
    await waitFor(() => expect(setOptions).toHaveBeenCalledWith({ title: "Transcript session" }));
    await waitFor(() => expect(headerButtons().at(-1)?.props.disabled).toBe(false));
    const pending = headerButtons()[0];
    const ready = headerButtons().at(-1);
    expect(pending?.props.disabled).toBe(true);
    expect(StyleSheet.flatten(pending?.props.style({ pressed: false }) as never)).toMatchObject({
      opacity: disabledOpacity,
    });
    expect(StyleSheet.flatten(ready?.props.style({ pressed: false }) as never)).not.toHaveProperty(
      "opacity",
    );
    expect(StyleSheet.flatten(ready?.props.style({ pressed: true }) as never)).toMatchObject({
      opacity: pressedOpacity,
    });
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test("a session from another connection offers only the way back to the workspace", () => {
  mockGetSession.mockClear();
  const navigation = {
    goBack: jest.fn(),
    navigate: jest.fn(),
    popTo: jest.fn(),
    setOptions: jest.fn(),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={navigation as never}
        route={{
          key: "stale-connection",
          name: "Session",
          params: {
            connectionId: "connection-2",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  try {
    expect(screen.getByText("This session belongs to a different connection.")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Session transcript")).toBeNull();
    expect(mockGetSession).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Back to sessions" }));
    expect(navigation.popTo).toHaveBeenCalledWith("Workspace");
    const shell = screen.UNSAFE_getByType(ShellFrame);
    act(() => shell.props.navigate("Workspace"));
    expect(navigation.popTo).toHaveBeenCalledTimes(2);
    act(() => shell.props.navigate("Settings"));
    expect(navigation.navigate).toHaveBeenCalledWith("Settings");
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test("offers Retry when the transcript fails to load", async () => {
  mockListMessages.mockRejectedValueOnce(new Error("UNREACHABLE"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never}
        route={{
          key: "transcript-retry",
          name: "Session",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            sessionID: "ses_transcript",
          },
        }}
      />
    </QueryClientProvider>,
  );
  try {
    expect(await screen.findByText("The transcript could not be loaded.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Newest answer")).toBeOnTheScreen();
  } finally {
    view.unmount();
    queryClient.clear();
  }
});
