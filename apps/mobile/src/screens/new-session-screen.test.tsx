import { beforeEach, expect, jest, test } from "@jest/globals";
import {
  createOpenCodeSession,
  getDefaultOpenCodeLocation,
  getOpenCodeLocation,
} from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { projectAvatarPalette } from "../theme";
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
jest.mock("react-native-keyboard-controller", () =>
  jest.requireActual("react-native-keyboard-controller/jest"),
);
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

test("project rows show the project's avatar color next to the title", async () => {
  mockSelection.projects = [{ ...alpha, icon: { color: "pink" } }, beta];
  renderScreen();

  expect(await screen.findByText("Alpha")).toBeOnTheScreen();
  expect(screen.getByTestId("project-avatar-letter", { includeHiddenElements: true })).toHaveStyle({
    backgroundColor: projectAvatarPalette.colors.pink.fill,
  });
  expect(screen.getByText("A", { includeHiddenElements: true })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Alpha, followed, /projects/alpha" }),
  ).toBeOnTheScreen();
});

test("creates in a followed project's only location and replaces the modal", async () => {
  const navigation = mockNavigation();
  mockRefetch.mockImplementationOnce(() => new Promise(() => undefined));
  renderScreen(navigation);

  fireEvent.press(await screen.findByRole("button", { name: /Alpha, followed/ }));

  await waitFor(() =>
    expect(mockGetLocation).toHaveBeenCalledWith(
      {},
      { directory: alpha.canonical },
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
  const navigation = mockNavigation();
  renderScreen(navigation);
  fireEvent.press(await screen.findByRole("button", { name: "Browse all projects" }));
  fireEvent.press(await screen.findByRole("button", { name: /Beta, not followed/ }));

  expect(await screen.findByRole("header", { name: "Choose location" })).toBeOnTheScreen();
  expect(mockCreateSession).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: /^beta-feature,/ }));

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
  fireEvent.press(screen.getByRole("button", { name: /^beta-feature,/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be created/i);
  expect(mockCreateSession).not.toHaveBeenCalled();
});

test("puts Cancel on the leading side of the header", async () => {
  renderScreen();
  await screen.findByText("Alpha");
  expect(screen.getAllByRole("button")[0]).toHaveAccessibleName("Cancel");
});

test("labels locations by directory name", async () => {
  mockGetDefaultLocation.mockResolvedValue({
    ...betaLocation,
    directory: "/projects/beta/nested",
  });
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: "Browse all projects" }));
  fireEvent.press(await screen.findByRole("button", { name: /Beta, not followed/ }));
  expect(await screen.findByRole("button", { name: /^Main directory,/ })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Server's working directory,/ })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^beta-feature, / })).toBeOnTheScreen();
  expect(screen.queryByText(/Worktree \d/)).toBeNull();
});

test("back and the swipe gesture return from the location step to Projects", async () => {
  const navigation = mockNavigation();
  renderScreen(navigation);
  fireEvent.press(await screen.findByRole("button", { name: "Browse all projects" }));
  fireEvent.press(await screen.findByRole("button", { name: /Beta, not followed/ }));
  await screen.findByRole("header", { name: "Choose location" });
  expect(navigation.setOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });

  const back = removeEvent("GO_BACK");
  act(() => navigation.emitBeforeRemove(back));
  expect(back.preventDefault).toHaveBeenCalled();
  expect(await screen.findByRole("header", { name: "New session" })).toBeOnTheScreen();
  expect(navigation.setOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });

  const close = removeEvent("GO_BACK");
  act(() => navigation.emitBeforeRemove(close));
  expect(close.preventDefault).not.toHaveBeenCalled();
});

test("Cancel closes the sheet from the location step", async () => {
  const navigation = mockNavigation();
  navigation.goBack.mockImplementation(() => {
    navigation.emitBeforeRemove(removeEvent("GO_BACK"));
  });
  renderScreen(navigation);
  fireEvent.press(await screen.findByRole("button", { name: "Browse all projects" }));
  fireEvent.press(await screen.findByRole("button", { name: /Beta, not followed/ }));
  await screen.findByRole("header", { name: "Choose location" });
  fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("header", { name: "Choose location" })).toBeOnTheScreen();
});

test("does not block leaving while a session is being created", async () => {
  const navigation = mockNavigation();
  mockCreateSession.mockImplementationOnce(() => new Promise(() => undefined));
  renderScreen(navigation);
  fireEvent.press(await screen.findByRole("button", { name: "Browse all projects" }));
  fireEvent.press(await screen.findByRole("button", { name: /Beta, not followed/ }));
  fireEvent.press(await screen.findByRole("button", { name: /^beta-feature,/ }));
  await waitFor(() => expect(mockCreateSession).toHaveBeenCalled());
  expect(navigation.setOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  const back = removeEvent("GO_BACK");
  act(() => navigation.emitBeforeRemove(back));
  expect(back.preventDefault).not.toHaveBeenCalled();
});

test("shows progress in the tapped row and announces it", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  mockCreateSession.mockImplementationOnce(() => new Promise(() => undefined));
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: /Alpha, followed/ }));
  const row = await screen.findByRole("button", { name: /Alpha, followed.*creating session$/ });
  expect(row).toHaveProp("accessibilityState", expect.objectContaining({ busy: true }));
  expect(announce).toHaveBeenCalledWith("Creating session");
  announce.mockRestore();
});

test("a location that moved to another project returns to Projects and reloads them", async () => {
  mockGetLocation.mockResolvedValue(alphaLocation);
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: "Browse all projects" }));
  fireEvent.press(await screen.findByRole("button", { name: /Beta, not followed/ }));
  fireEvent.press(await screen.findByRole("button", { name: /^beta-feature,/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The project list changed. Choose the project again.",
  );
  expect(screen.getByRole("header", { name: "New session" })).toBeOnTheScreen();
  expect(mockRefetch).toHaveBeenCalled();
  expect(mockCreateSession).not.toHaveBeenCalled();
});

test("cancels a pending creation without showing an error", async () => {
  mockGetLocation.mockImplementationOnce(
    (_client, _requested, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const navigation = mockNavigation();
  renderScreen(navigation);
  fireEvent.press(await screen.findByRole("button", { name: /Alpha, followed/ }));
  expect(
    await screen.findByRole("button", { name: /Alpha, followed.*creating session$/ }),
  ).toBeOnTheScreen();

  fireEvent.press(screen.getByRole("button", { name: "Cancel" }));

  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByRole("button", { name: "Alpha, followed, /projects/alpha" }),
  ).toBeOnTheScreen();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mockCreateSession).not.toHaveBeenCalled();
});

test("offers the server's working directory and returns to the project list", async () => {
  mockGetDefaultLocation.mockResolvedValue(betaLocation);
  mockSelection.followedProjectIds = [alpha.id, beta.id];
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: /Beta, followed/ }));

  expect(await screen.findByText("Choose location")).toBeOnTheScreen();
  expect(screen.queryByText(/will add this project to Sessions/)).toBeNull();
  expect(screen.getByRole("button", { name: /^Main directory,/ })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: /^Server's working directory,/ })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /^beta-feature,/ })).toBeNull();

  fireEvent.press(screen.getByRole("button", { name: "Back to projects" }));
  expect(await screen.findByText("New session")).toBeOnTheScreen();
  expect(screen.getByText("Followed projects")).toBeOnTheScreen();
});

test("ignores project presses while preferences are saving", async () => {
  mockSelection.preferencesSaving = true;
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: /Alpha, followed/ }));

  expect(mockGetLocation).not.toHaveBeenCalled();
  expect(screen.queryByText("Choose location")).toBeNull();
});

test("explains empty followed and search results", async () => {
  mockSelection.followedProjectIds = [];
  renderScreen();

  expect(await screen.findByText("No followed projects")).toBeOnTheScreen();
  expect(screen.getByText("Browse server projects to start a session.")).toBeOnTheScreen();
  fireEvent.changeText(screen.getByLabelText("Search projects"), " Gamma ");
  expect(await screen.findByText('No projects match "Gamma"')).toBeOnTheScreen();
  expect(screen.getByText("Try a project name or path.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Browse all projects" })).toBeNull();
});

test("retries when project locations fail to load", async () => {
  mockSelection.projectsError = true;
  renderScreen();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Project locations could not be loaded from this connection.",
  );
  fireEvent.press(screen.getByRole("button", { name: "Retry" }));

  expect(mockRefetch).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(mockGetDefaultLocation).toHaveBeenCalledTimes(2));
});

test("retries when the server returns no projects", async () => {
  mockSelection.projects = [];
  renderScreen();

  expect(await screen.findByText("No server projects found")).toBeOnTheScreen();
  expect(screen.getByText("OpenCode did not return any known projects.")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Retry" }));

  expect(mockRefetch).toHaveBeenCalledTimes(1);
});

type BeforeRemoveEvent = {
  data: { action: { type: string } };
  preventDefault: jest.Mock;
};

function removeEvent(type: string): BeforeRemoveEvent {
  return { data: { action: { type } }, preventDefault: jest.fn() };
}

function mockNavigation() {
  const listeners = new Set<(event: BeforeRemoveEvent) => void>();
  return {
    addListener: jest.fn((_event: string, listener: (event: BeforeRemoveEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emitBeforeRemove(event: BeforeRemoveEvent) {
      for (const listener of listeners) listener(event);
    },
    goBack: jest.fn(),
    replace: jest.fn(),
    setOptions: jest.fn(),
  };
}

function renderScreen(navigation = mockNavigation()) {
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
