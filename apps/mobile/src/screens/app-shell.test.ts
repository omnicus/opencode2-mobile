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
  PendingInteractions,
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
    // The parent row owns the child's request, so the card names the parent's project and title.
    inbox: {
      archived: [],
      needsYou: [
        {
          attentionOwnerSessionID: "ses_child",
          projectLabel: "Workspace",
          session: { id: "ses_parent", title: "Fix the login flow" },
          targetSessionID: "ses_child",
        },
      ],
      recent: [],
      working: [],
    },
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
  expect(screen.getByTestId("request-owner")).toHaveTextContent(/Workspace · Fix the login flow$/);
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

    expect(screen.queryByRole("header", { name: "Requests that need you" })).toBeNull();
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

test("describes unresolved and outdated session branches", () => {
  jest
    .mocked(useConnections)
    .mockReturnValue({ profiles: [], selectedProfileId: undefined } as never);
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "connected" } as never);
  jest
    .mocked(useWorkspaceSelection)
    .mockReturnValue({ attentionCoverage: { completeness: "complete" }, pendingCount: 0 } as never);
  const element = (branch: NonNullable<Parameters<typeof ShellFrame>[0]["branch"]>) =>
    createElement(ShellFrame, { active: "Workspace", branch, navigate: jest.fn() });

  const view = render(element({ state: "loading" }));
  expect(screen.getByText("Checking branch")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Server, No server selected" })).toBeOnTheScreen();
  view.rerender(element({ state: "none" }));
  expect(screen.getByText("No branch")).toBeOnTheScreen();
  view.rerender(element({ state: "unavailable" }));
  expect(screen.getByText("Branch unavailable")).toBeOnTheScreen();
  view.rerender(element({ state: "known" }));
  expect(screen.getByText("Branch unavailable")).toBeOnTheScreen();
  view.rerender(element({ name: "main", stale: true, state: "known" }));
  fireEvent.press(screen.getByRole("button", { name: "Current branch, main, may be outdated" }));
  expect(
    screen.getByText("This branch may be outdated while the server reconnects."),
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Close Current branch" }));
  expect(screen.queryByRole("header", { name: "Current branch" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Server, No server selected" }));
  expect(screen.getByRole("header", { name: "Server name" })).toBeOnTheScreen();
  expect(screen.queryByText(/may be outdated while the server reconnects/)).toBeNull();
  view.unmount();
});

test("offers another copy attempt when the clipboard fails", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
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

  const element = (branch?: { name: string; state: "known" }) =>
    createElement(ShellFrame, {
      active: "Workspace",
      navigate: jest.fn(),
      ...(branch && { branch }),
    });
  const view = render(element());
  jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error("denied"));
  fireEvent.press(screen.getByRole("button", { name: "Server, Test server" }));
  fireEvent.press(screen.getByRole("button", { name: "Copy server name" }));
  expect(await screen.findByRole("button", { name: "Try copying again" })).toBeOnTheScreen();
  expect(announce).toHaveBeenLastCalledWith("Server name could not be copied");
  fireEvent.press(screen.getByRole("button", { name: "Try copying again" }));
  expect(await screen.findByRole("button", { name: "Copied" })).toBeOnTheScreen();
  expect(announce).toHaveBeenLastCalledWith("Server name copied");
  fireEvent.press(screen.getByRole("button", { name: "Close Server name" }));

  view.rerender(element({ name: "main", state: "known" }));
  fireEvent.press(screen.getByRole("button", { name: "Current branch, main" }));
  expect(screen.getByRole("button", { name: "Copy branch name" })).toBeOnTheScreen();
  jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error("denied"));
  fireEvent.press(screen.getByRole("button", { name: "Copy branch name" }));
  expect(await screen.findByRole("button", { name: "Try copying again" })).toBeOnTheScreen();
  expect(announce).toHaveBeenLastCalledWith("Branch name could not be copied");
  fireEvent.press(screen.getByRole("button", { name: "Try copying again" }));
  expect(await screen.findByRole("button", { name: "Copied" })).toBeOnTheScreen();
  expect(announce).toHaveBeenLastCalledWith("Branch name copied");
  view.unmount();
  jest.restoreAllMocks();
});

test("routes tablet rail navigation and labels incomplete request counts", () => {
  const originalScreen = Dimensions.get("screen");
  const originalWindow = Dimensions.get("window");
  jest
    .mocked(useConnections)
    .mockReturnValue({ profiles: [], selectedProfileId: undefined } as never);
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 2, status: "reconnecting" } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "incomplete", freshness: "current" },
    pendingCount: 3,
  } as never);
  const navigate = jest.fn();
  try {
    Dimensions.set({
      screen: { ...originalScreen, width: 1024, fontScale: 2 },
      window: { ...originalWindow, width: 1024, fontScale: 2 },
    });
    const element = (props: object = {}) =>
      createElement(ShellFrame, { active: "Pending", navigate, ...props });
    const view = render(element());
    expect(screen.getByText("No server")).toBeOnTheScreen();
    expect(screen.getByText("Needs you 3+")).toBeOnTheScreen();
    const needsYou = screen.getByRole("tab", { name: "Needs you", selected: true });
    expect(needsYou).toHaveProp("accessibilityValue", {
      text: "3 requests need you, up to date, some projects not checked",
    });
    fireEvent.press(screen.getByRole("tab", { name: "Sessions", selected: false }));
    expect(navigate).toHaveBeenLastCalledWith("Workspace");
    fireEvent.press(needsYou);
    expect(navigate).toHaveBeenLastCalledWith("Pending");
    fireEvent.press(screen.getByRole("tab", { name: "Settings" }));
    expect(navigate).toHaveBeenLastCalledWith("Settings");
    expect(screen.getAllByText("Reconnecting (2)")).toHaveLength(2);
    expect(screen.getByText("No server selected")).toHaveStyle({ textAlign: "left" });

    view.rerender(
      element({ hideConnectionBar: true, sessionTabs: { active: "changes", onSelect: jest.fn() } }),
    );
    expect(screen.queryByText("No server")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connection, Reconnecting (2)" })).toBeNull();
    expect(screen.queryByLabelText("Session view")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Connection problem: Reconnecting (2)" }),
    ).toBeOnTheScreen();
    view.unmount();
  } finally {
    Dimensions.set({ screen: originalScreen, window: originalWindow });
  }
});

test("shows loading states before requests are known", () => {
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  } as never);
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "connected" } as never);
  const selection = {
    attentionCoverage: { completeness: "complete", knownLocationCount: 0 },
    followedProjectIds: ["project-1"],
    interactionsLoading: true,
    pendingCount: 0,
    preferencesLoading: true,
  };
  jest.mocked(useWorkspaceSelection).mockReturnValue(selection as never);
  const element = () =>
    createElement(PendingInteractionsScreen, { navigation: { navigate: jest.fn() } } as never);

  const view = render(element());
  expect(screen.getByLabelText("Loading followed projects")).toBeOnTheScreen();
  expect(screen.getByText("Loading followed projects")).toBeOnTheScreen();
  jest
    .mocked(useWorkspaceSelection)
    .mockReturnValue({ ...selection, preferencesLoading: false } as never);
  view.rerender(element());
  expect(screen.getByLabelText("Checking for requests")).toBeOnTheScreen();
  expect(screen.getByText("Checking followed projects for requests")).toBeOnTheScreen();
  view.unmount();
});

test("reports a total request check failure while disconnected", () => {
  const navigate = jest.fn();
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  } as never);
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "offline" } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: {
      completeness: "incomplete",
      failedLocationCount: 2,
      failedLocations: [
        {
          location: { directory: "/a", workspaceID: "wrk_1" },
          projectLabel: "Alpha",
          source: "project-root",
          failedChecks: ["permissions"],
        },
        {
          location: { directory: "/b" },
          projectLabel: "Beta",
          source: "discovered",
          failedChecks: ["forms"],
        },
      ],
      failedProjects: [
        { label: "Alpha", locationCount: 1 },
        { label: "Beta", locationCount: 1 },
      ],
      freshness: "stale",
      knownLocationCount: 2,
      reconciledLocationCount: 0,
    },
    followedProjectIds: ["project-1"],
    forms: [],
    interactionsError: true,
    interactionsLoading: false,
    pendingCount: 0,
    permissions: [],
    preferencesLoading: false,
    refetch: jest.fn(async () => undefined),
  } as never);

  const view = render(
    createElement(PendingInteractionsScreen, {
      navigation: { navigate, popTo: jest.fn() },
    } as never),
  );
  expect(screen.getByText("Unavailable")).toBeOnTheScreen();
  expect(screen.getByText("Requests that need you could not be checked.")).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Affected projects: Alpha, Beta. The server returned errors for every known location.",
    ),
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Connections" }));
  expect(navigate).toHaveBeenCalledWith("Connections");

  fireEvent.press(screen.getByRole("button", { name: "Review locations" }));
  expect(screen.getByText("Project root")).toBeOnTheScreen();
  expect(screen.getByText("Discovered location")).toBeOnTheScreen();
  expect(screen.getByText("Workspace: wrk_1")).toBeOnTheScreen();
  expect(screen.getByText("Could not check: permissions.")).toBeOnTheScreen();
  expect(screen.queryByText(/may have been moved or removed/)).toBeNull();
  expect(screen.getByText(/Check these directories on the server/)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Manage followed projects" }));
  expect(navigate).toHaveBeenCalledWith("FollowedProjects");
  expect(screen.queryByText("Project root")).toBeNull();
  view.unmount();
});

test("offers only a retry when failed locations are not known", () => {
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  } as never);
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "connected" } as never);
  const selection = {
    attentionCoverage: {
      completeness: "incomplete",
      failedLocationCount: 1,
      freshness: "current",
      knownLocationCount: 2,
      reconciledLocationCount: 1,
    },
    followedProjectIds: ["project-1"],
    forms: [],
    interactionsError: true,
    interactionsLoading: false,
    pendingCount: 0,
    permissions: [],
    preferencesLoading: false,
    refetch: jest.fn(async () => undefined),
  };
  jest.mocked(useWorkspaceSelection).mockReturnValue(selection as never);
  const element = () =>
    createElement(PendingInteractionsScreen, { navigation: { navigate: jest.fn() } } as never);

  const view = render(element());
  expect(screen.getByText("Partial results")).toBeOnTheScreen();
  expect(
    screen.getByText(
      "The affected project could not be identified. No requests were found at the 1 location that responded.",
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Review locations" })).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeOnTheScreen();

  jest.mocked(useWorkspaceSelection).mockReturnValue({ ...selection, pendingCount: 2 } as never);
  view.rerender(element());
  expect(screen.getByText("At least 2 requests")).toBeOnTheScreen();
  expect(screen.getByText("Checked 1 of 2 locations.")).toBeOnTheScreen();
  expect(
    screen.getByText(
      "The affected project could not be identified. Showing requests found at the other locations.",
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Review locations" })).toBeNull();
  view.unmount();
});

test("lists failed checks from a worktree and pads the phone Approvals tab", () => {
  const onNavigate = jest.fn();
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "connected" } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: {
      completeness: "incomplete",
      failedLocationCount: 1,
      failedLocations: [
        {
          location: { directory: "/a/worktrees/feature" },
          projectLabel: "Alpha",
          source: "worktree",
          failedChecks: ["permissions", "forms"],
        },
      ],
      failedProjects: [{ label: "Alpha", locationCount: 1 }],
      freshness: "reconciling",
      knownLocationCount: 3,
      reconciledLocationCount: 2,
    },
    followedProjectIds: ["project-1"],
    formLocations: new Map(),
    forms: [{ id: "form-1" }],
    inbox: { archived: [], needsYou: [], recent: [], working: [] },
    interactionsError: true,
    interactionsLoading: false,
    pendingCount: 1,
    permissions: [],
    preferencesLoading: false,
    refetch: jest.fn(async () => undefined),
  } as never);

  const view = render(
    createElement(PendingInteractions, { bottomInset: 80, heading: true, onNavigate }),
  );
  expect(screen.getByRole("header", { name: "Requests that need you" })).toBeOnTheScreen();
  expect(screen.getByText("Checking 2 of 3 locations.")).toBeOnTheScreen();
  expect(
    screen.getByText("Affected project: Alpha. Showing requests found at the other locations."),
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Review locations" }));
  expect(screen.getByText("Registered worktree")).toBeOnTheScreen();
  expect(screen.getByText("Could not check: permissions and forms.")).toBeOnTheScreen();
  expect(screen.getByText(/may have been moved or removed/)).toBeOnTheScreen();
  view.unmount();
});

test("keeps known requests while checking and empties the sheet once checks recover", () => {
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "connected" } as never);
  const failure = {
    location: { directory: "/a" },
    projectLabel: "Alpha",
    source: "project-root",
    failedChecks: ["forms"],
  };
  const selection = {
    attentionCoverage: {
      completeness: "incomplete",
      failedLocationCount: 1,
      failedLocations: [failure],
      failedProjects: [{ label: "Alpha", locationCount: 1 }],
      freshness: "current",
      knownLocationCount: 2,
      reconciledLocationCount: 1,
    },
    followedProjectIds: ["project-1"],
    forms: [],
    interactionsError: true,
    interactionsLoading: true,
    pendingCount: 2,
    permissions: [],
    preferencesLoading: false,
    refetch: jest.fn(async () => undefined),
  };
  jest.mocked(useWorkspaceSelection).mockReturnValue(selection as never);
  const element = () =>
    createElement(PendingInteractions, { heading: false, onNavigate: jest.fn() });

  const view = render(element());
  expect(screen.getByText("At least 2 requests")).toBeOnTheScreen();
  expect(screen.queryByText("Checking followed projects for requests")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Review locations" }));
  expect(screen.getByText("Project root")).toBeOnTheScreen();

  jest.mocked(useWorkspaceSelection).mockReturnValue({
    ...selection,
    attentionCoverage: {
      ...selection.attentionCoverage,
      completeness: "complete",
      failedLocationCount: 0,
      failedLocations: [],
      failedProjects: [],
      reconciledLocationCount: 2,
    },
    interactionsError: false,
  } as never);
  view.rerender(element());
  expect(screen.getByText("No location checks are currently failing.")).toBeOnTheScreen();
  expect(screen.queryByText(/Check these directories on the server/)).toBeNull();
  expect(screen.getByText("2 requests")).toBeOnTheScreen();
  view.unmount();
});
