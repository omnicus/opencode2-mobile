import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import type {
  FormInfo,
  LocationRef,
  PermissionReply,
  PermissionRequest,
} from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { FollowedProjectsProvider, useFollowedProjects } from "./followed-projects-context";

type InteractionOutput<T> = { data: T[]; location: ReturnType<typeof mockResolvedLocation> };
type ListFormsCall = (
  client: unknown,
  location: LocationRef,
  options?: { signal?: AbortSignal },
) => Promise<InteractionOutput<FormInfo>>;
type ListPermissionsCall = (
  client: unknown,
  location: LocationRef,
  options?: { signal?: AbortSignal },
) => Promise<InteractionOutput<PermissionRequest>>;
type ReplyPermissionCall = (
  client: unknown,
  sessionID: string,
  requestID: string,
  reply: PermissionReply,
) => Promise<unknown>;

const mockListForms = jest.fn<ListFormsCall>();
const mockListPermissions = jest.fn<ListPermissionsCall>();
const mockGetOpenCodeLocation = jest.fn(async (_client: unknown, location: { directory: string }) =>
  mockResolvedLocation(
    location.directory,
    location.directory.startsWith("/b") ? "project-b" : "project-a",
  ),
);
type ListProjectSessionsCall = (
  client: unknown,
  projectID: string,
  input: { search?: string },
  options?: { signal?: AbortSignal },
) => Promise<{ cursor: { next?: string }; data: ReturnType<typeof mockSession>[] }>;
const defaultListProjectSessions: ListProjectSessionsCall = async (_client, projectID) => ({
  cursor: {},
  data: [
    projectID === "project-a"
      ? mockSession("ses_alpha", projectID, "/a", 3)
      : mockSession("ses_beta", projectID, "/b/sub", 2),
  ],
});
const mockListProjectSessions = jest.fn<ListProjectSessionsCall>(defaultListProjectSessions);
const mockReplyPermission = jest.fn<ReplyPermissionCall>();
let mockEventLocations: LocationRef[] = [];
let mockRevision = 1;
let mockStatus: "connected" | "offline" = "connected";
let mockConnectionUpdatedAtMs = 1;
const mockTransaction = {
  getFirstAsync: jest.fn(async () => ({ updated_at_ms: mockConnectionUpdatedAtMs })),
  runAsync: jest.fn(async () => undefined),
};
const mockDb = {
  getAllAsync: jest.fn(async () => [{ project_id: "project-a" }, { project_id: "project-b" }]),
  getFirstAsync: jest.fn<() => Promise<{ connection_id: string } | null>>(async () => ({
    connection_id: "connection-1",
  })),
  withExclusiveTransactionAsync: jest.fn(
    async (task: (transaction: typeof mockTransaction) => Promise<void>) => task(mockTransaction),
  ),
};

jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  getDefaultOpenCodeLocation: jest.fn(async () => mockResolvedLocation("/a", "project-a")),
  getOpenCodeLocation: (...args: Parameters<typeof mockGetOpenCodeLocation>) =>
    mockGetOpenCodeLocation(...args),
  getOpenCodeSession: jest.fn(async (_client: unknown, sessionID: string) => {
    if (sessionID === "ses_child") {
      return { ...mockSession("ses_child", "project-a", "/a", 4), parentID: "ses_alpha" };
    }
    return mockSession(sessionID, "project-a", "/a", 3);
  }),
  listActiveOpenCodeSessions: jest.fn(async () => ({ ses_child: { type: "running" } })),
  listOpenCodeFormRequests: (...args: Parameters<ListFormsCall>) => mockListForms(...args),
  listOpenCodePermissionRequests: (...args: Parameters<ListPermissionsCall>) =>
    mockListPermissions(...args),
  listOpenCodeProjects: jest.fn(async () => [
    {
      canonical: "/a",
      id: "project-a",
      name: "Alpha",
      sandboxes: [],
      time: { created: 1, updated: 1 },
    },
    {
      canonical: "/b",
      id: "project-b",
      name: "Beta",
      sandboxes: [],
      time: { created: 1, updated: 1 },
    },
  ]),
  listOpenCodeProjectSessions: (...args: Parameters<typeof mockListProjectSessions>) =>
    mockListProjectSessions(...args),
  replyOpenCodePermissionRequest: (...args: Parameters<ReplyPermissionCall>) =>
    mockReplyPermission(...args),
}));
jest.mock("./connection-runtime-context", () => ({
  useConnectionRuntime: () => ({
    connectionId: "connection-1",
    connectionUpdatedAtMs: mockConnectionUpdatedAtMs,
    eventLocations: mockEventLocations,
    reconciliationRevision: mockRevision,
    restClient: {},
    status: mockStatus,
  }),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockEventLocations = [];
  mockRevision = 1;
  mockStatus = "connected";
  mockConnectionUpdatedAtMs = 1;
  mockDb.getAllAsync.mockImplementation(async () => [
    { project_id: "project-a" },
    { project_id: "project-b" },
  ]);
  mockDb.getFirstAsync.mockImplementation(async () => ({ connection_id: "connection-1" }));
  mockDb.withExclusiveTransactionAsync.mockImplementation(
    async (task: (transaction: typeof mockTransaction) => Promise<void>) => task(mockTransaction),
  );
  mockDb.withExclusiveTransactionAsync.mockClear();
  mockTransaction.getFirstAsync.mockImplementation(async () => ({
    updated_at_ms: mockConnectionUpdatedAtMs,
  }));
  mockTransaction.runAsync.mockClear();
  mockListProjectSessions.mockReset();
  mockListProjectSessions.mockImplementation(defaultListProjectSessions);
  mockListForms.mockReset();
  mockListPermissions.mockReset();
  mockGetOpenCodeLocation.mockReset();
  mockGetOpenCodeLocation.mockImplementation(async (_client, location) =>
    mockResolvedLocation(
      location.directory,
      location.directory.startsWith("/b") ? "project-b" : "project-a",
    ),
  );
  mockReplyPermission.mockReset();
  mockReplyPermission.mockResolvedValue(undefined);
  mockListPermissions.mockImplementation(async (_client, location) => ({
    data:
      location.directory === "/a"
        ? [{ action: "shell", id: "per_child", resources: [], sessionID: "ses_child" }]
        : [],
    location: mockResolvedLocation(
      location.directory,
      location.directory.startsWith("/b") ? "project-b" : "project-a",
    ),
  }));
  mockListForms.mockImplementation(async (_client, location) => ({
    data:
      location.directory === "/b/sub"
        ? [
            {
              fields: [{ key: "answer", type: "string" as const }],
              id: "form_beta",
              sessionID: "ses_beta",
              title: "Input",
            },
          ]
        : [],
    location: mockResolvedLocation(
      location.directory,
      location.directory.startsWith("/b") ? "project-b" : "project-a",
    ),
  }));
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("aggregates exact followed-project locations and bubbles child attention", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FollowedProjectsProvider>
        <Capture />
      </FollowedProjectsProvider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByText("complete:2:2:0")).toBeOnTheScreen());
  expect(screen.getByText("Alpha:ses_child:1:1")).toBeOnTheScreen();
  expect(screen.getByText("Beta:ses_beta:0:1")).toBeOnTheScreen();
  expect(mockListPermissions.mock.calls.map((call) => call[1].directory).sort()).toEqual([
    "/a",
    "/b",
    "/b/sub",
  ]);

  view.unmount();
  queryClient.clear();
});

test("does not treat normal session pagination as failed attention coverage", async () => {
  mockListProjectSessions.mockImplementation(async (_client, projectID) => ({
    cursor: { next: "older" },
    data: [
      projectID === "project-a"
        ? mockSession("ses_alpha", projectID, "/a", 3)
        : mockSession("ses_beta", projectID, "/b/sub", 2),
    ],
  }));
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FollowedProjectsProvider>
        <Capture />
      </FollowedProjectsProvider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByText("complete:2:2:0")).toBeOnTheScreen());
  view.unmount();
  queryClient.clear();
});

test("keeps permission replies attached to the request's exact location", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FollowedProjectsProvider>
        <Capture />
      </FollowedProjectsProvider>
    </QueryClientProvider>,
  );

  await screen.findByRole("button", { name: "Allow once" });
  fireEvent.press(screen.getByRole("button", { name: "Allow once" }));
  await waitFor(() =>
    expect(mockReplyPermission).toHaveBeenCalledWith(
      expect.anything(),
      "ses_child",
      "per_child",
      "once",
    ),
  );
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));

  view.unmount();
  queryClient.clear();
});

test("starts a fresh reconciliation revision and includes event locations", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const renderTree = () => (
    <QueryClientProvider client={queryClient}>
      <FollowedProjectsProvider>
        <Capture />
      </FollowedProjectsProvider>
    </QueryClientProvider>
  );
  const view = render(renderTree());
  await waitFor(() => expect(screen.getByText("complete:2:2:0")).toBeOnTheScreen());
  expect(mockListProjectSessions).toHaveBeenCalledTimes(2);

  mockRevision = 2;
  mockEventLocations = [{ directory: "/a/event" }];
  view.rerender(renderTree());

  await waitFor(() => expect(mockListProjectSessions).toHaveBeenCalledTimes(4));
  await waitFor(() =>
    expect(mockListPermissions.mock.calls.some((call) => call[1].directory === "/a/event")).toBe(
      true,
    ),
  );

  view.unmount();
  queryClient.clear();
});

test("keeps blocked work visible through disconnect and foreground reconciliation", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const renderTree = () => (
    <QueryClientProvider client={queryClient}>
      <FollowedProjectsProvider>
        <Capture />
      </FollowedProjectsProvider>
    </QueryClientProvider>
  );
  const view = render(renderTree());
  await waitFor(() => expect(screen.getByText("freshness:current")).toBeOnTheScreen());
  expect(screen.getByText("Alpha:ses_child:1:1")).toBeOnTheScreen();

  mockStatus = "offline";
  view.rerender(renderTree());
  expect(screen.getByText("freshness:stale")).toBeOnTheScreen();
  expect(screen.getByText("Alpha:ses_child:1:1")).toBeOnTheScreen();

  mockStatus = "connected";
  mockRevision += 1;
  view.rerender(renderTree());
  await waitFor(() => expect(screen.getByText("freshness:current")).toBeOnTheScreen());
  expect(screen.getByText("Alpha:ses_child:1:1")).toBeOnTheScreen();

  view.unmount();
  queryClient.clear();
});

test("reloads followed IDs when the same profile points at a replacement server", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const renderTree = () => (
    <QueryClientProvider client={queryClient}>
      <FollowedProjectsProvider>
        <Capture />
      </FollowedProjectsProvider>
    </QueryClientProvider>
  );
  const view = render(renderTree());
  await waitFor(() => expect(screen.getByText("followed:project-a,project-b")).toBeOnTheScreen());

  mockDb.getAllAsync.mockResolvedValueOnce([]);
  mockConnectionUpdatedAtMs = 2;
  view.rerender(renderTree());

  await waitFor(() => expect(screen.getByText("followed:")).toBeOnTheScreen());
  view.unmount();
  queryClient.clear();
});

test("counts a failed permission and form pair as one failed location", async () => {
  mockListPermissions.mockImplementation(async (_client, location) => {
    if (location.directory === "/a") throw new Error("offline");
    return { data: [], location: mockResolvedLocation(location.directory, "project-b") };
  });
  mockListForms.mockImplementation(async (_client, location) => {
    if (location.directory === "/a") throw new Error("offline");
    return { data: [], location: mockResolvedLocation(location.directory, "project-b") };
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FollowedProjectsProvider>
        <Capture />
      </FollowedProjectsProvider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByText("locations:1:2")).toBeOnTheScreen());
  expect(screen.getByText("failed:Alpha:1")).toBeOnTheScreen();
  view.unmount();
  queryClient.clear();
});

test("drops cached locations and attention when a project is unfollowed", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FollowedProjectsProvider>
        <Capture />
      </FollowedProjectsProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("complete:2:2:0")).toBeOnTheScreen());

  fireEvent.press(screen.getByRole("button", { name: "Select Alpha location" }));
  fireEvent.press(screen.getByRole("button", { name: "Follow only Beta" }));

  await waitFor(() => expect(screen.getByText("followed:project-b")).toBeOnTheScreen());
  await waitFor(() => expect(screen.getByText("complete:1:1:0")).toBeOnTheScreen());
  expect(screen.queryByText(/^Alpha:/)).not.toBeOnTheScreen();
  view.unmount();
  queryClient.clear();
});

test("contains automatic first-follow persistence failures", async () => {
  mockDb.getAllAsync.mockResolvedValueOnce([]);
  mockDb.getFirstAsync.mockResolvedValueOnce(null);
  mockDb.withExclusiveTransactionAsync.mockRejectedValueOnce(new Error("disk full"));
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FollowedProjectsProvider>
        <Capture />
      </FollowedProjectsProvider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByText("preferences:error")).toBeOnTheScreen());
  expect(mockDb.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
  view.unmount();
  queryClient.clear();
});

test("refreshes the displayed project search instead of the unfiltered feed", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always" },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FollowedProjectsProvider>
        <Capture />
      </FollowedProjectsProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mockListProjectSessions).toHaveBeenCalled());
  fireEvent.press(screen.getByRole("button", { name: "Search sessions" }));
  await waitFor(() =>
    expect(mockListProjectSessions.mock.calls.some((call) => call[2].search === "needle")).toBe(
      true,
    ),
  );
  mockListProjectSessions.mockClear();

  fireEvent.press(screen.getByRole("button", { name: "Refresh sessions" }));

  await waitFor(() => expect(mockListProjectSessions).toHaveBeenCalled());
  expect(mockListProjectSessions.mock.calls.some((call) => call[2].search === "needle")).toBe(true);
  expect(mockListProjectSessions.mock.calls.some((call) => call[2].search === undefined)).toBe(
    true,
  );
  view.unmount();
  queryClient.clear();
});

function Capture() {
  const state = useFollowedProjects();
  return (
    <>
      <Text>
        {state.attentionCoverage.completeness}:{state.pendingCount}:{state.inbox.needsYou.length}:
        {state.inbox.working.length}
      </Text>
      <Text>freshness:{state.attentionCoverage.freshness}</Text>
      <Text>followed:{state.followedProjectIds.join(",")}</Text>
      <Text>preferences:{state.preferencesError ? "error" : "ok"}</Text>
      <Text>
        locations:{state.attentionCoverage.failedLocationCount}:
        {state.attentionCoverage.reconciledLocationCount}
      </Text>
      <Text>
        failed:
        {state.attentionCoverage.failedProjects
          .map((project) => `${project.label}:${project.locationCount}`)
          .join(",")}
      </Text>
      {state.inbox.needsYou.map((row) => (
        <Text key={row.session.id}>
          {row.projectLabel}:{row.targetSessionID}:{row.activeChildCount}:{row.attentionCount}
        </Text>
      ))}
      {state.permissions[0] ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            state.replyPermission(
              state.permissions[0]?.id ?? "",
              state.permissions[0]?.sessionID ?? "",
              "once",
            )
          }
        >
          <Text>Allow once</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel="Follow only Beta"
        accessibilityRole="button"
        onPress={() => void state.setFollowedProjectIds(["project-b"])}
      >
        <Text>Follow only Beta</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Select Alpha location"
        accessibilityRole="button"
        onPress={() => state.setLocation({ directory: "/a" })}
      >
        <Text>Select Alpha location</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Search sessions"
        accessibilityRole="button"
        onPress={() => state.setSearch("needle")}
      >
        <Text>Search sessions</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Refresh sessions"
        accessibilityRole="button"
        onPress={() => void state.refetch()}
      >
        <Text>Refresh sessions</Text>
      </Pressable>
    </>
  );
}

function mockResolvedLocation(directory: string, projectID: string) {
  return {
    directory,
    project: { canonical: projectID === "project-a" ? "/a" : "/b", directory, id: projectID },
  };
}

function mockSession(id: string, projectID: string, directory: string, updated: number) {
  return {
    cost: 0,
    id,
    location: { directory },
    projectID,
    time: { created: updated, updated },
    title: id,
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  };
}
