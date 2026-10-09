import Feather from "@expo/vector-icons/Feather";
import { afterEach, expect, jest, test } from "@jest/globals";
import {
  getOpenCodeLocation,
  getOpenCodeSession,
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
import type { ReactNode } from "react";
import { Alert, Dimensions, FlatList, Platform, RefreshControl } from "react-native";
import { ConnectionEventQueryBridge } from "../state/connection-event-query-bridge";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { WorkspaceSelectionProvider } from "../state/workspace-selection-context";
import { palette, typography } from "../theme";
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
let mockArchivedIds: string[] = [];
let mockArchiveWriteFailure = false;
const mockSessionNow = Date.now();
let mockOldSession = false;
let mockRestoredAt: Record<string, number> = {};
let mockHasNextSessionPage = false;
let mockAllSessionsOld = false;
let mockSessionsFetchingNextPage = false;
let mockSessionsError = false;
const mockFetchNextSessionPage = jest.fn(async () => undefined);
afterEach(() => {
  mockWorkspaceActive = false;
  mockWorkspaceNeedsAttention = false;
  mockWorkspaceDirectory = "/workspace";
  mockAttentionFreshness = "current";
  mockAttentionCompleteness = "complete";
  mockWorkspacePermissions = [];
  mockArchivedIds = [];
  mockArchiveWriteFailure = false;
  mockOldSession = false;
  mockRestoredAt = {};
  mockHasNextSessionPage = false;
  mockAllSessionsOld = false;
  mockSessionsFetchingNextPage = false;
  mockSessionsError = false;
});
function mockWorkspaceRow(index: number) {
  const session = {
    cost: 0,
    id: `ses_${index}`,
    location: { directory: mockWorkspaceDirectory },
    projectID: "project-1",
    time: {
      created: mockSessionNow - index,
      updated:
        mockAllSessionsOld || (mockOldSession && index === 0)
          ? mockSessionNow - 31 * 24 * 60 * 60 * 1_000
          : mockSessionNow - index,
    },
    title: `Session ${index}`,
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  };
  return {
    active: mockWorkspaceActive,
    activeChildCount: 0,
    attentionCount: mockWorkspaceNeedsAttention && index === 0 ? 1 : 0,
    attentionLabel: mockWorkspaceNeedsAttention && index === 0 ? "Permission required" : "",
    children: [],
    projectLabel: "Workspace",
    section: mockWorkspaceActive ? "working" : "recent",
    session,
    targetLocation: session.location,
    targetSessionID: session.id,
  };
}
const mockDraftDb = {
  getAllAsync: jest.fn(async (sql: string) =>
    sql.includes("session_archives")
      ? [
          ...mockArchivedIds.map((session_id) => ({ session_id, restored_at_ms: null })),
          ...Object.entries(mockRestoredAt).map(([session_id, restored_at_ms]) => ({
            session_id,
            restored_at_ms,
          })),
        ]
      : [],
  ),
  getFirstAsync: jest.fn(async () => undefined),
  runAsync: jest.fn(async (sql: string, ...args: unknown[]) => {
    if (sql.includes("session_archives")) {
      if (mockArchiveWriteFailure) throw new Error("disk");
      const id = args[1] as string;
      if (args[2] == null) {
        mockArchivedIds = [...new Set([...mockArchivedIds, id])];
        delete mockRestoredAt[id];
      } else {
        mockArchivedIds = mockArchivedIds.filter((value) => value !== id);
        mockRestoredAt[id] = args[2] as number;
      }
    }
  }),
  withExclusiveTransactionAsync: jest.fn(async (task: (txn: unknown) => Promise<void>) =>
    task(mockDraftDb),
  ),
};

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  backgroundOpenCodeSession: jest.fn(),
  cancelOpenCodeSessionInboxItem: jest.fn(),
  classifyOpenCodeError: jest.fn(() => "UNREACHABLE"),
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
  promptOpenCodeSession: jest.fn(),
  queueOpenCodeSessionInboxItem: jest.fn(),
  removeOpenCodeSession: jest.fn(),
  renameOpenCodeSession: jest.fn(),
  steerOpenCodeSessionInboxItem: jest.fn(),
  switchOpenCodeSessionAgent: jest.fn(),
  switchOpenCodeSessionModel: jest.fn(),
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
    status: "connected",
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
    followedProjectIds: ["project-1"],
    formLocations: new Map(),
    forms: [],
    hasNextPage: mockHasNextSessionPage,
    sessionsFetchingNextPage: mockSessionsFetchingNextPage,
    inbox: {
      needsYou: mockWorkspaceNeedsAttention ? [mockWorkspaceRow(0)] : [],
      recent: mockWorkspaceActive
        ? []
        : Array.from({ length: 120 }, (_, index) => mockWorkspaceRow(index)).filter(
            (row) => row.attentionCount === 0,
          ),
      unmatchedSessionIDs: [],
      working: mockWorkspaceActive
        ? Array.from({ length: 120 }, (_, index) => mockWorkspaceRow(index))
        : [],
    },
    interactionsError: false,
    interactionsLoading: false,
    pendingCount: mockWorkspaceNeedsAttention ? 1 : mockWorkspacePermissions.length,
    permissionReplyError: false,
    permissions: mockWorkspacePermissions,
    preferencesLoading: false,
    preferencesSaving: false,
    projects: [],
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
    unavailableProjectIds: [],
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

test("attention section owns requests, with a shortcut only when search or archives hide it", async () => {
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
    expect(await screen.findByText("Permission required")).toBeOnTheScreen();
    expect(screen.getAllByText("Needs you")).toHaveLength(1);
    expect(screen.queryByText("Needs you 1")).toBeNull();
    fireEvent.changeText(screen.getByLabelText("Search sessions"), "Session");
    expect(await screen.findByText("Needs you 1")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "1 known request" }));
    expect(navigate).toHaveBeenCalledWith("Pending");
    fireEvent.press(screen.getByRole("button", { name: "Clear session search" }));
    await waitFor(() => expect(screen.queryByText("Needs you 1")).toBeNull());
    fireEvent.press(screen.getByRole("button", { name: "Archived" }));
    expect(await screen.findByText("Needs you 1")).toBeOnTheScreen();
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test.each([
  ["reconciling", "incomplete", "Checking request status. More sessions may need you."],
  ["stale", "complete", "Request status is stale. Reconnect to check pending requests."],
  ["current", "incomplete", "Some request locations could not be checked. Pull to refresh."],
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
      expect(await screen.findByText(copy)).toBeOnTheScreen();
    } finally {
      view.unmount();
      queryClient.clear();
    }
  },
);

test.each([
  [false, false],
  [true, false],
  [false, true],
])(
  "shows branch context only when working %s or outside canonical location %s",
  async (active, worktree) => {
    mockWorkspaceActive = active;
    if (worktree) mockWorkspaceDirectory = "/workspace-tree";
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
      await act(async () => {
        await queryClient.refetchQueries({
          queryKey: openCodeQueryKeys.vcs("connection-1", location),
        });
        // Query notifications run on a zero-delay timer. Flush them inside act
        // before capturing a row, including on slower CI runners.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      const row = within(screen.getByRole("button", { name: /^Open session Session 0\./ }));
      if (active || worktree) {
        expect(row.getByText("docs/mobile-workflow-screenshots")).toBeOnTheScreen();
        expect(row.UNSAFE_getByType(Feather).props).toMatchObject({
          accessibilityElementsHidden: true,
          importantForAccessibility: "no-hide-descendants",
          name: "git-branch",
        });
      } else {
        expect(row.queryByText("docs/mobile-workflow-screenshots")).toBeNull();
      }
      expect(row.queryByText("/workspace")).not.toBeOnTheScreen();
      if (active) {
        expect(
          screen.getByRole("button", { name: /^Open session Session 0\. Workspace\. Working/ }),
        ).toBeOnTheScreen();
      }
    } finally {
      view.unmount();
      queryClient.clear();
    }
  },
);

test("Load older sessions reveals already loaded inbox rows", async () => {
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
  await screen.findByText("Session 0");
  expect(screen.queryByText("Session 20")).not.toBeOnTheScreen();
  expect(screen.queryByTestId("session-archive-footer")).not.toBeOnTheScreen();
  expect(
    screen.queryByText("Idle sessions archive automatically after 30 days without updates."),
  ).not.toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Load older sessions" }));
  expect(view.UNSAFE_getByType(FlatList).props.data).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: "ses_20", type: "session" })]),
  );
  expect(mockFetchNextSessionPage).not.toHaveBeenCalled();
  for (let index = 0; index < 4; index++)
    fireEvent.press(screen.getByRole("button", { name: "Load older sessions" }));
  expect(
    view
      .UNSAFE_getByType(FlatList)
      .props.data.filter((item: { type: string }) => item.type === "session"),
  ).toHaveLength(120);
  await waitFor(() => expect(mockFetchNextSessionPage).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("button", { name: "Load older sessions" })).not.toBeOnTheScreen();
  expect(screen.queryByTestId("session-archive-footer")).not.toBeOnTheScreen();
  view.unmount();
  queryClient.clear();
  mockHasNextSessionPage = false;
});

test("does not offer older Inbox sessions when remaining history is archived", async () => {
  mockAllSessionsOld = true;
  mockHasNextSessionPage = true;
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
  await waitFor(() => expect(screen.queryByText("Session 0")).not.toBeOnTheScreen());
  expect(screen.queryByRole("button", { name: "Load older sessions" })).not.toBeOnTheScreen();
  view.unmount();
  queryClient.clear();
  mockAllSessionsOld = false;
  mockHasNextSessionPage = false;
});

test("Inbox lookahead waits for pending pages, reveals eligible rows, and stops on errors", async () => {
  mockAllSessionsOld = true;
  mockHasNextSessionPage = true;
  mockSessionsFetchingNextPage = true;
  mockFetchNextSessionPage.mockClear();
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
  await waitFor(() => expect(screen.queryByText("Session 0")).not.toBeOnTheScreen());
  expect(mockFetchNextSessionPage).not.toHaveBeenCalled();
  expect(screen.queryByTestId("session-archive-footer")).not.toBeOnTheScreen();
  mockSessionsFetchingNextPage = false;
  mockSessionsError = true;
  view.rerender(content());
  expect(mockFetchNextSessionPage).not.toHaveBeenCalled();
  mockSessionsError = false;
  view.rerender(content());
  await waitFor(() => expect(mockFetchNextSessionPage).toHaveBeenCalledTimes(1));
  mockAllSessionsOld = false;
  mockHasNextSessionPage = false;
  view.rerender(content());
  expect(screen.getByRole("button", { name: "Load older sessions" })).toBeOnTheScreen();
  expect(mockFetchNextSessionPage).toHaveBeenCalledTimes(1);
  view.unmount();
  queryClient.clear();
});

test("hides Load older sessions once all rows are visible and the server is exhausted", async () => {
  mockHasNextSessionPage = false;
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
  await screen.findByText("Session 0");
  expect(screen.queryByTestId("session-archive-footer")).not.toBeOnTheScreen();
  for (let index = 0; index < 5; index++)
    fireEvent.press(screen.getByRole("button", { name: "Load older sessions" }));
  expect(screen.queryByRole("button", { name: "Load older sessions" })).not.toBeOnTheScreen();
  expect(mockFetchNextSessionPage).not.toHaveBeenCalled();
  const footer = await screen.findByTestId("session-archive-footer");
  expect(
    within(footer).getByText("Idle sessions archive automatically after 30 days without updates."),
  ).toBeOnTheScreen();
  expect(view.UNSAFE_getByType(FlatList).props.ListFooterComponent.props.testID).toBe(
    "session-archive-footer",
  );
  fireEvent.press(screen.getByRole("button", { name: "Archived" }));
  expect(screen.queryByRole("button", { name: "Load older sessions" })).not.toBeOnTheScreen();
  expect(
    within(screen.getByTestId("session-archive-footer")).getByText(
      /Archived on this device only\. Restore/,
    ),
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Inbox" }));
  expect(screen.queryByRole("button", { name: "Load older sessions" })).not.toBeOnTheScreen();
  view.unmount();
  queryClient.clear();
});

test("auto archives sessions after 30 days and Restore survives a remount", async () => {
  mockOldSession = true;
  mockRestoredAt = {};
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity },
    },
  });
  const content = () => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>
  );
  let view = render(content());
  await waitFor(() => expect(screen.queryByText("Session 0")).not.toBeOnTheScreen());
  expect(screen.queryByRole("button", { name: "Keep latest 10" })).not.toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Archived" }));
  const oldSession = await screen.findByRole("button", { name: /^Open session Session 0\./ });
  fireEvent(oldSession, "accessibilityAction", { nativeEvent: { actionName: "archive" } });
  await waitFor(() => expect(screen.queryByText("Session 0")).not.toBeOnTheScreen());
  fireEvent.press(screen.getByRole("button", { name: "Inbox" }));
  expect(await screen.findByText("Session 0")).toBeOnTheScreen();
  expect(mockRestoredAt.ses_0).toBeGreaterThan(0);
  view.unmount();
  queryClient.clear();
  view = render(content());
  await screen.findByText("Session 0");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /^Open session Session 0\./ }).props.accessibilityActions,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ name: "archive" })])),
  );
  expect(screen.getByText("Session 0")).toBeOnTheScreen();
  view.unmount();
  queryClient.clear();
  mockOldSession = false;
  mockRestoredAt = {};
});

test("old working sessions remain visible and auto archive when they become idle", async () => {
  mockOldSession = true;
  mockWorkspaceActive = true;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity },
    },
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
  mockWorkspaceActive = false;
  view.rerender(content());
  await waitFor(() => expect(screen.queryByText("Session 0")).not.toBeOnTheScreen());
  fireEvent.press(screen.getByRole("button", { name: "Archived" }));
  expect(await screen.findByText("Session 0")).toBeOnTheScreen();
  view.unmount();
  queryClient.clear();
  mockOldSession = false;
});

test("a recently restored session outside the loaded pages returns to Inbox", async () => {
  mockRestoredAt = { ses_restored_older: Date.now() };
  jest.mocked(getOpenCodeSession).mockResolvedValueOnce({
    cost: 0,
    id: "ses_restored_older",
    location: { directory: "/workspace" },
    projectID: "project-1",
    title: "Restored older session",
    time: { created: 1, updated: Date.now() - 31 * 24 * 60 * 60 * 1_000 },
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  });
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
  expect(await screen.findByText("Restored older session")).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: /^Open session Restored older session\./ }).props
      .accessibilityLabel,
  ).not.toContain("Archived");
  view.unmount();
  queryClient.clear();
  mockRestoredAt = {};
});

test("archives from the list, restores from Archived, and survives a remount", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity },
    },
  });
  const renderWorkspace = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceScreen
          navigation={{ navigate: jest.fn() } as never}
          route={{ key: "workspace", name: "Workspace" } as never}
        />
      </QueryClientProvider>,
    );
  let view = renderWorkspace();
  const session = screen.getByRole("button", { name: /^Open session Session 0\./ });
  await waitFor(() =>
    expect(session.props.accessibilityActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "archive" })]),
    ),
  );
  fireEvent(session, "accessibilityAction", { nativeEvent: { actionName: "archive" } });
  await waitFor(() => expect(screen.queryByText("Session 0")).not.toBeOnTheScreen());
  expect(mockArchivedIds).toContain("ses_0");
  view.unmount();
  queryClient.clear();
  view = renderWorkspace();
  await screen.findByText("Session 1");
  await waitFor(() => expect(screen.queryByText("Session 0")).not.toBeOnTheScreen());
  fireEvent.press(screen.getByRole("button", { name: "Archived" }));
  const archived = await screen.findByRole("button", { name: /^Open session Session 0\./ });
  fireEvent(archived, "accessibilityAction", { nativeEvent: { actionName: "archive" } });
  await waitFor(() => expect(screen.queryByText("Session 0")).not.toBeOnTheScreen());
  fireEvent.press(screen.getByRole("button", { name: "Inbox" }));
  expect(await screen.findByText("Session 0")).toBeOnTheScreen();
  expect(mockArchivedIds).not.toContain("ses_0");
  view.unmount();
  queryClient.clear();
});

test("failed archive writes keep the session in the inbox", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  mockArchiveWriteFailure = true;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>,
  );
  const session = screen.getByRole("button", { name: /^Open session Session 0\./ });
  await waitFor(() =>
    expect(session.props.accessibilityActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "archive" })]),
    ),
  );
  fireEvent(session, "accessibilityAction", { nativeEvent: { actionName: "archive" } });
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith("Archive preference not saved", expect.any(String)),
  );
  expect(screen.getByText("Session 0")).toBeOnTheScreen();
  mockArchiveWriteFailure = false;
  alert.mockRestore();
  view.unmount();
  queryClient.clear();
});

test("an archived working session stays in the inbox until it becomes idle", async () => {
  mockArchivedIds = ["ses_0"];
  mockWorkspaceActive = true;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const content = (
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>
  );
  const view = render(content);
  expect(await screen.findByText("Archived on this device")).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: /^Open session Session 0\. Workspace\. Working/ }),
  ).toBeOnTheScreen();
  mockWorkspaceActive = false;
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{ key: "workspace", name: "Workspace" } as never}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText("Session 0")).not.toBeOnTheScreen());
  mockArchivedIds = [];
  view.unmount();
  queryClient.clear();
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
  expect(screen.getByRole("button", { name: "Inbox" }).props.accessibilityState).toEqual({
    selected: true,
  });
  expect(screen.getByRole("button", { name: "Archived" })).toBeOnTheScreen();
  expect(screen.getByText("Recent")).toBeOnTheScreen();
  const list = screen.UNSAFE_getByType(FlatList);
  expect(list.props.data.filter((item: { type: string }) => item.type === "session")).toHaveLength(
    20,
  );
  expect(screen.getByText("20")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
  expect(screen.getByRole("button", { name: "Load older sessions" })).toBeOnTheScreen();
  fireEvent.changeText(screen.getByLabelText("Search sessions"), "Session");
  await waitFor(() => expect(screen.getByText("Search results")).toBeOnTheScreen());
  expect(list.props.data.filter((item: { type: string }) => item.type === "session")).toHaveLength(
    120,
  );
  fireEvent.press(screen.getByRole("button", { name: "Clear session search" }));
  await waitFor(() => expect(screen.getByText("Recent")).toBeOnTheScreen());
  expect(screen.queryByText("Succeeded")).toBeNull();

  expect(screen.queryByRole("button", { name: "New" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Manage connections/ })).toBeNull();
  expect(mockWorkspaceRefetch).not.toHaveBeenCalled();

  view.unmount();
  queryClient.clear();
});

test("retains the in-content Sessions title in the tablet shell", async () => {
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

    expect(await screen.findByRole("header", { name: "Sessions" })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "New session" }));
    expect(navigate).toHaveBeenCalledWith("NewSession");
  } finally {
    view?.unmount();
    queryClient.clear();
    Dimensions.set({ screen: originalScreen, window: originalWindow });
  }
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
  fireEvent.press(screen.getByRole("button", { name: "Scroll to latest" }));
  fireEvent.scroll(transcript, scrollEvent(120));
  expect(screen.getByRole("button", { name: "Scroll to latest" })).toBeOnTheScreen();
  fireEvent(transcript, "momentumScrollEnd", liveEdgeEvent);
  expect(screen.queryByRole("button", { name: "Scroll to latest" })).toBeNull();

  view.unmount();
  queryClient.clear();
  scrollToOffset.mockRestore();
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
  fireEvent.press(screen.getByRole("button", { name: "Open child" }));
  expect(push).toHaveBeenCalledWith("Session", {
    connectionId: "connection-1",
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
