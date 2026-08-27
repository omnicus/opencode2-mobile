import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { createElement } from "react";
import { Dimensions, Text } from "react-native";

import { useConnections } from "../connections/connections-context";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import {
  getConnectionPresentation,
  getWorkspaceState,
  isTabletShell,
  PendingInteractionsScreen,
  ShellFrame,
} from "./app-shell";

jest.mock("../connections/connections-context", () => ({ useConnections: jest.fn() }));
jest.mock("../security/app-lock-context", () => ({ useAppLock: jest.fn() }));
jest.mock("../state/connection-runtime-context", () => ({ useConnectionRuntime: jest.fn() }));
jest.mock("../state/workspace-selection-context", () => ({ useWorkspaceSelection: jest.fn() }));
jest.mock("./form-request-list", () => ({ FormRequestList: () => null }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => undefined) }));

test("communicates every transport status without relying on color", () => {
  expect(getConnectionPresentation("connected", 0).label).toBe("LIVE");
  expect(getConnectionPresentation("connecting", 0).label).toBe("CONNECTING");
  expect(getConnectionPresentation("reconnecting", 3).label).toBe("RECONNECTING 3");
  expect(getConnectionPresentation("stale", 0).label).toBe("STALE");
  expect(getConnectionPresentation("offline", 0).label).toBe("OFFLINE");
  expect(getConnectionPresentation("unauthorized", 0).label).toBe("AUTH BLOCKED");
  expect(getConnectionPresentation("incompatible", 0).label).toBe("INCOMPATIBLE");
  expect(getConnectionPresentation("idle", 0).label).toBe("NO CONNECTION");
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
    attentionCoverage: { completeness: "complete" },
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
    const tablet = render(
      createElement(
        ShellFrame,
        { active: "Workspace", navigate: jest.fn() },
        createElement(Text, null, "Tablet content"),
      ),
    );
    expect(screen.getByLabelText("Primary navigation")).toBeOnTheScreen();
    tablet.unmount();
  } finally {
    Dimensions.set({ screen: originalScreen, window: originalWindow });
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
    permissionReplyError: false,
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

  expect(screen.getByText("redacted command")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Allow once" }));
  expect(replyPermission).toHaveBeenCalledWith("per_test", "ses_child", "once");
  view.unmount();
});

test("reports partial location failures without blaming a live connection", async () => {
  const refetch = jest.fn(async () => undefined);
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
      failedProjects: [{ label: "Alpha", locationCount: 1, projectID: "project-1" }],
      freshness: "stale",
      knownLocationCount: 7,
      reconciledLocationCount: 6,
    },
    followedProjectIds: ["project-1"],
    forms: [],
    interactionsError: true,
    interactionsLoading: false,
    pendingCount: 0,
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
      /Affected project: Alpha\. No requests were found at the 6 locations that responded\./,
    ),
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("button", { name: "Connections" })).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
  view.unmount();
});
