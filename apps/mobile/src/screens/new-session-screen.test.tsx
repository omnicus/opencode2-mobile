import { beforeEach, expect, jest, test } from "@jest/globals";
import {
  createOpenCodeSession,
  getDefaultOpenCodeAgent,
  getDefaultOpenCodeLocation,
  getDefaultOpenCodeModel,
  getOpenCodeLocation,
  listOpenCodeAgents,
} from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { writeSessionDraft } from "../storage/draft-repository";
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
const gamma = {
  canonical: "/projects/gamma",
  id: "project-gamma",
  name: "Gamma",
  sandboxes: [],
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
const gammaLocation = {
  directory: gamma.canonical,
  project: { canonical: gamma.canonical, directory: gamma.canonical, id: gamma.id },
};
const mockSetFollowedProjectIds = jest.fn<(...args: unknown[]) => Promise<void>>(
  async () => undefined,
);
const mockRefetch = jest.fn<() => Promise<void>>(async () => undefined);
const mockClearDraft = jest.fn();
let mockSelection: Record<string, unknown>;
let mockInitialDraft = "";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  createOpenCodeSession: jest.fn(),
  findOpenCodeFiles: jest.fn(async () => ({ data: [] })),
  getDefaultOpenCodeAgent: jest.fn(async () => null),
  getDefaultOpenCodeLocation: jest.fn(),
  getDefaultOpenCodeModel: jest.fn(async () => ({ data: null })),
  getOpenCodeLocation: jest.fn(),
  listOpenCodeAgents: jest.fn(async () => ({ data: [] })),
  listOpenCodeCommands: jest.fn(async () => ({ data: [] })),
  listOpenCodeModels: jest.fn(async () => ({ data: [] })),
  listOpenCodeSkills: jest.fn(async () => ({ data: [] })),
}));
jest.mock("../state/connection-runtime-context", () => ({
  useConnectionRuntime: () => ({
    connectionId: "connection-1",
    connectionUpdatedAtMs: 1,
    restClient: {},
  }),
}));
jest.mock("../state/workspace-selection-context", () => ({
  useWorkspaceSelection: () => mockSelection,
}));
let mockTablet = false;
jest.mock("./app-shell", () => ({ isTabletShell: () => mockTablet }));
jest.mock("../state/use-model-favorites", () => ({ useModelFavorites: () => undefined }));
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => ({}) }));
jest.mock("../storage/draft-repository", () => ({
  writeSessionDraft: jest.fn(async () => undefined),
}));
jest.mock("./use-session-draft", () => ({
  useSessionDraft: () => {
    const { useState } = jest.requireActual<typeof import("react")>("react");
    const [draft, setDraft] = useState(mockInitialDraft);
    return {
      clearDraft: mockClearDraft,
      draft,
      error: undefined,
      loaded: true,
      mentions: [],
      setDraft: (next: string) => setDraft(next),
    };
  },
}));
// The real composer is covered by its own tests; this stand-in exposes what the screen passes.
jest.mock("./session-composer", () => ({
  SessionComposer: (props: {
    agent?: string;
    disabled?: boolean;
    draft: string;
    location: { directory: string };
    model?: { id: string };
    onDraftChange: (draft: string, mentions: never[]) => void;
    onSubmit: (intent: { type: "prompt" }) => void;
  }) => {
    const { Pressable, Text, TextInput, View } =
      jest.requireActual<typeof import("react-native")>("react-native");
    return (
      <View>
        <TextInput
          accessibilityLabel="Message"
          onChangeText={(text) => props.onDraftChange(text, [])}
          value={props.draft}
        />
        <Text testID="composer-location">{props.location.directory}</Text>
        <Text testID="composer-agent">{props.agent ?? ""}</Text>
        <Text testID="composer-model">{props.model?.id ?? ""}</Text>
        <Pressable
          accessibilityLabel="Send"
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(props.disabled) }}
          disabled={props.disabled}
          onPress={() => props.onSubmit({ type: "prompt" })}
        />
      </View>
    );
  },
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
const mockWriteDraft = jest.mocked(writeSessionDraft);

beforeEach(() => {
  jest.clearAllMocks();
  mockInitialDraft = "";
  mockTablet = false;
  mockSelection = {
    followedProjectIds: [alpha.id, beta.id],
    location: undefined,
    preferencesError: false,
    preferencesLoading: false,
    preferencesSaving: false,
    projects: [alpha, beta, gamma],
    projectsError: false,
    projectsLoading: false,
    refetch: mockRefetch,
    setFollowedProjectIds: mockSetFollowedProjectIds,
  };
  mockGetDefaultLocation.mockResolvedValue(alphaLocation);
  jest.mocked(listOpenCodeAgents).mockResolvedValue({ data: [] } as never);
  jest.mocked(getDefaultOpenCodeAgent).mockResolvedValue(null);
  jest.mocked(getDefaultOpenCodeModel).mockResolvedValue({ data: null } as never);
  mockGetLocation.mockImplementation(async (_client, requested) => {
    if (requested.directory === betaLocation.directory) return betaLocation;
    if (requested.directory === gamma.canonical) return gammaLocation;
    return alphaLocation;
  });
  mockCreateSession.mockImplementation(async (_client, location) => ({
    cost: 0,
    id: "ses-created",
    location,
    projectID: alpha.id,
    time: { created: 2, updated: 2 },
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  }));
});

test("lists followed projects above the composer with the first one selected", async () => {
  renderScreen();

  const alphaRow = await screen.findByRole("button", { name: "Alpha" });
  expect(alphaRow).toHaveProp("accessibilityState", expect.objectContaining({ selected: true }));
  expect(screen.getByRole("button", { name: "Beta" })).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ selected: false }),
  );
  expect(screen.queryByRole("button", { name: /^Gamma/ })).toBeNull();
  expect(screen.getByRole("button", { name: "All projects" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "New session" })).toBeOnTheScreen();
  // The selected project also reads under the title.
  expect(screen.getAllByText("Alpha")).toHaveLength(2);
  expect(screen.getByTestId("composer-location")).toHaveTextContent(alpha.canonical);
});

test("starts in the project the user last worked in", async () => {
  mockSelection.location = { directory: "/worktrees/beta-feature" };
  renderScreen();

  const betaRow = await screen.findByRole("button", { name: "Beta" });
  expect(betaRow).toHaveProp("accessibilityState", expect.objectContaining({ selected: true }));
  expect(screen.getByRole("button", { name: "beta-feature, /worktrees/beta-feature" })).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ selected: true }),
  );
  expect(screen.getByTestId("composer-location")).toHaveTextContent("/worktrees/beta-feature");
});

test("sending creates the session, hands the message over, and opens it", async () => {
  const navigation = mockNavigation();
  renderScreen(navigation);

  fireEvent.changeText(await screen.findByLabelText("Message"), "Fix the build");
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled());
  await sendWhenReady();

  await waitFor(() =>
    expect(mockCreateSession).toHaveBeenCalledWith({}, alphaLocation, {}, expect.anything()),
  );
  await waitFor(() =>
    expect(mockWriteDraft).toHaveBeenCalledWith(
      {},
      {
        connectionId: "connection-1",
        content: "Fix the build",
        mentions: [],
        revision: 1,
        sessionId: "ses-created",
      },
    ),
  );
  await waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith("Session", {
      connectionId: "connection-1",
      location: alphaLocation,
      sendDraft: true,
      sessionID: "ses-created",
    }),
  );
  expect(mockClearDraft).toHaveBeenCalled();
  expect(mockSetFollowedProjectIds).not.toHaveBeenCalled();
});

test("creates with the agent and model the composer shows", async () => {
  jest.mocked(listOpenCodeAgents).mockResolvedValue({
    data: [{ id: "build", mode: "primary", model: { id: "opus", providerID: "anthropic" } }],
  } as never);
  jest.mocked(getDefaultOpenCodeAgent).mockResolvedValue("build" as never);
  jest
    .mocked(getDefaultOpenCodeModel)
    .mockResolvedValue({ data: { id: "sonnet", providerID: "anthropic" } } as never);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId("composer-agent")).toHaveTextContent("build"));
  expect(screen.getByTestId("composer-model")).toHaveTextContent("opus");
  fireEvent.changeText(screen.getByLabelText("Message"), "Hello");
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled());
  await sendWhenReady();

  await waitFor(() =>
    expect(mockCreateSession).toHaveBeenCalledWith(
      {},
      alphaLocation,
      { agent: "build", model: { id: "opus", providerID: "anthropic" } },
      expect.anything(),
    ),
  );
});

test("choosing a worktree sends the session there", async () => {
  const navigation = mockNavigation();
  mockInitialDraft = "Ship it";
  renderScreen(navigation);

  fireEvent.press(await screen.findByRole("button", { name: "Beta" }));
  fireEvent.press(
    await screen.findByRole("button", { name: "beta-feature, /worktrees/beta-feature" }),
  );
  expect(screen.getByTestId("composer-location")).toHaveTextContent("/worktrees/beta-feature");
  await sendWhenReady();

  await waitFor(() =>
    expect(mockGetLocation).toHaveBeenCalledWith(
      {},
      { directory: "/worktrees/beta-feature" },
      expect.anything(),
    ),
  );
  await waitFor(() =>
    expect(mockCreateSession).toHaveBeenCalledWith({}, betaLocation, {}, expect.anything()),
  );
});

test("an unfollowed project from search is followed before creation", async () => {
  mockInitialDraft = "Hello";
  renderScreen();

  fireEvent.press(await screen.findByRole("button", { name: "All projects" }));
  fireEvent.changeText(await screen.findByLabelText("Search projects"), "gam");
  fireEvent.press(await screen.findByRole("button", { name: /^Gamma, / }));

  const gammaRow = await screen.findByRole("button", { name: "Gamma, Will be added to Sessions" });
  expect(gammaRow).toHaveProp("accessibilityState", expect.objectContaining({ selected: true }));
  await sendWhenReady();

  await waitFor(() =>
    expect(mockSetFollowedProjectIds).toHaveBeenCalledWith([alpha.id, beta.id, gamma.id]),
  );
  await waitFor(() =>
    expect(mockCreateSession).toHaveBeenCalledWith({}, gammaLocation, {}, expect.anything()),
  );
  expect(mockSetFollowedProjectIds.mock.invocationCallOrder[0]).toBeLessThan(
    mockCreateSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
  );
});

test("does not create when adding an unfollowed project fails", async () => {
  mockSetFollowedProjectIds.mockRejectedValueOnce(new Error("storage failed"));
  mockInitialDraft = "Hello";
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: "All projects" }));
  fireEvent.press(await screen.findByRole("button", { name: /^Gamma, / }));
  await sendWhenReady();

  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be created/i);
  expect(mockCreateSession).not.toHaveBeenCalled();
  expect(mockClearDraft).not.toHaveBeenCalled();
});

test("keeps the message here when it cannot be handed to the new session", async () => {
  const navigation = mockNavigation();
  mockWriteDraft.mockRejectedValueOnce(new Error("storage failed"));
  mockInitialDraft = "Hello";
  renderScreen(navigation);
  await sendWhenReady();

  await waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith("Session", {
      connectionId: "connection-1",
      focusComposer: true,
      location: alphaLocation,
      sessionID: "ses-created",
    }),
  );
  expect(mockClearDraft).not.toHaveBeenCalled();
});

test("waits for the default location before offering projects", async () => {
  let resolveDefault: ((location: typeof alphaLocation) => void) | undefined;
  mockGetDefaultLocation.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveDefault = resolve;
      }),
  );
  renderScreen();

  expect(await screen.findByLabelText("Loading projects")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await act(async () => resolveDefault?.(alphaLocation));
  expect(await screen.findByRole("button", { name: "Alpha" })).toBeOnTheScreen();
});

test("shows progress and announces it while creating", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  mockCreateSession.mockImplementationOnce(() => new Promise(() => undefined));
  mockInitialDraft = "Hello";
  renderScreen();
  await sendWhenReady();

  expect(await screen.findByText("Creating session")).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledWith("Creating session");
  expect(screen.getByRole("button", { name: "Beta" })).toBeDisabled();
  announce.mockRestore();
});

test("a location that moved to another project asks to choose again and reloads", async () => {
  mockGetLocation.mockResolvedValue(alphaLocation);
  mockInitialDraft = "Hello";
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: "Beta" }));
  await sendWhenReady();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The project list changed. Choose the project again.",
  );
  expect(mockRefetch).toHaveBeenCalled();
  expect(mockCreateSession).not.toHaveBeenCalled();
});

test("tablets show the new session as a sheet with Cancel", async () => {
  mockTablet = true;
  const navigation = mockNavigation();
  renderScreen(navigation);
  await screen.findByText("Alpha");

  expect(screen.queryByRole("button", { name: "Back to Sessions" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Cancel" }));

  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

test("leaving cancels a pending creation without an error", async () => {
  mockGetLocation.mockImplementationOnce(
    (_client, _requested, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const navigation = mockNavigation();
  mockInitialDraft = "Hello";
  renderScreen(navigation);
  await sendWhenReady();
  await screen.findByText("Creating session");

  fireEvent.press(screen.getByRole("button", { name: "Back to Sessions" }));

  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByText("Creating session")).toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mockCreateSession).not.toHaveBeenCalled();
});

test("the swipe back gesture also cancels creation", async () => {
  const navigation = mockNavigation();
  mockCreateSession.mockImplementationOnce(
    (_client, _location, _input, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  mockInitialDraft = "Hello";
  renderScreen(navigation);
  await sendWhenReady();
  await waitFor(() => expect(mockCreateSession).toHaveBeenCalled());

  const back = removeEvent("GO_BACK");
  act(() => navigation.emitBeforeRemove(back));
  expect(back.preventDefault).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText("Creating session")).toBeNull());
  expect(navigation.replace).not.toHaveBeenCalled();
});

test("ignores project presses while preferences are saving", async () => {
  mockSelection.preferencesSaving = true;
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: "Beta" }));

  expect(screen.getByRole("button", { name: "Alpha" })).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ selected: true }),
  );
});

test("explains empty search results", async () => {
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: "All projects" }));
  fireEvent.changeText(screen.getByLabelText("Search projects"), " Delta ");

  expect(await screen.findByText('No projects match "Delta"')).toBeOnTheScreen();
  expect(screen.getByText("Try a project name or path.")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByRole("button", { name: "Alpha" })).toBeOnTheScreen();
});

test("with nothing followed, starts in the server's default project", async () => {
  mockSelection.followedProjectIds = [];
  renderScreen();

  const alphaRow = await screen.findByRole("button", { name: "Alpha, Will be added to Sessions" });
  expect(alphaRow).toHaveProp("accessibilityState", expect.objectContaining({ selected: true }));
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

async function sendWhenReady() {
  const send = await screen.findByRole("button", { name: "Send" });
  await waitFor(() => expect(send).not.toBeDisabled());
  fireEvent.press(send);
}

type BeforeRemoveEvent = {
  data: { action: { type: string } };
  preventDefault: jest.Mock;
};

function removeEvent(type: string): BeforeRemoveEvent {
  return { data: { action: { type } }, preventDefault: jest.fn() };
}

function mockNavigation() {
  const listeners = new Set<(event: BeforeRemoveEvent) => void>();
  const navigation = {
    addListener: jest.fn((_event: string, listener: (event: BeforeRemoveEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emitBeforeRemove(event: BeforeRemoveEvent) {
      for (const listener of listeners) listener(event);
    },
    goBack: jest.fn(() => navigation.emitBeforeRemove(removeEvent("GO_BACK"))),
    replace: jest.fn(),
    setOptions: jest.fn(),
  };
  return navigation;
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
