import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";

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

// Feather loads its font after render, which warns outside act in synchronous tests.
jest.mock("@expo/vector-icons/Feather", () => () => null);
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("react-native-keyboard-controller", () =>
  require("react-native-keyboard-controller/jest"),
);
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

function reachableClient() {
  return {
    server: {
      status: jest.fn(async () => ({ urls: ["https://server.test"], pid: 42, version: "test" })),
    },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  };
}

async function openForm() {
  await fireEvent.press(screen.getByRole("button", { name: "Enter address manually" }));
}

async function fillBasic(address: string) {
  await fireEvent.changeText(screen.getByLabelText("Server address"), address);
  await fireEvent.changeText(screen.getByLabelText("Username"), "opencode");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
}

async function pressConnect() {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Connect" }));
  });
}

test("opens first run on pairing and hides the empty server list", async () => {
  const pair = jest.fn();
  await render(<ConnectionScreen onPair={pair} />);

  expect(screen.getByRole("header", { name: "Connect to OpenCode" })).toBeOnTheScreen();
  expect(screen.getByText("You can add more servers later in Settings.")).toBeOnTheScreen();
  expect(screen.queryByText("Saved servers")).toBeNull();
  expect(screen.queryByLabelText("Server address")).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "Scan pairing code" }));
  expect(pair).toHaveBeenCalledTimes(1);

  await openForm();
  expect(screen.getByLabelText("Server address")).toHaveStyle({
    ...typography.body,
    color: palette.ink,
  });
  expect(screen.queryByText("Saved servers")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Hide connection details" }));
  expect(screen.getByRole("header", { name: "Connect to OpenCode" })).toBeOnTheScreen();
});

test("requires the HTTP switch, shown under the address, before sending credentials", async () => {
  await render(<ConnectionScreen />);
  await openForm();

  expect(screen.queryByLabelText("Allow HTTP")).toBeNull();
  await fillBasic("http://100.64.0.10:4096");
  expect(screen.getByLabelText("Allow HTTP")).toBeOnTheScreen();
  await pressConnect();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This address uses HTTP. Turn on Allow HTTP below or use https://.",
  );
  expect(mockCreateOpenCodeClient).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveStyle({
    ...typography.subheadline,
    color: palette.danger,
  });
});

test.each([
  ["192.168.1.20:4096", "http://192.168.1.20:4096", true],
  ["opencode.example.com", "https://opencode.example.com", false],
])("adds a scheme to %s", async (address, baseUrl, http) => {
  mockCreateOpenCodeClient.mockReturnValue(reachableClient());
  await render(<ConnectionScreen />);
  await openForm();

  await fillBasic(address);
  expect(screen.queryByLabelText("Allow HTTP") !== null).toBe(http);
  if (http) await fireEvent(screen.getByLabelText("Allow HTTP"), "valueChange", true);
  await pressConnect();

  expect(mockCreateOpenCodeClient).toHaveBeenCalledWith(expect.objectContaining({ baseUrl }));
  expect(mockConnectionsSave).toHaveBeenCalledWith(
    expect.objectContaining({
      draft: expect.objectContaining({ allowDevelopmentHttp: http, baseUrl }),
    }),
  );
});

test("leaves the device authentication lock to Settings", async () => {
  await render(<ConnectionScreen />);

  expect(screen.queryByLabelText("Require device authentication")).toBeNull();
});

test("rejects a server URL with a path", async () => {
  await render(<ConnectionScreen />);
  await openForm();

  await fillBasic("https://server.test/api");
  await pressConnect();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enter only the server address and port, with nothing after them.",
  );
  expect(mockCreateOpenCodeClient).not.toHaveBeenCalled();
});

test.each([
  ["UNAUTHORIZED", "The server rejected these credentials."],
  ["TLS", "The server's TLS certificate could not be verified."],
  ["TIMEOUT", "The server did not respond within 10 seconds."],
  ["UNREACHABLE", "The server could not be reached. Check its address, network, and TLS settings."],
])("shows a redacted %s connection failure without saving", async (kind, message) => {
  mockClassifiedError = kind;
  mockCreateOpenCodeClient.mockReturnValue({
    server: { status: jest.fn(async () => Promise.reject(new Error("private transport detail"))) },
    session: { list: jest.fn(async () => ({ cursor: {}, data: [] })) },
  });
  await render(<ConnectionScreen />);
  await openForm();

  await fillBasic("https://server.test");
  await pressConnect();

  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.queryByText("private transport detail")).not.toBeOnTheScreen();
  expect(mockConnectionsSave).not.toHaveBeenCalled();
});

test("clears a previous result as soon as a field changes", async () => {
  await render(<ConnectionScreen />);
  await openForm();
  await fillBasic("https://server.test/api");
  await pressConnect();
  expect(screen.getByRole("alert")).toBeOnTheScreen();

  await fireEvent.changeText(screen.getByLabelText("Server address"), "https://server.test");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("connects by testing and then saving, naming the server after its host", async () => {
  const done = jest.fn();
  mockCreateOpenCodeClient.mockReturnValue(reachableClient());
  await render(<ConnectionScreen onDone={done} />);
  await openForm();

  await fillBasic("https://server.test");
  expect(screen.getByLabelText("Connection name")).toHaveProp("placeholder", "server.test");
  await pressConnect();

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
        name: "server.test",
      }),
      health: expect.objectContaining({ pid: 42, version: "test" }),
    }),
  );
  expect(done).toHaveBeenCalledTimes(1);
});

test("keeps a typed name and connects from the keyboard's last field", async () => {
  mockCreateOpenCodeClient.mockReturnValue(reachableClient());
  await render(<ConnectionScreen />);
  await openForm();

  await fireEvent.changeText(screen.getByLabelText("Connection name"), "Tailnet server");
  await fillBasic("https://server.test");
  expect(screen.getByLabelText("Server address")).toHaveProp("returnKeyType", "next");
  expect(screen.getByLabelText("Password")).toHaveProp("returnKeyType", "go");
  await act(async () => {
    fireEvent(screen.getByLabelText("Password"), "submitEditing");
  });

  expect(mockConnectionsSave).toHaveBeenCalledWith(
    expect.objectContaining({
      draft: expect.objectContaining({ name: "Tailnet server" }),
    }),
  );
});

test("keeps the password and token apart when switching authentication", async () => {
  await render(<ConnectionScreen />);
  await openForm();

  await fireEvent.changeText(screen.getByLabelText("Password"), "basic-secret");
  await fireEvent.press(screen.getByRole("radio", { name: "Bearer" }));
  expect(screen.getByLabelText("Token")).toHaveProp("value", "");
  expect(screen.getByLabelText("Token")).toHaveProp("autoComplete", "off");
  await fireEvent.changeText(screen.getByLabelText("Token"), "bearer-token");
  await fireEvent.press(screen.getByRole("radio", { name: "Basic" }));
  expect(screen.getByLabelText("Password")).toHaveProp("value", "basic-secret");
  await fireEvent.press(screen.getByRole("radio", { name: "Bearer" }));
  expect(screen.getByLabelText("Token")).toHaveProp("value", "bearer-token");
});

test("shows and hides the secret", async () => {
  await render(<ConnectionScreen />);
  await openForm();

  expect(screen.getByLabelText("Password")).toHaveProp("secureTextEntry", true);
  await fireEvent.press(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByLabelText("Password")).toHaveProp("secureTextEntry", false);
  await fireEvent.press(screen.getByRole("button", { name: "Hide password" }));
  expect(screen.getByLabelText("Password")).toHaveProp("secureTextEntry", true);
});

test("tests without saving and runs the probes from Advanced", async () => {
  const client = reachableClient();
  mockCreateOpenCodeClient.mockReturnValue(client);
  mockProbeEventStream.mockResolvedValue({ cancellation: true, eventType: "server.connected" });
  mockProbePtyTransport.mockResolvedValue({ cleanup: true, output: true, ticketExpiresIn: 30 });
  await render(<ConnectionScreen />);
  await openForm();

  await fillBasic("http://100.64.0.10:4096");
  await fireEvent(screen.getByLabelText("Allow HTTP"), "valueChange", true);
  expect(screen.queryByText(/Client contract/)).toBeNull();
  expect(screen.queryByText(/Android Emulator/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Advanced" }));
  expect(screen.getByRole("button", { name: "Advanced" })).toBeExpanded();
  expect(screen.getByText(/Client contract test/)).toBeOnTheScreen();
  expect(screen.getByText(/Android Emulator/)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Run event and cancellation probe" })).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Test without saving" }));
  });
  expect(await screen.findByText("Server reachable")).toBeOnTheScreen();
  expect(screen.getByText("PID")).toBeOnTheScreen();
  expect(mockConnectionsSave).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Run event and cancellation probe" }));
  });
  expect(await screen.findByText("Event transport passed")).toBeOnTheScreen();
  expect(mockProbeEventStream).toHaveBeenCalledTimes(1);

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Run PTY WebSocket probe" }));
  });
  expect(await screen.findByText("PTY transport passed")).toBeOnTheScreen();
  expect(mockProbePtyTransport).toHaveBeenCalledWith(expect.anything(), "http://100.64.0.10:4096");

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Run background and reconnect probe" }));
  });
  expect(mockLifecycleRun).toHaveBeenCalledWith(client, client);

  await fireEvent.changeText(screen.getByLabelText("Username"), "someone-else");
  expect(screen.queryByText("Server reachable")).toBeNull();
  expect(screen.queryByText("Event transport passed")).toBeNull();
});

test("loads, selects, and removes a saved profile after confirming its host", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const profile = {
    allowDevelopmentHttp: false,
    authMode: "bearer",
    baseUrl: "https://saved.test:4096",
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
  expect(screen.getByDisplayValue("https://saved.test:4096")).toBeOnTheScreen();
  expect(screen.getByLabelText("Token")).toHaveProp("value", "secret-token");
  expect(screen.getByText("Server details")).toBeOnTheScreen();

  fireEvent.press(screen.getByRole("button", { name: "Remove Saved server" }));
  expect(mockConnectionsRemove).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    "Remove Saved server?",
    "This removes saved.test:4096 and its saved credentials from this device.",
    expect.any(Array),
  );
  const buttons = alert.mock.calls[0]?.[2] ?? [];
  const remove = buttons.find((button) => button.text === "Remove");
  expect(remove?.style).toBe("destructive");
  await act(async () => {
    remove?.onPress?.();
  });
  expect(mockConnectionsRemove).toHaveBeenCalledWith("profile-1");
  alert.mockRestore();
});

test("offers done, add, and pairing from the header and saved servers", async () => {
  mockProfiles = [
    {
      allowDevelopmentHttp: true,
      authMode: "none",
      baseUrl: "http://saved.test",
      id: "profile-1",
      name: "Saved server",
    },
  ];
  const done = jest.fn();
  const pair = jest.fn();
  await render(<ConnectionScreen onDone={done} onPair={pair} />);

  expect(screen.getByText("Saved servers")).toBeOnTheScreen();
  expect(screen.getByText("HTTP allowed, not encrypted")).toBeOnTheScreen();
  expect(screen.queryByText("Connect to OpenCode")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Scan pairing code" }));
  expect(pair).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(done).toHaveBeenCalledTimes(1);
});
