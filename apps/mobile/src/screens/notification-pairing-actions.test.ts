import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { encodeNotificationBytes } from "@opencode2-mobile/notification-protocol";
import type { PermissionResponse } from "expo-camera";
import type { SQLiteDatabase } from "expo-sqlite";
import { Alert } from "react-native";
import type { useConnections } from "../connections/connections-context";
import {
  type NotificationPairingState,
  notificationPairingActions,
} from "./notification-pairing-actions";
import { inspectPairingCode, type PairingPreview } from "./notification-pairing-model";

type Bootstrap = {
  allowDevelopmentHttp: boolean;
  auth:
    | { mode: "basic"; password: string; username: string }
    | { mode: "bearer"; token: string }
    | { mode: "none" };
  baseUrl: string;
  name: string;
};
type RequestOptions = { signal?: AbortSignal };

const mockRegisterPush = jest.fn(async () => ({
  deviceName: "Phone",
  expoPushToken: "push-token",
  platform: "ios" as const,
}));
const mockIssue = jest.fn(async (_prepared: unknown, _signal?: AbortSignal) => notificationCode());
const mockCreateMaterial = jest.fn(() => ({ bindingID: "binding-1", deviceKey: "device-key" }));
const mockComplete = jest.fn(async (..._args: unknown[]) => ({
  bindingID: "binding-1",
  bootstrap: bootstrap(),
  brokerID: "broker-1",
  brokerOrigin: "https://broker.test",
  deviceKey: "registered-key",
}));
const mockSendCommand = jest.fn(async (_input: unknown) => ({
  enabled: false,
  updatedAtMs: 1,
  v: 1,
}));
const mockStage = jest.fn(async (..._args: unknown[]) => ({
  bindingID: "binding-1",
  brokerOrigin: "https://broker.test",
  secretRef: "secret-1",
}));
const mockFinish = jest.fn(async (..._args: unknown[]) => undefined);
const mockInstall = jest.fn(async (..._args: unknown[]) => undefined);
const mockHealth = jest.fn(async (_options?: RequestOptions) => ({ pid: 42, version: "test" }));
const mockList = jest.fn(async (_input: unknown, _options?: RequestOptions) => ({ data: [] }));
const mockCreateClient = jest.fn((_options: unknown) => ({
  server: { status: mockHealth },
  session: { list: mockList },
}));

jest.mock("expo-crypto", () => ({ randomUUID: () => "test-id" }));
jest.mock("../expo-open-code-fetch", () => ({ boundedOpenCodeFetch: "bounded-fetch" }));
jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  createOpenCodeClient: (options: unknown) => mockCreateClient(options),
  normalizeOpenCodeBaseUrl: (value: string) => new URL(value).origin,
}));
jest.mock("../notifications/notification-registration", () => ({
  registerForOpenCodePushNotifications: () => mockRegisterPush(),
}));
jest.mock("../notifications/notification-pairing-repository", () => ({
  finishPendingNotificationRevocation: (...args: unknown[]) => mockFinish(...args),
  installNotificationPairing: (...args: unknown[]) => mockInstall(...args),
  stagePendingNotificationRevocation: (...args: unknown[]) => mockStage(...args),
}));
jest.mock("../notifications/notification-client", () => ({
  ...jest.requireActual<object>("../notifications/notification-client"),
  completeNotificationPairing: (...args: unknown[]) => mockComplete(...args),
  createNotificationPairingMaterial: () => mockCreateMaterial(),
  issueNotificationPairingFromOpenCode: (prepared: unknown, signal?: AbortSignal) =>
    mockIssue(prepared, signal),
  sendNotificationDeviceCommand: (input: unknown) => mockSendCommand(input),
}));

const db = { name: "db" } as unknown as SQLiteDatabase;
const malformed = "The pairing code is malformed or was altered.";

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

function notificationCode() {
  return {
    allowDevelopmentHttp: false,
    authMode: "bearer" as const,
    brokerOrigin: "https://broker.test",
    challengeID: "challenge-1",
    expiresAtMs: Date.now() + 60_000,
    name: "Office server",
    openCodeOrigin: "https://server.test",
    pairingSecret: encodeNotificationBytes(new Uint8Array(32)),
    v: 1 as const,
  };
}

function bootstrap(auth: Bootstrap["auth"] = { mode: "bearer", token: "token" }): Bootstrap {
  return { allowDevelopmentHttp: false, auth, baseUrl: "https://server.test", name: "Office" };
}

function openCodeCode(url = "https://server.test") {
  return JSON.stringify({ password: "test-password", urls: [url], username: "opencode" });
}

function openCodePreview(url?: string): PairingPreview {
  const result = inspectPairingCode(openCodeCode(url));
  if (!("preview" in result)) throw new Error("expected a preview");
  return result.preview;
}

function hangUntilAborted(options?: RequestOptions) {
  return new Promise<never>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

function setup(overrides: Partial<NotificationPairingState> = {}) {
  const connections = {
    remove: jest.fn(async (_id: string) => undefined),
    save: jest.fn(async (_input: unknown) => "connection-1"),
  };
  const onDone = jest.fn();
  const state = {
    attempt: { current: undefined },
    busy: false,
    cameraPermission: { granted: true } as PermissionResponse,
    expired: false,
    lastScan: { current: undefined },
    manualCode: "",
    mounted: { current: true },
    pairingMaterial: { current: undefined },
    preview: undefined,
    requestCameraPermission: jest.fn(async () => ({ granted: true }) as PermissionResponse),
    setBusy: jest.fn(),
    setCameraBlocked: jest.fn(),
    setCancelling: jest.fn(),
    setError: jest.fn(),
    setManualCode: jest.fn(),
    setPreview: jest.fn(),
    setScanError: jest.fn(),
    setScanning: jest.fn(),
    ...overrides,
  } satisfies NotificationPairingState;
  const actions = notificationPairingActions(state, {
    connections: connections as unknown as ReturnType<typeof useConnections>,
    db,
    onDone,
  });
  return { actions, connections, onDone, state };
}

test("inspects the manual code and clears stale pairing material", () => {
  const { actions, state } = setup({
    manualCode: openCodeCode(),
    pairingMaterial: { current: { bindingID: "old", deviceKey: "old-key" } },
  });
  actions.inspect();
  expect(state.pairingMaterial.current).toBeUndefined();
  expect(state.setError).toHaveBeenCalledWith(undefined);
  expect(state.setScanError).toHaveBeenCalledWith(undefined);
  expect(state.setManualCode).toHaveBeenCalledWith("");
  expect(state.setPreview).toHaveBeenCalledWith(openCodePreview());
  expect(state.setScanning).toHaveBeenCalledWith(false);
});

test("reports an unreadable pasted code below the form", () => {
  const { actions, state } = setup({ manualCode: "not a pairing code" });
  actions.inspect();
  expect(state.setPreview).toHaveBeenCalledWith(undefined);
  expect(state.setError).toHaveBeenLastCalledWith(malformed);
  expect(state.setScanError).toHaveBeenLastCalledWith(undefined);
  expect(state.setManualCode).not.toHaveBeenCalled();
  expect(state.setScanning).not.toHaveBeenCalled();
});

test("reports an unreadable scanned code by the camera", () => {
  const { actions, state } = setup({ manualCode: openCodeCode() });
  actions.inspect("not a pairing code", "scan");
  expect(state.setPreview).toHaveBeenCalledWith(undefined);
  expect(state.setScanError).toHaveBeenLastCalledWith(malformed);
  expect(state.setError).toHaveBeenLastCalledWith(undefined);
  expect(state.setScanning).not.toHaveBeenCalled();
});

test("inspects each new scan once and ignores scans while busy", () => {
  const { actions, state } = setup();
  actions.scanned("not a pairing code");
  actions.scanned("not a pairing code");
  expect(state.lastScan.current).toBe("not a pairing code");
  expect(state.setScanError).toHaveBeenCalledTimes(2);
  actions.scanned(openCodeCode());
  expect(state.lastScan.current).toBe(openCodeCode());
  expect(state.setPreview).toHaveBeenLastCalledWith(openCodePreview());

  const busy = setup({ busy: true });
  busy.actions.scanned(openCodeCode());
  expect(busy.state.lastScan.current).toBeUndefined();
  expect(busy.state.setPreview).not.toHaveBeenCalled();
});

test("clears the preview when the pasted code changes", () => {
  const { actions, state } = setup();
  actions.editCode("abc");
  expect(state.setManualCode).toHaveBeenCalledWith("abc");
  expect(state.setPreview).toHaveBeenCalledWith(undefined);
});

test("opens the scanner when camera access is already granted", async () => {
  const { actions, state } = setup({ lastScan: { current: "previous" } });
  await actions.openScanner();
  expect(state.lastScan.current).toBeUndefined();
  expect(state.setError).toHaveBeenCalledWith(undefined);
  expect(state.setScanError).toHaveBeenCalledWith(undefined);
  expect(state.requestCameraPermission).not.toHaveBeenCalled();
  expect(state.setCameraBlocked).toHaveBeenCalledWith(false);
  expect(state.setScanning).toHaveBeenCalledWith(true);
});

test("requests camera access before scanning", async () => {
  const { actions, state } = setup({ cameraPermission: null });
  await actions.openScanner();
  expect(state.requestCameraPermission).toHaveBeenCalledTimes(1);
  expect(state.setCameraBlocked).toHaveBeenCalledWith(false);
  expect(state.setScanning).toHaveBeenCalledWith(true);
});

test("asks for a pasted code when camera access is denied", async () => {
  const { actions, state } = setup({
    cameraPermission: { granted: false } as PermissionResponse,
    requestCameraPermission: jest.fn(
      async () => ({ canAskAgain: true, granted: false }) as PermissionResponse,
    ),
  });
  await actions.openScanner();
  expect(state.setCameraBlocked).toHaveBeenCalledWith(false);
  expect(state.setError).toHaveBeenLastCalledWith(
    "Camera access was denied. Paste the pairing code instead.",
  );
  expect(state.setScanning).not.toHaveBeenCalled();
});

test("points to Settings when camera access can no longer be requested", async () => {
  const { actions, state } = setup({
    cameraPermission: { granted: false } as PermissionResponse,
    requestCameraPermission: jest.fn(
      async () => ({ canAskAgain: false, granted: false }) as PermissionResponse,
    ),
  });
  await actions.openScanner();
  expect(state.setCameraBlocked).toHaveBeenCalledWith(true);
  expect(state.setError).toHaveBeenLastCalledWith(
    "Camera access is off for this app. Turn it on in Settings, or paste the pairing code instead.",
  );
  expect(state.setScanning).not.toHaveBeenCalled();
});

test("closes the scanner and its error", () => {
  const { actions, state } = setup();
  actions.closeScanner();
  expect(state.setScanning).toHaveBeenCalledWith(false);
  expect(state.setScanError).toHaveBeenCalledWith(undefined);
});

test("ignores direct pairing without an OpenCode preview or while busy", async () => {
  const notification = setup({ preview: { code: notificationCode(), kind: "notification" } });
  await notification.actions.pairWithoutNotifications();
  const busy = setup({ busy: true, preview: openCodePreview() });
  await busy.actions.pairWithoutNotifications();
  expect(notification.state.setBusy).not.toHaveBeenCalled();
  expect(busy.state.setBusy).not.toHaveBeenCalled();
  expect(mockCreateClient).not.toHaveBeenCalled();
});

test("connects directly with the /pair credentials", async () => {
  const { actions, connections, onDone, state } = setup({ preview: openCodePreview() });
  await actions.pairWithoutNotifications();
  expect(mockCreateClient).toHaveBeenCalledWith({
    authorization: expect.stringMatching(/^Basic /),
    baseUrl: "https://server.test",
    fetch: "bounded-fetch",
  });
  expect(connections.save).toHaveBeenCalledWith({
    credential: {
      mode: "basic",
      password: "test-password",
      schemaVersion: 1,
      username: "opencode",
    },
    draft: {
      allowDevelopmentHttp: false,
      authMode: "basic",
      baseUrl: "https://server.test",
      name: "OpenCode on server.test",
    },
    health: { checkedAtMs: expect.any(Number), pid: 42, version: "test" },
  });
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(state.attempt.current).toBeUndefined();
  expect(jest.mocked(state.setBusy).mock.calls).toEqual([[true], [false]]);
  expect(jest.mocked(state.setCancelling).mock.calls).toEqual([[false], [false]]);
});

test("reports a direct connection that could not be saved", async () => {
  const { actions, connections, onDone, state } = setup({ preview: openCodePreview() });
  connections.save.mockRejectedValueOnce(new Error("disk full"));
  await actions.pairWithoutNotifications();
  expect(mockList).toHaveBeenCalledWith(
    { limit: 1, order: "desc" },
    { signal: expect.any(AbortSignal) },
  );
  expect(state.setError).toHaveBeenLastCalledWith(
    "The validated OpenCode connection could not be saved on this device.",
  );
  expect(onDone).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(jest.mocked(state.setBusy).mock.calls).toEqual([[true], [false]]);
});

test("does not close a screen that unmounted during a direct connection", async () => {
  const { actions, connections, onDone } = setup({
    mounted: { current: false },
    preview: openCodePreview(),
  });
  await actions.pairWithoutNotifications();
  expect(connections.save).toHaveBeenCalledTimes(1);
  expect(onDone).not.toHaveBeenCalled();
});

test("cancels a direct connection without saving or reporting an error", async () => {
  mockHealth.mockImplementationOnce(hangUntilAborted);
  const { actions, connections, onDone, state } = setup({ preview: openCodePreview() });
  const pairing = actions.pairWithoutNotifications();
  const signal = mockHealth.mock.calls[0]?.[0]?.signal;
  expect(signal?.aborted).toBe(false);
  actions.cancelAttempt();
  await pairing;
  expect(signal?.aborted).toBe(true);
  expect(state.setCancelling).toHaveBeenCalledWith(true);
  expect(connections.save).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
  expect(state.setError).toHaveBeenCalledTimes(1);
  expect(state.setError).toHaveBeenCalledWith(undefined);
  expect(state.attempt.current).toBeUndefined();
  expect(jest.mocked(state.setBusy).mock.calls).toEqual([[true], [false]]);
});

test("stops waiting for OpenCode after 10 seconds", async () => {
  jest.useFakeTimers();
  mockHealth.mockImplementationOnce(hangUntilAborted);
  const { actions, connections, state } = setup({ preview: openCodePreview() });
  const pairing = actions.pairWithoutNotifications();
  jest.advanceTimersByTime(9_999);
  expect(mockHealth.mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
  jest.advanceTimersByTime(1);
  await pairing;
  expect(state.setError).toHaveBeenLastCalledWith(
    "The OpenCode server did not respond within 10 seconds. Check that it is running and reachable.",
  );
  expect(connections.save).not.toHaveBeenCalled();
});

test("aborts the previous attempt when a new one starts and ignores its finish", async () => {
  const previous = new AbortController();
  const { actions, state } = setup({
    attempt: { current: previous },
    preview: openCodePreview(),
  });
  await actions.pairWithoutNotifications();
  expect(previous.signal.aborted).toBe(true);
  expect(state.attempt.current).toBeUndefined();

  let release: (value: { pid: number; version: string }) => void = () => undefined;
  mockHealth.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
  const first = actions.pairWithoutNotifications();
  const replacement = new AbortController();
  state.attempt.current = replacement;
  jest.mocked(state.setBusy).mockClear();
  release({ pid: 1, version: "test" });
  await first;
  expect(state.attempt.current).toBe(replacement);
  expect(state.setBusy).not.toHaveBeenCalled();
});

test("ignores pairing without a preview, while busy, or after the code expired", async () => {
  await setup().actions.pair();
  await setup({ busy: true, preview: openCodePreview() }).actions.pair();
  await setup({
    expired: true,
    preview: { code: notificationCode(), kind: "notification" },
  }).actions.pair();
  expect(mockRegisterPush).not.toHaveBeenCalled();
});

test("pairs a notification code and installs the pairing", async () => {
  const code = notificationCode();
  const { actions, connections, onDone, state } = setup({
    preview: { code, kind: "notification" },
  });
  await actions.pair();
  expect(mockIssue).not.toHaveBeenCalled();
  expect(mockStage).toHaveBeenCalledWith(db, {
    bindingID: "binding-1",
    brokerOrigin: "https://broker.test",
    deviceKey: "device-key",
  });
  expect(mockComplete).toHaveBeenCalledWith(
    code,
    {
      bindingID: "binding-1",
      deviceName: "Phone",
      expoPushToken: "push-token",
      platform: "ios",
    },
    "device-key",
    expect.any(AbortSignal),
  );
  expect(mockCreateClient).toHaveBeenCalledWith({
    authorization: "Bearer token",
    baseUrl: "https://server.test",
    fetch: "bounded-fetch",
  });
  expect(connections.save).toHaveBeenCalledWith({
    credential: { mode: "bearer", schemaVersion: 1, token: "token" },
    draft: {
      allowDevelopmentHttp: false,
      authMode: "bearer",
      baseUrl: "https://server.test",
      name: "Office",
    },
    health: { checkedAtMs: expect.any(Number), pid: 42, version: "test" },
  });
  expect(mockInstall).toHaveBeenCalledWith(db, {
    bindingID: "binding-1",
    brokerID: "broker-1",
    brokerOrigin: "https://broker.test",
    connectionId: "connection-1",
    deviceKey: "registered-key",
  });
  expect(state.pairingMaterial.current).toBeUndefined();
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(jest.mocked(state.setBusy).mock.calls).toEqual([[true], [false]]);
});

test("does not close a screen that unmounted during pairing", async () => {
  const { actions, onDone } = setup({
    mounted: { current: false },
    preview: { code: notificationCode(), kind: "notification" },
  });
  await actions.pair();
  expect(mockInstall).toHaveBeenCalledTimes(1);
  expect(onDone).not.toHaveBeenCalled();
});

test("pairs an OpenCode code through the broker without server credentials", async () => {
  mockComplete.mockResolvedValueOnce({
    bindingID: "binding-1",
    bootstrap: bootstrap({ mode: "none" }),
    brokerID: "broker-1",
    brokerOrigin: "https://broker.test",
    deviceKey: "registered-key",
  });
  const preview = openCodePreview();
  const material = { bindingID: "retry", deviceKey: "retry-key" };
  const { actions, connections, onDone } = setup({
    pairingMaterial: { current: material },
    preview,
  });
  await actions.pair();
  expect(mockIssue).toHaveBeenCalledWith(
    preview.kind === "opencode" && preview.prepared,
    expect.any(AbortSignal),
  );
  expect(mockCreateMaterial).not.toHaveBeenCalled();
  expect(mockStage).toHaveBeenCalledWith(db, {
    bindingID: "retry",
    brokerOrigin: "https://broker.test",
    deviceKey: "retry-key",
  });
  expect(mockCreateClient).toHaveBeenCalledWith({
    baseUrl: "https://server.test",
    fetch: "bounded-fetch",
  });
  expect(connections.save).toHaveBeenCalledWith(
    expect.not.objectContaining({ credential: expect.anything() }),
  );
  expect(onDone).toHaveBeenCalledTimes(1);
});

test("revokes the staged binding when broker registration fails", async () => {
  mockComplete.mockRejectedValueOnce(new Error("BROKER_ERROR"));
  const { actions, state } = setup({
    preview: { code: notificationCode(), kind: "notification" },
  });
  await actions.pair();
  expect(mockSendCommand).toHaveBeenCalledWith({
    bindingID: "binding-1",
    brokerOrigin: "https://broker.test",
    deviceKey: "device-key",
    operation: "revoke",
  });
  expect(mockFinish).toHaveBeenCalledWith(db, {
    bindingID: "binding-1",
    brokerOrigin: "https://broker.test",
    secretRef: "secret-1",
  });
  expect(state.pairingMaterial.current).toBeUndefined();
  expect(state.setError).toHaveBeenLastCalledWith(
    "The notification broker rejected or could not complete this pairing code (BROKER_ERROR).",
  );
});

test("finishes revocation when the broker no longer knows the device", async () => {
  mockComplete.mockRejectedValueOnce(new Error("BROKER_ERROR"));
  mockSendCommand.mockRejectedValueOnce(new Error("DEVICE_NOT_FOUND"));
  const { actions, state } = setup({
    preview: { code: notificationCode(), kind: "notification" },
  });
  await actions.pair();
  expect(mockFinish).toHaveBeenCalledTimes(1);
  expect(state.pairingMaterial.current).toBeUndefined();
});

test("keeps the pairing material when revocation fails", async () => {
  mockComplete.mockRejectedValueOnce(new Error("BROKER_ERROR"));
  mockSendCommand.mockRejectedValueOnce(new Error("network down"));
  const { actions, state } = setup({
    preview: { code: notificationCode(), kind: "notification" },
  });
  await actions.pair();
  expect(mockFinish).not.toHaveBeenCalled();
  expect(state.pairingMaterial.current).toEqual({
    bindingID: "binding-1",
    deviceKey: "device-key",
  });
});

test("removes the saved connection when the pairing cannot be stored", async () => {
  mockInstall.mockRejectedValueOnce(new Error("keychain locked"));
  const { actions, connections, onDone, state } = setup({ preview: openCodePreview() });
  await actions.pair();
  expect(connections.remove).toHaveBeenCalledWith("connection-1");
  expect(onDone).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(state.setError).toHaveBeenLastCalledWith(
    "The notification key could not be saved securely on this device.",
  );
});

test("asks for manual cleanup when the saved connection cannot be removed", async () => {
  mockInstall.mockRejectedValueOnce(new Error("keychain locked"));
  const { actions, connections, state } = setup({
    preview: { code: notificationCode(), kind: "notification" },
  });
  connections.remove.mockRejectedValueOnce(new Error("locked"));
  await actions.pair();
  expect(state.setError).toHaveBeenLastCalledWith(
    "Pairing failed after saving the connection. Remove it from Connections before retrying.",
  );
});

test("connects directly when broker registration fails for an OpenCode code", async () => {
  mockComplete.mockRejectedValueOnce(new Error("BROKER_ERROR"));
  const { actions, connections, onDone, state } = setup({ preview: openCodePreview() });
  await actions.pair();
  expect(mockSendCommand).toHaveBeenCalledTimes(1);
  expect(connections.save).toHaveBeenCalledWith(
    expect.objectContaining({
      credential: {
        mode: "basic",
        password: "test-password",
        schemaVersion: 1,
        username: "opencode",
      },
    }),
  );
  expect(Alert.alert).toHaveBeenCalledWith(
    "Server connected",
    "Notification setup was unavailable. Connected without notifications.",
  );
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(jest.mocked(state.setBusy).mock.calls).toEqual([[true], [false]]);
});

test("does not fall back when the paired OpenCode server fails validation", async () => {
  mockHealth.mockRejectedValueOnce(new Error("unreachable"));
  const { actions, connections, onDone, state } = setup({ preview: openCodePreview() });
  await actions.pair();
  expect(connections.save).not.toHaveBeenCalled();
  expect(connections.remove).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
  expect(state.setError).toHaveBeenLastCalledWith(
    "The paired OpenCode address or credentials could not be validated.",
  );
});

test("cancelling during pairing revokes the binding without falling back", async () => {
  const { actions, connections, onDone, state } = setup({ preview: openCodePreview() });
  mockComplete.mockImplementationOnce(async (...args: unknown[]) => {
    const pending = hangUntilAborted({ signal: args[3] as AbortSignal });
    actions.cancelAttempt();
    return pending;
  });
  await actions.pair();
  expect(mockSendCommand).toHaveBeenCalledTimes(1);
  expect(mockFinish).toHaveBeenCalledTimes(1);
  expect(connections.save).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
  expect(state.setError).toHaveBeenCalledTimes(1);
  expect(state.setError).toHaveBeenCalledWith(undefined);
  expect(jest.mocked(state.setBusy).mock.calls).toEqual([[true], [false]]);
});

test("stops between stages once the attempt is cancelled", async () => {
  const { actions, state } = setup({ preview: openCodePreview() });
  mockRegisterPush.mockImplementationOnce(async () => {
    actions.cancelAttempt();
    return { deviceName: "Phone", expoPushToken: "push-token", platform: "ios" };
  });
  await actions.pair();
  expect(mockIssue).not.toHaveBeenCalled();
  expect(mockStage).not.toHaveBeenCalled();
  expect(mockCreateClient).not.toHaveBeenCalled();
  expect(state.setError).toHaveBeenCalledTimes(1);
});

test("still reports a saved connection that could not be rolled back after cancelling", async () => {
  const { actions, connections, state } = setup({
    preview: { code: notificationCode(), kind: "notification" },
  });
  mockInstall.mockImplementationOnce(async () => {
    actions.cancelAttempt();
    throw new Error("PAIRING_CANCELLED");
  });
  connections.remove.mockRejectedValueOnce(new Error("locked"));
  await actions.pair();
  expect(connections.remove).toHaveBeenCalledWith("connection-1");
  expect(state.setError).toHaveBeenLastCalledWith(
    "Pairing failed after saving the connection. Remove it from Connections before retrying.",
  );
});
