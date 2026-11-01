import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, AppState, type AppStateStatus, Platform, Share } from "react-native";

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

const mockDb = {};
const pairing = { bindingID: "binding-1", brokerOrigin: "https://broker.test" };
let appStateListener: ((state: AppStateStatus) => void) | undefined;
const removeAppStateListener = jest.fn();
const removeFocusListener = jest.fn();

jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("../connections/connections-context", () => ({ useConnections: jest.fn() }));
jest.mock("../notifications/notification-client", () => ({
  sendNotificationDeviceCommand: jest.fn(),
}));
jest.mock("../notifications/notification-pairing-repository", () => ({
  getNotificationPairingByConnectionID: jest.fn(),
  readNotificationPairingSecret: jest.fn(),
}));
jest.mock("../security/app-lock-context", () => ({ useAppLock: jest.fn() }));
jest.mock("../state/connection-runtime-context", () => ({ useConnectionRuntime: jest.fn() }));
jest.mock("../state/transcript-preferences", () => ({ useTranscriptPreferences: jest.fn() }));
jest.mock("../state/workspace-selection-context", () => ({ useWorkspaceSelection: jest.fn() }));
jest.mock("../updates/app-updates", () => ({ AppUpdateCard: () => null }));
jest.mock("./form-request-list", () => ({ FormRequestList: () => null }));

const update = jest.fn(async () => undefined);
const setAppLockEnabled = jest.fn(async () => undefined);

function mockShell({
  appLockError,
  pendingCount = 0,
  selectedProfileId,
  transcript = {},
}: {
  appLockError?: string;
  pendingCount?: number;
  selectedProfileId?: string;
  transcript?: Record<string, unknown>;
} = {}) {
  jest.mocked(useConnections).mockReturnValue({
    profiles: [{ baseUrl: "https://server.test", id: "connection-1", name: "Test server" }],
    selectedProfileId,
  } as never);
  jest.mocked(useConnectionRuntime).mockReturnValue({
    getDiagnosticsText: () => "redacted report",
    reconnectAttempt: 0,
    status: "connected",
  } as never);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete", freshness: "current" },
    pendingCount,
  } as never);
  jest.mocked(useAppLock).mockReturnValue({
    busy: false,
    enabled: false,
    error: appLockError,
    setEnabled: setAppLockEnabled,
  } as never);
  jest.mocked(useTranscriptPreferences).mockReturnValue({
    busy: false,
    defaultDelivery: "steer",
    detailed: false,
    error: false,
    reasoning: false,
    update,
    ...transcript,
  } as never);
}

function navigationMock() {
  return {
    addListener: jest.fn((_event: string, _listener: () => void) => removeFocusListener),
    navigate: jest.fn(),
    popTo: jest.fn(),
  };
}

function renderSettings(navigation = navigationMock()) {
  const props = { navigation } as unknown as Parameters<typeof SettingsScreen>[0];
  return render(<SettingsScreen {...props} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  appStateListener = undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove: removeAppStateListener };
  });
  jest.mocked(getNotificationPairingByConnectionID).mockResolvedValue(pairing as never);
  jest
    .mocked(readNotificationPairingSecret)
    .mockResolvedValue({ deviceKey: "device-key" } as never);
  jest.mocked(sendNotificationDeviceCommand).mockResolvedValue({ enabled: true } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("needs a selected connection before notifications can be set up", async () => {
  mockShell({ pendingCount: 120 });
  const navigation = navigationMock();
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
  const view = renderSettings(navigation);

  expect(await screen.findByText("Choose a connection to set up notifications.")).toBeOnTheScreen();
  expect(getNotificationPairingByConnectionID).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Pair notifications" })).toBeNull();
  expect(screen.getByLabelText("Mobile notifications")).toHaveProp("disabled", true);
  expect(screen.getByLabelText("Mobile notifications")).toHaveProp("value", false);
  expect(screen.getByText("No connection selected")).toBeOnTheScreen();
  expect(screen.getByText("99+")).toBeOnTheScreen();
  expect(
    screen.getByText("Compact: group activity and collapse routine details."),
  ).toBeOnTheScreen();
  expect(screen.queryByRole("alert")).toBeNull();

  fireEvent.press(screen.getByRole("button", { name: "Share diagnostics" }));
  await waitFor(() => expect(share).toHaveBeenCalledWith({ message: "redacted report" }));
  view.unmount();
  expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  expect(removeFocusListener).toHaveBeenCalledTimes(1);
});

test("updates transcript and app lock preferences and reports their errors", async () => {
  mockShell({ appLockError: "Device authentication is unavailable.", transcript: { error: true } });
  const view = renderSettings();
  await screen.findByText("Choose a connection to set up notifications.");

  fireEvent.press(screen.getByRole("radio", { name: "Queue" }));
  expect(update).toHaveBeenCalledWith({ defaultDelivery: "queue" });
  fireEvent(screen.getByLabelText("Detailed transcript"), "valueChange", true);
  expect(update).toHaveBeenCalledWith({ detailed: true });
  fireEvent(screen.getByLabelText("Show reasoning"), "valueChange", true);
  expect(update).toHaveBeenCalledWith({ reasoning: true });
  fireEvent(screen.getByLabelText("App lock"), "valueChange", true);
  expect(setAppLockEnabled).toHaveBeenCalledWith(true);
  expect(screen.getByText("Device authentication is unavailable.")).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Message preferences could not be loaded or saved. Try changing the setting again.",
    ),
  ).toBeOnTheScreen();
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  view.unmount();
});

test("ignores delivery changes while transcript preferences are saving", async () => {
  mockShell({ transcript: { busy: true, detailed: true } });
  const view = renderSettings();
  await screen.findByText("Choose a connection to set up notifications.");

  expect(
    screen.getByText("Detailed: individual tool executions and system notices."),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText("Detailed transcript")).toHaveProp("disabled", true);
  fireEvent.press(screen.getByRole("radio", { name: "Queue" }));
  expect(update).not.toHaveBeenCalled();
  view.unmount();
});

test("reads, pauses, and enables notifications for the selected connection", async () => {
  mockShell({ selectedProfileId: "connection-1" });
  const view = renderSettings();

  expect(screen.getByLabelText("Loading mobile notification setting")).toBeOnTheScreen();
  expect(screen.getByText("Checking notification status.")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Mobile notifications")).toBeNull();
  expect(
    await screen.findByText("On for every phone paired with this connection."),
  ).toBeOnTheScreen();
  expect(getNotificationPairingByConnectionID).toHaveBeenCalledWith(mockDb, "connection-1");
  expect(sendNotificationDeviceCommand).toHaveBeenCalledWith({
    bindingID: "binding-1",
    brokerOrigin: "https://broker.test",
    deviceKey: "device-key",
    operation: "status",
  });
  expect(screen.getByText("Test server")).toBeOnTheScreen();
  expect(screen.getByLabelText("Mobile notifications")).toHaveProp("value", true);
  expect(screen.getByLabelText("Mobile notifications")).toHaveProp("disabled", false);
  expect(screen.queryByRole("button", { name: "Pair notifications" })).toBeNull();

  let finishPause: (value: unknown) => void = () => undefined;
  jest.mocked(sendNotificationDeviceCommand).mockReturnValueOnce(
    new Promise((resolve) => {
      finishPause = resolve;
    }) as never,
  );
  await act(async () => {
    fireEvent(screen.getByLabelText("Mobile notifications"), "valueChange", false);
  });
  expect(screen.getByLabelText("Mobile notifications")).toHaveProp("disabled", true);
  await act(async () => finishPause({ enabled: false }));
  expect(sendNotificationDeviceCommand).toHaveBeenLastCalledWith(
    expect.objectContaining({ operation: "pause" }),
  );
  expect(
    screen.getByText("Paused. New requests will not create mobile notifications."),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText("Mobile notifications")).toHaveProp("disabled", false);

  await act(async () => {
    fireEvent(screen.getByLabelText("Mobile notifications"), "valueChange", true);
  });
  expect(sendNotificationDeviceCommand).toHaveBeenLastCalledWith(
    expect.objectContaining({ operation: "enable" }),
  );
  view.unmount();
});

test("reports notification failures, announces them, and refreshes when the app returns", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
  mockShell({ selectedProfileId: "connection-1" });
  jest.mocked(sendNotificationDeviceCommand).mockRejectedValueOnce(new Error("offline"));
  const view = renderSettings();

  expect(await screen.findByText("Notification status is unavailable.")).toBeOnTheScreen();
  expect(screen.getByText("Notification settings could not be loaded or saved.")).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledWith("Notification settings could not be loaded or saved.");
  expect(screen.getByLabelText("Mobile notifications")).toHaveProp("disabled", true);

  await act(async () => {
    appStateListener?.("background");
  });
  expect(getNotificationPairingByConnectionID).toHaveBeenCalledTimes(1);
  await act(async () => {
    appStateListener?.("active");
  });
  expect(getNotificationPairingByConnectionID).toHaveBeenCalledTimes(2);
  expect(screen.getByText("On for every phone paired with this connection.")).toBeOnTheScreen();
  expect(screen.queryByText("Notification settings could not be loaded or saved.")).toBeNull();

  jest.mocked(sendNotificationDeviceCommand).mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    fireEvent(screen.getByLabelText("Mobile notifications"), "valueChange", false);
  });
  expect(screen.getByText("Notification settings could not be loaded or saved.")).toBeOnTheScreen();
  expect(screen.getByText("On for every phone paired with this connection.")).toBeOnTheScreen();
  view.unmount();
});

test("drops a pairing lookup that finishes after leaving Settings", async () => {
  mockShell({ selectedProfileId: "connection-1" });
  let resolvePairing: (value: unknown) => void = () => undefined;
  jest.mocked(getNotificationPairingByConnectionID).mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePairing = resolve;
    }) as never,
  );
  const view = renderSettings();
  view.unmount();
  await act(async () => {
    resolvePairing(pairing);
  });
  expect(readNotificationPairingSecret).not.toHaveBeenCalled();
});

test.each([
  ["resolves", (finish: Deferred) => finish.resolve({ enabled: true })],
  ["fails", (finish: Deferred) => finish.reject(new Error("offline"))],
])("drops a status check that %s after leaving Settings", async (_outcome, settle) => {
  mockShell({ selectedProfileId: "connection-1" });
  const finish = deferred();
  jest.mocked(sendNotificationDeviceCommand).mockReturnValueOnce(finish.promise as never);
  const errors = jest.spyOn(console, "error");
  const view = renderSettings();
  await waitFor(() => expect(sendNotificationDeviceCommand).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => {
    settle(finish);
    await finish.promise.catch(() => undefined);
  });
  expect(errors).not.toHaveBeenCalled();
});

type Deferred = ReturnType<typeof deferred>;

function deferred() {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}
