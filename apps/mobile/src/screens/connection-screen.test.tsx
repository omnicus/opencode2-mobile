import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { palette, typography } from "../theme";
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
});

test("requires approval before sending credentials over HTTP", async () => {
  await render(<ConnectionScreen />);
  expect(screen.getByLabelText("Server origin")).toHaveStyle({
    ...typography.body,
    color: palette.ink,
  });

  await fireEvent.changeText(
    screen.getByPlaceholderText("http://100.64.0.10:4096"),
    "http://100.64.0.10:4096",
  );
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await fireEvent.press(screen.getByRole("button", { name: "Test connection" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Approve private-network HTTP before connecting without TLS.",
  );
  expect(mockCreateOpenCodeClient).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveStyle({
    ...typography.subheadline,
    color: palette.danger,
  });
});

test("leaves the device authentication lock to Settings", async () => {
  await render(<ConnectionScreen />);

  expect(screen.queryByLabelText("Require device authentication")).toBeNull();
});

test("rejects a server URL with a path", async () => {
  await render(<ConnectionScreen />);

  await fireEvent.changeText(screen.getByLabelText("Server origin"), "https://server.test/api");
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await fireEvent.press(screen.getByRole("button", { name: "Test connection" }));

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
    server: { status: jest.fn(async () => Promise.reject(new Error("private transport detail"))) },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  });
  await render(<ConnectionScreen />);

  await fireEvent.changeText(screen.getByLabelText("Server origin"), "https://server.test");
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Test connection" }));
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.queryByText("private transport detail")).not.toBeOnTheScreen();
});

test("accepts a different server version when required REST behavior succeeds", async () => {
  mockCreateOpenCodeClient.mockReturnValue({
    server: {
      status: jest.fn(async () => ({
        urls: ["https://server.test"],
        pid: 42,
        version: "other-version",
      })),
    },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  });
  await render(<ConnectionScreen />);

  await fireEvent.changeText(screen.getByLabelText("Server origin"), "https://server.test");
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Test connection" }));
  });

  expect(await screen.findByText("other-version")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Save connection" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Test again" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
});

test("runs the event and cancellation probe after REST succeeds", async () => {
  mockCreateOpenCodeClient.mockReturnValue({
    server: {
      status: jest.fn(async () => ({ urls: ["http://server.test"], pid: 42, version: "test" })),
    },
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
    fireEvent.press(screen.getByRole("button", { name: "Test connection" }));
  });

  expect(await screen.findByText("Server reachable")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Run event and cancellation probe" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Advanced" }));
  expect(screen.getByRole("button", { name: "Advanced" })).toHaveProp("accessibilityState", {
    expanded: true,
  });
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Run event and cancellation probe" }));
  });

  expect(await screen.findByText("Event transport passed")).toBeOnTheScreen();
  expect(mockProbeEventStream).toHaveBeenCalledTimes(1);
});

test("runs the PTY probe after event transport succeeds", async () => {
  mockCreateOpenCodeClient.mockReturnValue({
    server: {
      status: jest.fn(async () => ({ urls: ["http://server.test"], pid: 42, version: "test" })),
    },
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
    fireEvent.press(screen.getByRole("button", { name: "Test connection" }));
  });
  await fireEvent.press(screen.getByRole("button", { name: "Advanced" }));
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Run event and cancellation probe" }));
  });
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Run PTY WebSocket probe" }));
  });

  expect(await screen.findByText("PTY transport passed")).toBeOnTheScreen();
  expect(mockProbePtyTransport).toHaveBeenCalledWith(expect.anything(), "http://100.64.0.10:4096");
});

test("starts lifecycle recovery after the transport probes pass", async () => {
  const client = {
    server: {
      status: jest.fn(async () => ({ urls: ["http://server.test"], pid: 42, version: "test" })),
    },
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
    fireEvent.press(screen.getByRole("button", { name: "Test connection" }));
  });
  await fireEvent.press(screen.getByRole("button", { name: "Advanced" }));
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Run event and cancellation probe" }));
  });
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Run PTY WebSocket probe" }));
  });
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Run background and reconnect probe" }));
  });

  expect(mockLifecycleRun).toHaveBeenCalledWith(client, client);
});

test("stores a tested profile only after explicit save", async () => {
  mockCreateOpenCodeClient.mockReturnValue({
    server: {
      status: jest.fn(async () => ({ urls: ["https://server.test"], pid: 42, version: "test" })),
    },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  });
  await render(<ConnectionScreen />);

  await fireEvent.changeText(screen.getByLabelText("Connection name"), "Tailnet server");
  await fireEvent.changeText(screen.getByLabelText("Server origin"), "https://server.test");
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Test connection" }));
  });

  expect(mockConnectionsSave).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Save connection" }));
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

  expect(screen.getByText("Server details")).toBeOnTheScreen();

  fireEvent.press(screen.getByRole("button", { name: "Remove Saved server" }));
  expect(screen.getByText("Confirm remove")).toBeOnTheScreen();
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Confirm remove Saved server" }));
  });
  expect(mockConnectionsRemove).toHaveBeenCalledWith("profile-1");
});

test("offers done, add, and QR pairing from the header and saved servers", async () => {
  const done = jest.fn();
  const pair = jest.fn();
  await render(<ConnectionScreen onDone={done} onPair={pair} />);

  expect(
    screen.getByText("Switch servers or add a direct OpenCode V2 connection."),
  ).toBeOnTheScreen();
  expect(screen.getByText("New server")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Pair with QR code" }));
  expect(pair).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(done).toHaveBeenCalledTimes(1);
});
