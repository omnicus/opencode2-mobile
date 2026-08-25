import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { ConnectionScreen } from "./connection-screen";

const mockCreateOpenCodeClient = jest.fn();
const mockProbeEventStream =
  jest.fn<(client: unknown) => Promise<{ cancellation: true; eventType: string }>>();
const mockProbePtyTransport =
  jest.fn<
    (
      client: unknown,
      baseUrl: string,
    ) => Promise<{ cleanup: true; output: true; ticketExpiresIn: number }>
  >();
const mockLifecycleRun = jest.fn(async () => ({
  backgroundCancellation: true as const,
  foregroundHealth: true as const,
  initialEventType: "server.connected",
  reconnectEventType: "server.connected",
}));
const mockLifecycleReset = jest.fn();
const mockConnectionsSave = jest.fn(async () => "profile-1");
const mockConnectionsSelect = jest.fn(async () => undefined);
const mockConnectionsRemove = jest.fn(async () => undefined);
const mockReadCredential = jest.fn<() => Promise<unknown>>(async () => undefined);
const mockSetAppLockEnabled = jest.fn(async () => undefined);
let mockProfiles: unknown[] = [];
let mockSelectedProfileId: string | undefined;
let mockClassifiedError = "UNREACHABLE";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  classifyOpenCodeError: () => mockClassifiedError,
  createBoundedOpenCodeFetch: (delegate: unknown) => delegate,
  createOpenCodeClient: (...args: unknown[]) => mockCreateOpenCodeClient(...args),
  createRedirectSafeOpenCodeFetch: (delegate: unknown) => delegate,
  EventProbeError: class EventProbeError extends Error {},
  normalizeOpenCodeBaseUrl: (value: string) => {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("UNSUPPORTED_PROTOCOL");
    }
    if (url.username || url.password) throw new Error("EMBEDDED_CREDENTIALS");
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new Error("BASE_URL_MUST_BE_ORIGIN");
    }
    return url.origin;
  },
  probeEventStream: (client: unknown) => mockProbeEventStream(client),
  probePtyTransport: (client: unknown, baseUrl: string) => mockProbePtyTransport(client, baseUrl),
  PtyProbeError: class PtyProbeError extends Error {},
  openCodeClientContractVersion: "test",
}));

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-device", () => ({ isDevice: false }));

jest.mock("../connections/connections-context", () => ({
  useConnections: () => ({
    profiles: mockProfiles,
    readCredential: mockReadCredential,
    ready: true,
    remove: mockConnectionsRemove,
    save: mockConnectionsSave,
    select: mockConnectionsSelect,
    selectedProfileId: mockSelectedProfileId,
  }),
}));

jest.mock("../security/app-lock-context", () => ({
  useAppLock: () => ({
    busy: false,
    enabled: false,
    setEnabled: mockSetAppLockEnabled,
  }),
}));

jest.mock("../state/connection-runtime-context", () => ({
  useConnectionRuntime: () => ({
    getDiagnosticsText: () =>
      "OpenCode2 Mobile redacted transport diagnostics\ncurrent_status=idle",
    reconnectAttempt: 0,
    status: "idle",
  }),
}));

jest.mock("../use-lifecycle-transport-probe", () => ({
  useLifecycleTransportProbe: () => ({
    phase: "idle",
    reset: mockLifecycleReset,
    result: undefined,
    run: mockLifecycleRun,
    running: false,
  }),
}));

beforeEach(() => {
  mockCreateOpenCodeClient.mockReset();
  mockProbeEventStream.mockReset();
  mockProbePtyTransport.mockReset();
  mockLifecycleReset.mockReset();
  mockLifecycleRun.mockClear();
  mockConnectionsSave.mockClear();
  mockConnectionsSelect.mockClear();
  mockConnectionsRemove.mockClear();
  mockReadCredential.mockClear();
  mockReadCredential.mockResolvedValue(undefined);
  mockProfiles = [];
  mockSelectedProfileId = undefined;
  mockClassifiedError = "UNREACHABLE";
  mockSetAppLockEnabled.mockClear();
});

test("requires approval before sending credentials over HTTP", async () => {
  await render(<ConnectionScreen />);

  await fireEvent.changeText(
    screen.getByPlaceholderText("http://100.64.0.10:4096"),
    "http://100.64.0.10:4096",
  );
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await fireEvent.press(screen.getByRole("button", { name: "TEST CONNECTION" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Approve private-network HTTP before connecting without TLS.",
  );
  expect(mockCreateOpenCodeClient).not.toHaveBeenCalled();
});

test("offers an opt-in device authentication lock", async () => {
  await render(<ConnectionScreen />);

  fireEvent(screen.getByLabelText("Require device authentication"), "valueChange", true);

  expect(mockSetAppLockEnabled).toHaveBeenCalledWith(true);
});

test("rejects a server URL with a path", async () => {
  await render(<ConnectionScreen />);

  await fireEvent.changeText(screen.getByLabelText("Server origin"), "https://server.test/api");
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await fireEvent.press(screen.getByRole("button", { name: "TEST CONNECTION" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enter only the server origin, without a path, query, or fragment.",
  );
  expect(mockCreateOpenCodeClient).not.toHaveBeenCalled();
});

test.each([
  ["UNAUTHORIZED", "The server rejected these credentials."],
  ["TLS", "The server's TLS certificate could not be verified."],
  ["TIMEOUT", "The server did not respond within 10 seconds."],
  ["UNREACHABLE", "The server could not be reached. Check its address, network, and TLS settings."],
])("shows a redacted %s connection failure", async (kind, message) => {
  mockClassifiedError = kind;
  mockCreateOpenCodeClient.mockReturnValue({
    health: { get: jest.fn(async () => Promise.reject(new Error("private transport detail"))) },
    server: { get: jest.fn(async () => ({ urls: [] })) },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  });
  await render(<ConnectionScreen />);

  await fireEvent.changeText(screen.getByLabelText("Server origin"), "https://server.test");
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "TEST CONNECTION" }));
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.queryByText("private transport detail")).not.toBeOnTheScreen();
});

test("accepts a different server version when required REST behavior succeeds", async () => {
  mockCreateOpenCodeClient.mockReturnValue({
    health: { get: jest.fn(async () => ({ healthy: true, pid: 42, version: "other-version" })) },
    server: { get: jest.fn(async () => ({ urls: ["https://server.test"] })) },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  });
  await render(<ConnectionScreen />);

  await fireEvent.changeText(screen.getByLabelText("Server origin"), "https://server.test");
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "TEST CONNECTION" }));
  });

  expect(await screen.findByText("other-version")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "SAVE CONNECTION" })).toBeOnTheScreen();
});

test("runs the event and cancellation probe after REST succeeds", async () => {
  mockCreateOpenCodeClient.mockReturnValue({
    health: { get: jest.fn(async () => ({ healthy: true, pid: 42, version: "test" })) },
    server: { get: jest.fn(async () => ({ urls: ["http://server.test"] })) },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  });
  mockProbeEventStream.mockResolvedValue({
    cancellation: true,
    eventType: "server.connected",
  });
  await render(<ConnectionScreen />);

  await fireEvent.changeText(
    screen.getByPlaceholderText("http://100.64.0.10:4096"),
    "http://100.64.0.10:4096",
  );
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await fireEvent(screen.getByLabelText("Allow private-network HTTP"), "valueChange", true);
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "TEST CONNECTION" }));
  });

  expect(await screen.findByText("SERVER REACHABLE")).toBeOnTheScreen();
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "RUN EVENT + CANCELLATION PROBE" }));
  });

  expect(await screen.findByText("EVENT TRANSPORT PASSED")).toBeOnTheScreen();
  expect(mockProbeEventStream).toHaveBeenCalledTimes(1);
});

test("runs the PTY probe after event transport succeeds", async () => {
  mockCreateOpenCodeClient.mockReturnValue({
    health: { get: jest.fn(async () => ({ healthy: true, pid: 42, version: "test" })) },
    server: { get: jest.fn(async () => ({ urls: ["http://server.test"] })) },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  });
  mockProbeEventStream.mockResolvedValue({
    cancellation: true,
    eventType: "server.connected",
  });
  mockProbePtyTransport.mockResolvedValue({
    cleanup: true,
    output: true,
    ticketExpiresIn: 30,
  });
  await render(<ConnectionScreen />);

  await fireEvent.changeText(
    screen.getByPlaceholderText("http://100.64.0.10:4096"),
    "http://100.64.0.10:4096",
  );
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await fireEvent(screen.getByLabelText("Allow private-network HTTP"), "valueChange", true);
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "TEST CONNECTION" }));
  });
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "RUN EVENT + CANCELLATION PROBE" }));
  });
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "RUN PTY WEBSOCKET PROBE" }));
  });

  expect(await screen.findByText("PTY TRANSPORT PASSED")).toBeOnTheScreen();
  expect(mockProbePtyTransport).toHaveBeenCalledWith(expect.anything(), "http://100.64.0.10:4096");
});

test("starts lifecycle recovery after the transport probes pass", async () => {
  const client = {
    health: { get: jest.fn(async () => ({ healthy: true, pid: 42, version: "test" })) },
    server: { get: jest.fn(async () => ({ urls: ["http://server.test"] })) },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  };
  mockCreateOpenCodeClient.mockReturnValue(client);
  mockProbeEventStream.mockResolvedValue({ cancellation: true, eventType: "server.connected" });
  mockProbePtyTransport.mockResolvedValue({ cleanup: true, output: true, ticketExpiresIn: 30 });
  await render(<ConnectionScreen />);

  await fireEvent.changeText(
    screen.getByPlaceholderText("http://100.64.0.10:4096"),
    "http://100.64.0.10:4096",
  );
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await fireEvent(screen.getByLabelText("Allow private-network HTTP"), "valueChange", true);
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "TEST CONNECTION" }));
  });
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "RUN EVENT + CANCELLATION PROBE" }));
  });
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "RUN PTY WEBSOCKET PROBE" }));
  });
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "RUN BACKGROUND + RECONNECT PROBE" }));
  });

  expect(mockLifecycleRun).toHaveBeenCalledWith(client, client);
});

test("stores a tested profile only after explicit save", async () => {
  mockCreateOpenCodeClient.mockReturnValue({
    health: { get: jest.fn(async () => ({ healthy: true, pid: 42, version: "test" })) },
    server: { get: jest.fn(async () => ({ urls: ["https://server.test"] })) },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  });
  await render(<ConnectionScreen />);

  await fireEvent.changeText(screen.getByLabelText("Connection name"), "Tailnet server");
  await fireEvent.changeText(screen.getByLabelText("Server origin"), "https://server.test");
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "TEST CONNECTION" }));
  });

  expect(mockConnectionsSave).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "SAVE CONNECTION" }));
  });
  expect(mockConnectionsSave).toHaveBeenCalledWith(
    expect.objectContaining({
      credential: {
        mode: "basic",
        password: "secret",
        schemaVersion: 1,
        username: "opencode",
      },
      draft: expect.objectContaining({
        baseUrl: "https://server.test",
        name: "Tailnet server",
      }),
    }),
  );
});

test("loads, selects, and removes a saved profile", async () => {
  const profile = {
    allowDevelopmentHttp: false,
    authMode: "bearer",
    baseUrl: "https://saved.test",
    createdAtMs: 1,
    credentialRef: "credential-ref",
    id: "profile-1",
    name: "Saved server",
    schemaVersion: 1,
    updatedAtMs: 1,
  };
  mockProfiles = [profile];
  mockSelectedProfileId = profile.id;
  mockReadCredential.mockResolvedValue({
    mode: "bearer",
    schemaVersion: 1,
    token: "secret-token",
  });

  render(<ConnectionScreen />);
  await act(async () => {
    await Promise.resolve();
  });

  expect(await screen.findByText("Saved server")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Connection name")).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Select Saved server" }));
  });
  expect(mockConnectionsSelect).toHaveBeenCalledWith("profile-1");

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Edit Saved server" }));
  });
  expect(await screen.findByDisplayValue("Saved server")).toBeOnTheScreen();
  expect(screen.getByDisplayValue("https://saved.test")).toBeOnTheScreen();

  fireEvent.press(screen.getByRole("button", { name: "Remove Saved server" }));
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Confirm remove Saved server" }));
  });
  expect(mockConnectionsRemove).toHaveBeenCalledWith("profile-1");
});
