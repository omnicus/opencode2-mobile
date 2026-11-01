import { expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { createElement } from "react";
import { AccessibilityInfo, Dimensions, Platform, Pressable, Text } from "react-native";

import { useConnections } from "../connections/connections-context";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { typography } from "../theme";
import {
  getConnectionPresentation,
  getWorkspaceState,
  isTabletShell,
  navigateToSection,
  PendingInteractionsScreen,
  pendingLabel,
  pendingSummaryTitle,
  ShellFrame,
  showsConnectionIssue,
  WorkspaceStateCard,
} from "./app-shell";

jest.mock("../connections/connections-context", () => ({ useConnections: jest.fn() }));
jest.mock("../security/app-lock-context", () => ({ useAppLock: jest.fn() }));
jest.mock("../state/connection-runtime-context", () => ({ useConnectionRuntime: jest.fn() }));
jest.mock("../state/workspace-selection-context", () => ({ useWorkspaceSelection: jest.fn() }));
jest.mock("./form-request-list", () => ({ FormRequestList: () => null }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => undefined) }));

test("communicates every transport status without relying on color", () => {
  expect(getConnectionPresentation("connected", 0).label).toBe("Connected");
  expect(getConnectionPresentation("connecting", 0).label).toBe("Connecting");
  expect(getConnectionPresentation("reconnecting", 3).label).toBe("Reconnecting (3)");
  expect(getConnectionPresentation("stale", 0).label).toBe("Stale");
  expect(getConnectionPresentation("offline", 0).label).toBe("Offline");
  expect(getConnectionPresentation("unauthorized", 0).label).toBe("Authorization required");
  expect(getConnectionPresentation("incompatible", 0).label).toBe("Incompatible server");
  expect(getConnectionPresentation("idle", 0).label).toBe("No connection");
});

test("does not flag the background stale state as a connection problem", () => {
  expect(showsConnectionIssue("stale")).toBe(false);
  expect(showsConnectionIssue("connected")).toBe(false);
  expect(showsConnectionIssue("connecting")).toBe(false);
  for (const status of [
    "reconnecting",
    "offline",
    "unauthorized",
    "incompatible",
    "idle",
  ] as const) {
    expect(showsConnectionIssue(status)).toBe(true);
  }
});

test("uses cache metadata only for disconnected partial-shell states", () => {
  expect(getWorkspaceState("reconnecting", true)).toBe("partial-cache");
  expect(getWorkspaceState("stale", true)).toBe("partial-cache");
  expect(getWorkspaceState("offline", true)).toBe("partial-cache");
  expect(getWorkspaceState("reconnecting", false)).toBe("loading");
  expect(getWorkspaceState("incompatible", true)).toBe("incompatible");
  expect(getWorkspaceState("unauthorized", true)).toBe("failure");
  expect(getWorkspaceState("connected", false)).toBe("empty");
});

test("switches to the tablet rail at the documented breakpoint", () => {
  expect(isTabletShell(759)).toBe(false);
  expect(isTabletShell(760)).toBe(true);
});

test("uses native navigation on phones and retains the tablet rail", () => {
  const originalScreen = Dimensions.get("screen");
  const originalWindow = Dimensions.get("window");
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  } as never);
  jest.mocked(useConnectionRuntime).mockReturnValue({
    reconnectAttempt: 0,
    status: "connected",
  } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete", freshness: "current" },
    pendingCount: 0,
  } as never);

  try {
    Dimensions.set({
      screen: { ...originalScreen, width: 759 },
      window: { ...originalWindow, width: 759 },
    });
    const phone = render(
      createElement(
        ShellFrame,
        { active: "Workspace", navigate: jest.fn() },
        createElement(Text, null, "Phone content"),
      ),
    );
    expect(screen.queryByLabelText("Primary navigation")).not.toBeOnTheScreen();
    phone.unmount();

    Dimensions.set({
      screen: { ...originalScreen, width: 760 },
      window: { ...originalWindow, width: 760 },
    });
    const navigate = jest.fn();
    const tablet = render(
      createElement(
        ShellFrame,
        { active: "Workspace", navigate },
        createElement(Text, null, "Tablet content"),
      ),
    );
    expect(screen.getByLabelText("Primary navigation")).toHaveProp("accessibilityRole", "tablist");
    expect(screen.getByRole("tab", { name: "Needs you" })).toHaveProp("accessibilityValue", {
      text: "0 requests need you, up to date",
    });
    const footer = screen.getByRole("button", { name: "Connection, Connected" });
    expect(footer).toHaveProp("accessibilityHint", "Opens connections");
    expect(footer).toHaveStyle({ minHeight: 48 });
    fireEvent.press(footer);
    expect(navigate).toHaveBeenCalledWith("Connections");
    tablet.unmount();
  } finally {
    Dimensions.set({ screen: originalScreen, window: originalWindow });
  }
});

test("session tabs replace healthy connection and server labels but retain connection problems", () => {
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  } as never);
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "connected" } as never);
  jest
    .mocked(useWorkspaceSelection)
    .mockReturnValue({ attentionCoverage: { completeness: "complete" }, pendingCount: 0 } as never);
  const onSelect = jest.fn();
  const navigate = jest.fn();
  const element = () =>
    createElement(ShellFrame, {
      active: "Workspace",
      navigate,
      branch: { state: "known", name: "main" },
      sessionTabs: { active: "session", onSelect },
    });
  const view = render(element());
  expect(screen.queryByText("Connected")).toBeNull();
  expect(screen.queryByText("Test server")).toBeNull();
  expect(screen.getByLabelText("Session view")).toBeOnTheScreen();
  expect(screen.getByRole("tab", { name: "Session", selected: true })).toBeOnTheScreen();
  expect(screen.getByText("Session")).toHaveStyle(typography.control);
  expect(screen.getByRole("button", { name: "Current branch, main" })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("tab", { name: "Changes" }));
  expect(onSelect).toHaveBeenCalledWith("changes");
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "offline" } as never);
  view.rerender(element());
  const issue = screen.getByRole("button", { name: "Connection problem: Offline" });
  expect(issue).toHaveProp("accessibilityHint", "Opens connections");
  expect(issue).toHaveStyle({ minHeight: 48 });
  fireEvent.press(issue);
  expect(navigate).toHaveBeenCalledWith("Connections");
});

test("keeps branch and trailing location options together on narrow phones and large text", () => {
  jest
    .mocked(useConnections)
    .mockReturnValue({ profiles: [], selectedProfileId: undefined } as never);
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "connected" } as never);
  jest
    .mocked(useWorkspaceSelection)
    .mockReturnValue({ attentionCoverage: { completeness: "complete" }, pendingCount: 0 } as never);
  const originalWindow = Dimensions.get("window");
  const originalScreen = Dimensions.get("screen");
  try {
    for (const fontScale of [1, 2]) {
      Dimensions.set({
        window: { ...originalWindow, width: 320, fontScale },
        screen: { ...originalScreen, width: 320, fontScale },
      });
      const view = render(
        createElement(ShellFrame, {
          active: "Workspace",
          navigate: jest.fn(),
          branch: { state: "known", name: "feature/a-long-branch-name" },
          sessionTabs: { active: "session", onSelect: jest.fn() },
          sessionOptions: createElement(
            Pressable,
            { accessibilityRole: "button", accessibilityLabel: "Location options" },
            createElement(Text, null, "..."),
          ),
        }),
      );
      expect(
        screen.getByRole("button", { name: "Current branch, feature/a-long-branch-name" }),
      ).toBeOnTheScreen();
      expect(screen.getByRole("button", { name: "Location options" })).toBeOnTheScreen();
      expect(screen.getByRole("tab", { name: "Changes" })).toBeOnTheScreen();
      view.unmount();
    }
  } finally {
    Dimensions.set({ window: originalWindow, screen: originalScreen });
  }
});

test("reveals and copies the full session branch name", async () => {
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  } as never);
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "connected" } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete" },
    pendingCount: 0,
  } as never);
  const branchName = "docs/a-very-long-mobile-workflow-screenshots-branch";

  const view = render(
    createElement(
      ShellFrame,
      {
        active: "Workspace",
        branch: { name: branchName, state: "known" },
        navigate: jest.fn(),
      },
      createElement(Text, null, "Session content"),
    ),
  );

  fireEvent.press(screen.getByRole("button", { name: `Current branch, ${branchName}` }));
  expect(screen.getByRole("header", { name: "Current branch" })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Copy branch name" }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(branchName));
  expect(screen.getByRole("button", { name: "Copied" })).toBeOnTheScreen();
  view.unmount();
});

test("reveals and copies the full server name", async () => {
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ id: "connection-1", name: "A server name too long for the metadata bar" }],
    selectedProfileId: "connection-1",
  } as never);
  jest.mocked(useConnectionRuntime).mockReturnValue({
    reconnectAttempt: 0,
    status: "connected",
  } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete" },
    pendingCount: 0,
  } as never);
  const serverName = "A server name too long for the metadata bar";

  const view = render(
    createElement(
      ShellFrame,
      { active: "Workspace", navigate: jest.fn() },
      createElement(Text, null, "Session content"),
    ),
  );

  fireEvent.press(screen.getByRole("button", { name: `Server, ${serverName}` }));
  expect(screen.getByRole("header", { name: "Server name" })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Copy server name" }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(serverName));
  view.unmount();
});

test("allows a permission owned by a background child session from Pending", () => {
  const replyPermission = jest.fn();
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  } as never);
  jest.mocked(useConnectionRuntime).mockReturnValue({
    reconnectAttempt: 0,
    status: "connected",
  } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: {
      completeness: "complete",
      failedLocationCount: 0,
      failedProjects: [],
      knownLocationCount: 1,
      reasons: [],
      reconciledLocationCount: 1,
      revision: 1,
    },
    blockedSessionIds: new Set(["ses_child"]),
    forms: [],
    followedProjectIds: ["project-1"],
    interactionsError: false,
    interactionsLoading: false,
    location: { directory: "/workspace" },
    pendingCount: 1,
    permissions: [
      {
        action: "shell",
        id: "per_test",
        resources: ["redacted command"],
        sessionID: "ses_child",
      },
    ],
    replyPermission,
    preferencesLoading: false,
    setLocation: jest.fn(),
  } as never);

  const view = render(
    createElement(PendingInteractionsScreen, {
      navigation: { navigate: jest.fn() },
    } as never),
  );

  expect(screen.getByText("1 request")).toBeOnTheScreen();
  expect(screen.getByText("redacted command")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Allow once" }));
  expect(replyPermission).toHaveBeenCalledWith("per_test", "ses_child", "once");
  view.unmount();
});

test("summarizes an empty queue and routes unfollowed users to project selection", () => {
  const navigate = jest.fn();
  const selection = {
    attentionCoverage: {
      completeness: "complete",
      failedLocationCount: 0,
      failedProjects: [],
      knownLocationCount: 2,
      reconciledLocationCount: 2,
    },
    followedProjectIds: ["project-1"],
    forms: [],
    interactionsError: false,
    interactionsLoading: false,
    pendingCount: 0,
    permissions: [],
    preferencesLoading: false,
  };
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  } as never);
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "connected" } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue(selection as never);
  const element = () =>
    createElement(PendingInteractionsScreen, { navigation: { navigate } } as never);

  const view = render(element());
  expect(screen.getByText("Nothing needs you")).toHaveStyle(typography.headline);
  expect(screen.getByText("Checked 2 locations.")).toBeOnTheScreen();

  jest
    .mocked(useWorkspaceSelection)
    .mockReturnValue({ ...selection, followedProjectIds: [] } as never);
  view.rerender(element());
  expect(
    screen.getByText("Follow a project to see requests that need you here."),
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Choose projects" }));
  expect(navigate).toHaveBeenCalledWith("FollowedProjects");
  view.unmount();
});

test.each([0, 1])(
  "explains unavailable locations with %i known requests on a live connection",
  async (pendingCount) => {
    let finishRefetch = () => {};
    const refetch = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefetch = resolve;
        }),
    );
    const navigate = jest.fn();
    jest.mocked(useConnections).mockReturnValue({
      profiles: [{ id: "connection-1", name: "Test server" }],
      selectedProfileId: "connection-1",
    } as never);
    jest.mocked(useConnectionRuntime).mockReturnValue({
      reconnectAttempt: 0,
      status: "connected",
    } as never);
    jest.mocked(useWorkspaceSelection).mockReturnValue({
      attentionCoverage: {
        completeness: "incomplete",
        failedLocationCount: 1,
        failedLocations: [
          {
            location: { directory: "/a/worktrees/old" },
            projectLabel: "Alpha",
            source: "session-history",
            failedChecks: ["permissions", "forms"],
          },
        ],
        failedProjects: [{ label: "Alpha", locationCount: 1, projectID: "project-1" }],
        freshness: "stale",
        knownLocationCount: 7,
        reconciledLocationCount: 6,
      },
      followedProjectIds: ["project-1"],
      forms: [],
      interactionsError: true,
      interactionsLoading: false,
      pendingCount,
      permissions: [],
      preferencesLoading: false,
      refetch,
    } as never);

    const view = render(
      createElement(PendingInteractionsScreen, {
        navigation: { navigate, popTo: jest.fn() },
      } as never),
    );

    expect(screen.queryByRole("header", { name: "Requests that need you." })).toBeNull();
    expect(screen.getByText("1 location could not be checked.")).toBeOnTheScreen();
    expect(
      screen.getByText(
        pendingCount === 0
          ? /Affected project: Alpha\. No requests were found at the 6 locations that responded\./
          : /Showing requests found at the other locations/,
      ),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Review locations" }));
    expect(screen.getByText("/a/worktrees/old")).toBeOnTheScreen();
    expect(screen.getByText("Referenced by session history")).toBeOnTheScreen();
    expect(screen.getByText(/may have been moved or removed/)).toBeOnTheScreen();
    expect(screen.getByText(/Session history is preserved/)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Close Unavailable locations" }));
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Retry" })).toHaveProp("accessibilityState", {
      busy: true,
      disabled: true,
    });
    await act(async () => finishRefetch());
    expect(screen.getByRole("button", { name: "Retry" })).toHaveProp("accessibilityState", {
      busy: false,
      disabled: false,
    });
    expect(screen.queryByRole("button", { name: "Connections" })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    view.unmount();
  },
);

test("names the attention section Needs you", () => {
  const complete = { completeness: "complete", freshness: "current" } as const;
  expect(pendingLabel(0, complete)).toBe("Needs you");
  expect(pendingLabel(3, complete)).toBe("Needs you 3");
  expect(pendingLabel(3, { completeness: "incomplete", freshness: "current" })).toBe(
    "Needs you 3+",
  );
  expect(pendingLabel(0, { completeness: "complete", freshness: "reconciling" })).toBe(
    "Needs you, checking",
  );
  expect(pendingLabel(0, { completeness: "incomplete", freshness: "stale" })).toBe("Needs you");
  expect(pendingSummaryTitle(0, true)).toBe("Nothing needs you");
  expect(pendingSummaryTitle(0, false)).toBe("Nothing found that needs you");
  expect(pendingSummaryTitle(1, true)).toBe("1 request");
  expect(pendingSummaryTitle(4, false)).toBe("At least 4 requests");
});

test("modal sections replace an open copy instead of stacking another", () => {
  const navigation = { navigate: jest.fn(), popTo: jest.fn() };
  navigateToSection(navigation as never, "Settings");
  expect(navigation.navigate).toHaveBeenCalledWith("Settings", undefined, { pop: true });
  navigateToSection(navigation as never, "Workspace");
  expect(navigation.popTo).toHaveBeenCalledWith("Workspace");
});

test("announces connection status changes on iOS once per status", () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
  announce.mockClear();
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete", freshness: "current" },
    pendingCount: 0,
  } as never);
  const runtime = (status: string, reconnectAttempt = 0) =>
    jest.mocked(useConnectionRuntime).mockReturnValue({ reconnectAttempt, status } as never);
  const element = () => createElement(ShellFrame, { active: "Workspace", navigate: jest.fn() });

  runtime("connected");
  const view = render(element());
  expect(announce).not.toHaveBeenCalled();
  runtime("reconnecting", 1);
  view.rerender(element());
  runtime("reconnecting", 2);
  view.rerender(element());
  runtime("connected");
  view.rerender(element());
  expect(announce.mock.calls).toEqual([["Reconnecting (1)"], ["Connected"]]);
  view.unmount();
  jest.restoreAllMocks();
});

test("workspace state cards speak their state on iOS in plain words", () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
  announce.mockClear();
  const view = render(createElement(WorkspaceStateCard, { state: "loading" }));
  expect(screen.getByText("Waiting for the server to respond.")).toBeOnTheScreen();
  view.rerender(createElement(WorkspaceStateCard, { state: "partial-cache" }));
  view.rerender(createElement(WorkspaceStateCard, { state: "empty" }));
  expect(screen.getByText("Up to date with the server.")).toBeOnTheScreen();
  expect(announce.mock.calls).toEqual([
    ["Loading server state"],
    ["Server state may be out of date."],
  ]);
  view.unmount();
  jest.restoreAllMocks();
});
