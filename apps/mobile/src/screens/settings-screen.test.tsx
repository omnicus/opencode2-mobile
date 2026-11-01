import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Dimensions, Switch } from "react-native";

import { useConnections } from "../connections/connections-context";
import { sendNotificationDeviceCommand } from "../notifications/notification-client";
import {
  getNotificationPairingByConnectionID,
  readNotificationPairingSecret,
} from "../notifications/notification-pairing-repository";
import { useAppLock } from "../security/app-lock-context";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { useTranscriptPreferences } from "../state/transcript-preferences";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { SettingsScreen } from "./app-shell";

const mockDatabase = {};
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDatabase }));
jest.mock("../connections/connections-context", () => ({ useConnections: jest.fn() }));
jest.mock("../security/app-lock-context", () => ({ useAppLock: jest.fn() }));
jest.mock("../state/connection-runtime-context", () => ({ useConnectionRuntime: jest.fn() }));
jest.mock("../state/transcript-preferences", () => ({ useTranscriptPreferences: jest.fn() }));
jest.mock("../state/workspace-selection-context", () => ({ useWorkspaceSelection: jest.fn() }));
jest.mock("../updates/app-updates", () => ({ AppUpdateCard: () => null }));
jest.mock("../notifications/notification-client", () => ({
  sendNotificationDeviceCommand: jest.fn(),
}));
jest.mock("../notifications/notification-pairing-repository", () => ({
  getNotificationPairingByConnectionID: jest.fn(),
  readNotificationPairingSecret: jest.fn(),
}));
jest.mock("./form-request-list", () => ({ FormRequestList: () => null }));

const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

function navigationMock() {
  return {
    addListener: jest.fn((_event: string, _listener: () => void) => () => {}),
    navigate: jest.fn(),
    popTo: jest.fn(),
  };
}

function renderSettings(navigation = navigationMock()) {
  render(
    <SettingsScreen
      navigation={navigation as never}
      route={{ key: "settings", name: "Settings" }}
    />,
  );
  return navigation;
}

beforeEach(() => {
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 } });
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ baseUrl: "https://example.test", id: "connection-1", name: "Test server" }],
    selectedProfileId: "connection-1",
  } as never);
  jest
    .mocked(useConnectionRuntime)
    .mockReturnValue({ reconnectAttempt: 0, status: "connected" } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete", freshness: "current" },
    pendingCount: 2,
  } as never);
  jest.mocked(useAppLock).mockReturnValue({
    busy: false,
    enabled: false,
    setEnabled: jest.fn(),
  } as never);
  jest.mocked(useTranscriptPreferences).mockReturnValue({
    busy: false,
    defaultDelivery: "steer",
    detailed: false,
    reasoning: true,
    update: jest.fn(),
  } as never);
  jest.mocked(getNotificationPairingByConnectionID).mockResolvedValue(undefined);
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

test("opens Needs you, followed projects, and connections from the first group", async () => {
  const navigation = renderSettings();
  const needsYou = screen.getByRole("button", { name: "Needs you" });
  expect(needsYou).toHaveProp("accessibilityValue", {
    text: "2 requests need you, up to date",
  });
  expect(screen.getByText("2")).toBeOnTheScreen();
  fireEvent.press(needsYou);
  fireEvent.press(screen.getByRole("button", { name: "Followed projects" }));
  fireEvent.press(screen.getByRole("button", { name: "Connections" }));
  expect(navigation.navigate.mock.calls).toEqual([
    ["Pending", undefined, { pop: true }],
    ["FollowedProjects"],
    ["Connections", undefined, { pop: true }],
  ]);
  expect(screen.queryByRole("button", { name: "Manage followed projects" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Manage connections" })).toBeNull();
  expect(screen.queryByText("Connected")).toBeNull();
  await screen.findByRole("button", { name: "Pair notifications" });
});

test("switches are named after their visible titles", async () => {
  renderSettings();
  await screen.findByRole("button", { name: "Pair notifications" });
  const labels = screen
    .UNSAFE_getAllByType(Switch)
    .map((control) => control.props.accessibilityLabel as string);
  expect(labels).toEqual([
    "Detailed transcript",
    "Show reasoning",
    "App lock",
    "Mobile notifications",
  ]);
});

test("an unpaired connection offers pairing and refreshes when Settings regains focus", async () => {
  const navigation = renderSettings();
  fireEvent.press(await screen.findByRole("button", { name: "Pair notifications" }));
  expect(navigation.navigate).toHaveBeenCalledWith("Pairing");
  expect(screen.getByText(/Pair this connection to get notifications/)).toBeOnTheScreen();

  jest.mocked(getNotificationPairingByConnectionID).mockResolvedValue({
    bindingID: "binding",
    brokerOrigin: "https://relay.example.test",
  } as never);
  jest.mocked(readNotificationPairingSecret).mockResolvedValue({ deviceKey: "key" } as never);
  jest.mocked(sendNotificationDeviceCommand).mockResolvedValue({ enabled: true } as never);
  const focus = navigation.addListener.mock.calls.find(([event]) => event === "focus");
  focus?.[1]();
  await waitFor(() =>
    expect(screen.getByText("On for every phone paired with this connection.")).toBeOnTheScreen(),
  );
  expect(screen.queryByRole("button", { name: "Pair notifications" })).toBeNull();
});

test("tablet settings keep the connection bar beside the rail", async () => {
  Dimensions.set({ window: { width: 1024, height: 768, scale: 2, fontScale: 1 } });
  renderSettings();
  expect(screen.getAllByText("Connected")).toHaveLength(2);
  await screen.findByRole("button", { name: "Pair notifications" });
});
