import { expect, jest, test } from "@jest/globals";
import {
  getOpenCodeLocation,
  getOpenCodeSession,
  listOpenCodeMessages,
  type PermissionRequest,
  type SessionMessageInfo,
  type SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";
import { type InfiniteData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Dimensions, FlatList, Platform, RefreshControl } from "react-native";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { WorkspaceSelectionProvider } from "../state/workspace-selection-context";
import { SessionScreen, WorkspaceScreen } from "./workspace-screen";

const location = {
  directory: "/workspace",
  project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
};
const mockListForms = jest.fn(async () => ({ data: [], location }));
const mockListPermissions = jest.fn(async () => ({ data: [], location }));
const mockReplyPermission = jest.fn();
const mockSetLocation = jest.fn();
const mockWorkspaceRefetch = jest.fn<() => Promise<void>>(async () => undefined);
let mockWorkspacePermissions: PermissionRequest[] = [];
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
  interruptOpenCodeSession: jest.fn(),
  listActiveOpenCodeSessions: jest.fn(async () => ({})),
  listOpenCodeAgents: jest.fn(async () => ({ data: [], location })),
  listOpenCodeFormRequests: mockListForms,
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
                  { text: "Private reasoning", type: "reasoning" },
                  { text: "Detailed reasoning\nSecond step", type: "reasoning" },
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
  listOpenCodePermissionRequests: mockListPermissions,
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
      time: { created: 120 - index, updated: 120 - index },
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
      completeness: "complete",
      failedLocationCount: 0,
      knownLocationCount: 1,
      reasons: [],
      reconciledLocationCount: 1,
      revision: 1,
    },
    blockedSessionIds: new Set(mockWorkspacePermissions.map((request) => request.sessionID)),
    fetchNextPage: jest.fn(async () => undefined),
    followedProjectIds: ["project-1"],
    formLocations: new Map(),
    forms: [],
    hasNextPage: false,
    inbox: {
      needsYou: [],
      recent: Array.from({ length: 120 }, (_, index) => {
        const session = {
          cost: 0,
          id: `ses_${index}`,
          location: { directory: "/workspace" },
          projectID: "project-1",
          time: { created: 120 - index, updated: 120 - index },
          title: `Session ${index}`,
          tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
        };
        return {
          active: false,
          activeChildCount: 0,
          attentionCount: 0,
          children: [],
          projectLabel: "Workspace",
          section: "recent",
          session,
          targetLocation: session.location,
          targetSessionID: session.id,
        };
      }),
      unmatchedSessionIDs: [],
      working: [],
    },
    interactionsError: false,
    interactionsLoading: false,
    pendingCount: mockWorkspacePermissions.length,
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
    sessionsError: false,
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
const mockListMessages = jest.mocked(listOpenCodeMessages);

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
        navigation={{ goBack: jest.fn(), navigate: jest.fn() } as never}
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
        navigation={{ goBack: jest.fn(), navigate: jest.fn() } as never}
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
    expect(await screen.findByText("PERMISSION REQUIRED")).toBeOnTheScreen();
    expect(screen.getByLabelText("Keyboard composer dock")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Allow once" }));
    expect(mockReplyPermission).toHaveBeenCalledWith("per_test", "ses_transcript", "once");
  } finally {
    mockWorkspacePermissions = [];
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

  expect(screen.getByRole("button", { name: "New" })).toBeOnTheScreen();
  expect(screen.queryByLabelText(/Change new session location/)).toBeNull();
  expect(screen.UNSAFE_getByType(FlatList).props.maintainVisibleContentPosition).toBeUndefined();

  await act(async () => resolveLocation?.(location));
  view.unmount();
  queryClient.clear();
});

test("opens project selection before creating a session", async () => {
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
  expect(screen.queryByText("Inbox")).toBeNull();
  expect(screen.getByText("Recent")).toBeOnTheScreen();
  expect(screen.queryByText("Succeeded")).toBeNull();

  const newButton = screen.getByRole("button", { name: "New" });
  expect(newButton).toBeEnabled();
  fireEvent.press(newButton);
  expect(navigation.navigate).toHaveBeenCalledWith("NewSession");
  expect(mockWorkspaceRefetch).not.toHaveBeenCalled();

  view.unmount();
  queryClient.clear();
});

test("retains the in-content Sessions title in the tablet shell", async () => {
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
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: "workspace", name: "Workspace" } as never}
          />
        </WorkspaceSelectionProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("header", { name: "Sessions" })).toBeOnTheScreen();
  } finally {
    view?.unmount();
    queryClient.clear();
    Dimensions.set({ screen: originalScreen, window: originalWindow });
  }
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
        navigation={{ goBack: jest.fn(), navigate: jest.fn() } as never}
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
    position: "relative",
  });
  expect(screen.getByText("Latest").props.dynamicTypeRamp).toBe("footnote");

  fireEvent(transcript, "scrollBeginDrag", justAwayFromLiveEdge);
  fireEvent.scroll(transcript, liveEdgeEvent);
  expect(screen.getByRole("button", { name: "Scroll to latest" })).toBeOnTheScreen();
  fireEvent(transcript, "momentumScrollEnd", liveEdgeEvent);
  expect(screen.queryByRole("button", { name: "Scroll to latest" })).toBeNull();
  scrollToOffset.mockClear();
  fireEvent(transcript, "contentSizeChange", 320, 1_100);
  await waitFor(() => expect(scrollToOffset).toHaveBeenCalledWith({ animated: false, offset: 0 }));

  fireEvent(transcript, "scrollBeginDrag", liveEdgeEvent);
  fireEvent.scroll(transcript, justAwayFromLiveEdge);
  fireEvent(transcript, "momentumScrollEnd", justAwayFromLiveEdge);
  scrollToOffset.mockClear();
  fireEvent(transcript, "contentSizeChange", 320, 1_200);
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
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), push } as never}
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
        navigation={{ goBack: jest.fn(), navigate: jest.fn(), push: jest.fn() } as never}
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
        navigation={{ goBack: jest.fn(), navigate: jest.fn() } as never}
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
    expect(screen.getByText("Test server").props.numberOfLines).toBe(1);
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
      position: "relative",
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
    expect(screen.getByText("Test server").props.numberOfLines).toBeUndefined();
    expect(screen.getByText("Test server")).toHaveStyle({ flex: 0, width: "100%" });

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
      position: "relative",
    });
  } finally {
    act(() => {
      Dimensions.set({ screen: originalScreen, window: originalWindow });
    });
    view.unmount();
    queryClient.clear();
  }
});
