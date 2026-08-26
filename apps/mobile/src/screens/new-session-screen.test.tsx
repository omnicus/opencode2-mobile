import { beforeEach, expect, jest, test } from "@jest/globals";
import {
  createOpenCodeSession,
  getDefaultOpenCodeLocation,
  getOpenCodeLocation,
} from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { NewSessionScreen } from "./new-session-screen";

const alpha = {
  canonical: "/projects/alpha",
  id: "project-alpha",
  name: "Alpha",
  sandboxes: [],
  time: { created: 1, updated: 1 },
};
const beta = {
  canonical: "/projects/beta",
  id: "project-beta",
  name: "Beta",
  sandboxes: ["/worktrees/beta-feature"],
  time: { created: 1, updated: 1 },
};
const alphaLocation = {
  directory: alpha.canonical,
  project: { canonical: alpha.canonical, directory: alpha.canonical, id: alpha.id },
  workspaceID: "workspace-alpha",
};
const betaLocation = {
  directory: "/worktrees/beta-feature",
  project: { canonical: beta.canonical, directory: beta.canonical, id: beta.id },
  workspaceID: "workspace-beta",
};
const mockSetFollowedProjectIds = jest.fn<(...args: unknown[]) => Promise<void>>(
  async () => undefined,
);
const mockRefetch = jest.fn<() => Promise<void>>(async () => undefined);
let mockSelection: Record<string, unknown>;

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  createOpenCodeSession: jest.fn(),
  getDefaultOpenCodeLocation: jest.fn(),
  getOpenCodeLocation: jest.fn(),
}));
jest.mock("../state/connection-runtime-context", () => ({
  useConnectionRuntime: () => ({ connectionId: "connection-1", restClient: {} }),
}));
jest.mock("../state/workspace-selection-context", () => ({
  useWorkspaceSelection: () => mockSelection,
}));
jest.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Success: "success" },
  notificationAsync: jest.fn(async () => undefined),
}));

const mockCreateSession = jest.mocked(createOpenCodeSession);
const mockGetDefaultLocation = jest.mocked(getDefaultOpenCodeLocation);
const mockGetLocation = jest.mocked(getOpenCodeLocation);

beforeEach(() => {
  jest.clearAllMocks();
  mockSelection = {
    followedProjectIds: [alpha.id],
    preferencesError: false,
    preferencesLoading: false,
    preferencesSaving: false,
    projects: [alpha, beta],
    projectsError: false,
    projectsLoading: false,
    refetch: mockRefetch,
    setFollowedProjectIds: mockSetFollowedProjectIds,
  };
  mockGetDefaultLocation.mockResolvedValue(alphaLocation);
  mockGetLocation.mockImplementation(async (_client, requested) =>
    requested.directory === betaLocation.directory ? betaLocation : alphaLocation,
  );
  mockCreateSession.mockImplementation(async (_client, location) => ({
    cost: 0,
    id: "ses-created",
    location,
    projectID: location.directory === betaLocation.directory ? beta.id : alpha.id,
    time: { created: 2, updated: 2 },
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  }));
});

test("shows followed projects first and reveals other projects through browse and search", async () => {
  renderScreen();

  expect(await screen.findByText("Followed projects")).toBeOnTheScreen();
  expect(screen.getByText("Alpha")).toBeOnTheScreen();
  expect(screen.queryByText("Beta")).toBeNull();

  fireEvent.press(screen.getByRole("button", { name: "Browse all projects" }));
  expect(await screen.findByText("Other projects")).toBeOnTheScreen();
  expect(screen.getByText("Beta")).toBeOnTheScreen();
  fireEvent.changeText(screen.getByLabelText("Search projects"), "beta-feature");
  await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
  expect(screen.getByText("Beta")).toBeOnTheScreen();
});

test("creates in a followed project's only location and replaces the modal", async () => {
  const navigation = { goBack: jest.fn(), replace: jest.fn() };
  mockRefetch.mockImplementationOnce(() => new Promise(() => undefined));
  renderScreen(navigation);

  fireEvent.press(await screen.findByRole("button", { name: /Alpha, followed/ }));

  await waitFor(() =>
    expect(mockGetLocation).toHaveBeenCalledWith(
      {},
      { directory: alpha.canonical, workspaceID: "workspace-alpha" },
      expect.anything(),
    ),
  );
  await waitFor(() =>
    expect(mockCreateSession).toHaveBeenCalledWith({}, alphaLocation, {}, expect.anything()),
  );
  expect(mockSetFollowedProjectIds).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith("Session", {
      connectionId: "connection-1",
      focusComposer: true,
      location: alphaLocation,
      sessionID: "ses-created",
    }),
  );
});

test("waits for the default location before enabling project selection", async () => {
  let resolveDefault: ((location: typeof alphaLocation) => void) | undefined;
  mockGetDefaultLocation.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveDefault = resolve;
      }),
  );
  renderScreen();

  expect(await screen.findByLabelText("Loading projects")).toBeOnTheScreen();
  expect(screen.queryByText("Alpha")).toBeNull();
  await act(async () => resolveDefault?.(alphaLocation));
  expect(await screen.findByText("Alpha")).toBeOnTheScreen();
});

test("chooses a worktree and follows an unfollowed project before creation", async () => {
  const navigation = { goBack: jest.fn(), replace: jest.fn() };
  renderScreen(navigation);
  fireEvent.press(await screen.findByRole("button", { name: "Browse all projects" }));
  fireEvent.press(await screen.findByRole("button", { name: /Beta, not followed/ }));

  expect(await screen.findByRole("header", { name: "Choose location" })).toBeOnTheScreen();
  expect(mockCreateSession).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: /Worktree 1/ }));

  await waitFor(() => expect(mockSetFollowedProjectIds).toHaveBeenCalledWith([alpha.id, beta.id]));
  await waitFor(() =>
    expect(mockCreateSession).toHaveBeenCalledWith({}, betaLocation, {}, expect.anything()),
  );
  expect(mockSetFollowedProjectIds.mock.invocationCallOrder[0]).toBeLessThan(
    mockCreateSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
  );
  await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
});

test("does not create when adding an unfollowed project fails", async () => {
  mockSetFollowedProjectIds.mockRejectedValueOnce(new Error("storage failed"));
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: "Browse all projects" }));
  fireEvent.press(await screen.findByRole("button", { name: /Beta, not followed/ }));
  fireEvent.press(screen.getByRole("button", { name: /Worktree 1/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be created/i);
  expect(mockCreateSession).not.toHaveBeenCalled();
});

function renderScreen(navigation = { goBack: jest.fn(), replace: jest.fn() }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { gcTime: Number.POSITIVE_INFINITY, networkMode: "always" },
      queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NewSessionScreen
        navigation={navigation as never}
        route={{ key: "new-session", name: "NewSession" } as never}
      />
    </QueryClientProvider>,
  );
}
