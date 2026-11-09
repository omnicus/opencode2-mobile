import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, Dimensions, Platform, Share } from "react-native";

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
let mockReady = true;
let mockIsDevice = false;
let mockRuntime: Record<string, unknown> = {};
let mockLifecycleState: Record<string, unknown> = {};

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
jest.mock("expo-device", () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));

jest.mock("../connections/connections-context", () => ({
  useConnections: () => ({
    profiles: mockProfiles,
    readCredential: mockReadCredential,
    ready: mockReady,
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
    ...mockRuntime,
  }),
}));

jest.mock("../use-lifecycle-transport-probe", () => ({
  useLifecycleTransportProbe: () => ({
    phase: "idle",
    reset: mockLifecycleReset,
    result: undefined,
    run: mockLifecycleRun,
    running: false,
    ...mockLifecycleState,
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
  mockReady = true;
  mockIsDevice = false;
  mockRuntime = {};
  mockLifecycleState = {};
});

const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");
const restorers: (() => void)[] = [];

afterEach(() => {
  for (const restore of restorers.splice(0)) restore();
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

const savedProfile = {
  allowDevelopmentHttp: true,
  authMode: "basic",
  baseUrl: "http://saved.test",
  createdAtMs: 1,
  id: "profile-1",
  name: "Saved server",
  schemaVersion: 1,
  updatedAtMs: 1,
};

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
  await fireEvent.press(screen.getByRole("button", { name: "Close editor" }));
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

async function openSavedProfile() {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Edit Saved server" }));
  });
}

async function pressButton(name: string) {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name }));
  });
}

async function openAdvanced() {
  await fireEvent.press(screen.getByRole("button", { name: "Advanced" }));
}

async function runProbesThroughPty(address = "https://server.test") {
  mockProbeEventStream.mockResolvedValue({ cancellation: true, eventType: "server.connected" });
  mockProbePtyTransport.mockResolvedValue({ cleanup: true, output: true, ticketExpiresIn: 30 });
  await fillBasic(address);
  if (address.startsWith("http:")) {
    await fireEvent(screen.getByLabelText("Allow HTTP"), "valueChange", true);
  }
  await openAdvanced();
  await pressButton("Test without saving");
  await pressButton("Run event and cancellation probe");
  await pressButton("Run PTY WebSocket probe");
}

test("shows the runtime status card and redacted diagnostics under Advanced", async () => {
  mockRuntime = {
    cacheMetadata: { activeSessionCount: 1, projectCount: 3 },
    reconnectAttempt: 2,
    serverVersion: "other",
    status: "connected",
  };
  const share = jest.spyOn(Share, "share").mockRejectedValue(new Error("share failed"));
  restorers.push(() => share.mockRestore());
  await render(<ConnectionScreen />);
  await openForm();
  await openAdvanced();

  expect(screen.getByText("Connected")).toBeOnTheScreen();
  expect(screen.getByText("Reconnect attempt 2")).toBeOnTheScreen();
  expect(screen.getByText("Cached list: 3 projects, 1 active")).toBeOnTheScreen();
  expect(
    screen.getByText("Server other passed checks against client contract test."),
  ).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Show diagnostics" }));
  expect(screen.getByText(/current_status=idle/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Hide diagnostics" }));
  expect(screen.queryByText(/current_status=idle/)).toBeNull();

  await pressButton("Share redacted report");
  expect(share).toHaveBeenCalledWith({ message: expect.stringContaining("current_status=idle") });
  expect(await screen.findByRole("alert")).toHaveTextContent("Diagnostics could not be shared.");

  await openAdvanced();
  expect(screen.queryByText("Connected")).toBeNull();
});

test("omits optional runtime details that do not apply", async () => {
  mockRuntime = { serverVersion: "test", status: "reconnecting" };
  await render(<ConnectionScreen />);
  await openForm();
  await openAdvanced();

  expect(screen.getByText("Reconnecting")).toBeOnTheScreen();
  expect(screen.queryByText(/Reconnect attempt/)).toBeNull();
  expect(screen.queryByText(/Cached list/)).toBeNull();
  expect(screen.queryByText(/passed checks against client contract/)).toBeNull();
});

test("guides the user through a running lifecycle probe and shows its result", async () => {
  mockLifecycleState = {
    phase: "ready-to-background",
    result: {
      backgroundCancellation: true,
      foregroundHealth: true,
      initialEventType: "server.connected",
      reconnectEventType: "server.heartbeat",
    },
    running: true,
  };
  await render(<ConnectionScreen />);
  await openForm();
  await openAdvanced();

  expect(screen.getByText("Lifecycle action required")).toBeOnTheScreen();
  expect(
    screen.getByText("Send the app to the background, wait a moment, then return to it."),
  ).toBeOnTheScreen();
  expect(screen.getByText("Lifecycle recovery passed")).toBeOnTheScreen();
  expect(screen.getByText("server.heartbeat")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Test without saving" })).toBeDisabled();
});

test("shows busy labels while each probe is pending and ignores a second connect", async () => {
  const client = reachableClient();
  mockCreateOpenCodeClient.mockReturnValue(client);
  await render(<ConnectionScreen />);
  await openForm();
  await fillBasic("https://server.test");
  await openAdvanced();

  let finishRest: () => void = () => undefined;
  client.server.status.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRest = () => resolve({ urls: [], pid: 42, version: "test" });
      }),
  );
  await pressButton("Test without saving");
  expect(screen.getByRole("button", { name: "Testing…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Connecting…" })).toBeOnTheScreen();
  await act(async () => {
    fireEvent(screen.getByLabelText("Password"), "submitEditing");
  });
  expect(mockCreateOpenCodeClient).toHaveBeenCalledTimes(1);
  await act(async () => finishRest());
  expect(screen.getByText("Server reachable")).toBeOnTheScreen();

  let finishStream: () => void = () => undefined;
  mockProbeEventStream.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishStream = () => resolve({ cancellation: true, eventType: "server.connected" });
      }),
  );
  await pressButton("Run event and cancellation probe");
  expect(screen.getByRole("button", { name: "Probing event stream…" })).toBeOnTheScreen();
  await act(async () => finishStream());

  let finishPty: () => void = () => undefined;
  mockProbePtyTransport.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPty = () => resolve({ cleanup: true, output: true, ticketExpiresIn: 30 });
      }),
  );
  await pressButton("Run PTY WebSocket probe");
  expect(screen.getByRole("button", { name: "Probing PTY transport…" })).toBeOnTheScreen();
  await act(async () => finishPty());
  expect(screen.getByText("PTY transport passed")).toBeOnTheScreen();
  expect(screen.getByText(/Minted a 30s ticket/)).toBeOnTheScreen();

  let finishSave: (id: string) => void = () => undefined;
  mockConnectionsSave.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  );
  await pressButton("Connect");
  expect(screen.getByRole("button", { name: "Saving…" })).toBeOnTheScreen();
  await act(async () => finishSave("profile-1"));
  expect(screen.getByText("Connected and saved.")).toBeOnTheScreen();
});

test("explains failed transport probes", async () => {
  mockCreateOpenCodeClient.mockReturnValue(reachableClient());
  await render(<ConnectionScreen />);
  await openForm();
  await runProbesThroughPty();

  mockProbeEventStream.mockRejectedValueOnce(new Error("private stream detail"));
  await pressButton("Run event and cancellation probe");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The server could not be reached. Check its address, network, and TLS settings.",
  );
  expect(screen.queryByText("Event transport passed")).toBeNull();

  await pressButton("Run event and cancellation probe");
  mockProbePtyTransport.mockRejectedValueOnce({ _tag: "ForbiddenError" });
  await pressButton("Run PTY WebSocket probe");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The server rejected the PTY connect-ticket request.",
  );

  await pressButton("Run PTY WebSocket probe");
  mockLifecycleReset.mockClear();
  mockLifecycleRun.mockRejectedValueOnce(new Error("private lifecycle detail"));
  await pressButton("Run background and reconnect probe");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The server could not be reached. Check its address, network, and TLS settings.",
  );
  expect(mockLifecycleReset).toHaveBeenCalledTimes(1);
});

test("stops transport probes when the target is no longer allowed", async () => {
  mockCreateOpenCodeClient.mockReturnValue(reachableClient());
  await render(<ConnectionScreen />);
  await openForm();
  await runProbesThroughPty("http://localhost:4096");
  mockCreateOpenCodeClient.mockClear();
  mockIsDevice = true;
  const localhost =
    "localhost points to this phone. Use your computer's network address, Tailscale address, or hostname.";

  await pressButton("Run background and reconnect probe");
  expect(screen.getByRole("alert")).toHaveTextContent(localhost);
  await pressButton("Run PTY WebSocket probe");
  expect(screen.getByRole("alert")).toHaveTextContent(localhost);
  await pressButton("Run event and cancellation probe");
  expect(screen.getByRole("alert")).toHaveTextContent(localhost);
  await pressButton("Test without saving");
  expect(screen.getByRole("alert")).toHaveTextContent(localhost);
  expect(mockCreateOpenCodeClient).not.toHaveBeenCalled();
  expect(mockLifecycleRun).not.toHaveBeenCalled();
});

test("explains a failed save and finishes after a successful one", async () => {
  const done = jest.fn();
  mockCreateOpenCodeClient.mockReturnValue(reachableClient());
  mockConnectionsSave.mockRejectedValueOnce(new Error("CREDENTIAL_TOO_LARGE"));
  await render(<ConnectionScreen onDone={done} />);
  await openForm();
  await fillBasic("https://server.test");

  await pressConnect();
  expect(screen.getByRole("alert")).toHaveTextContent("The credential is too large to store.");
  expect(done).not.toHaveBeenCalled();

  await pressConnect();
  expect(screen.getByText("Connected and saved.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeOnTheScreen();
  expect(done).toHaveBeenCalledTimes(1);
});

test("saves changes to an existing profile under its id", async () => {
  mockProfiles = [savedProfile];
  mockReadCredential.mockResolvedValue({
    mode: "basic",
    password: "secret",
    schemaVersion: 1,
    username: "opencode",
  });
  mockCreateOpenCodeClient.mockReturnValue(reachableClient());
  await render(<ConnectionScreen />);
  await openSavedProfile();

  expect(screen.getByDisplayValue("opencode")).toBeOnTheScreen();
  expect(screen.getByLabelText("Allow HTTP")).toHaveProp("value", true);
  await pressButton("Save changes");

  expect(mockConnectionsSave).toHaveBeenCalledWith(
    expect.objectContaining({
      draft: expect.objectContaining({
        allowDevelopmentHttp: true,
        authMode: "basic",
        id: "profile-1",
        name: "Saved server",
      }),
    }),
  );
});

test("explains saved profiles that cannot be read, opened, selected, or removed", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  restorers.push(() => alert.mockRestore());
  mockProfiles = [savedProfile];
  mockSelectedProfileId = savedProfile.id;
  mockReadCredential.mockRejectedValueOnce(new Error("keychain"));
  render(<ConnectionScreen />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Stored credentials could not be read. Enter them again.",
  );

  mockConnectionsSelect.mockRejectedValueOnce(new Error("select"));
  await pressButton("Select Saved server");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This saved connection could not be selected.",
  );

  mockReadCredential.mockRejectedValueOnce(new Error("keychain"));
  await openSavedProfile();
  expect(screen.getByRole("alert")).toHaveTextContent("This saved connection could not be opened.");

  await openSavedProfile();
  fireEvent.press(screen.getByRole("button", { name: "Remove Saved server" }));
  const buttons = alert.mock.calls[0]?.[2] ?? [];
  expect(buttons.find((button) => button.text === "Cancel")?.style).toBe("cancel");
  mockConnectionsRemove.mockRejectedValueOnce(new Error("remove"));
  await act(async () => {
    buttons.find((button) => button.text === "Remove")?.onPress?.();
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The connection could not be removed. Try again.",
  );
  expect(screen.getByText("Server details")).toBeOnTheScreen();
});

test("ignores a profile load that a newer action replaced", async () => {
  mockProfiles = [savedProfile];
  let finishRead: (value: unknown) => void = () => undefined;
  mockReadCredential.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  await render(<ConnectionScreen />);
  await openSavedProfile();
  await fireEvent.press(screen.getByRole("button", { name: "Add server" }));
  await act(async () => finishRead(undefined));

  expect(screen.getByText("New server")).toBeOnTheScreen();
  expect(screen.queryByDisplayValue("Saved server")).toBeNull();

  let failRead: (error: Error) => void = () => undefined;
  mockReadCredential.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failRead = reject;
      }),
  );
  await openSavedProfile();
  await fireEvent.press(screen.getByRole("button", { name: "Add server" }));
  await act(async () => failRead(new Error("keychain")));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("ignores a selected profile's credentials after the screen unmounts", async () => {
  mockProfiles = [savedProfile];
  mockSelectedProfileId = savedProfile.id;
  let finishRead: (value: unknown) => void = () => undefined;
  let failRead: (error: Error) => void = () => undefined;
  mockReadCredential.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  const first = render(<ConnectionScreen />);
  first.unmount();
  await act(async () => finishRead(undefined));

  mockReadCredential.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failRead = reject;
      }),
  );
  const second = render(<ConnectionScreen />);
  second.unmount();
  await act(async () => failRead(new Error("keychain")));
  expect(mockReadCredential).toHaveBeenCalledTimes(2);
});

test("starts a new connection after removing the open profile", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  restorers.push(() => alert.mockRestore());
  mockProfiles = [savedProfile];
  await render(<ConnectionScreen />);
  await openSavedProfile();
  await fireEvent.press(screen.getByRole("button", { name: "Show password" }));
  fireEvent.press(screen.getByRole("button", { name: "Remove Saved server" }));
  await act(async () => {
    alert.mock.calls[0]?.[2]?.find((button) => button.text === "Remove")?.onPress?.();
  });

  expect(screen.getByText("New server")).toBeOnTheScreen();
  expect(screen.getByLabelText("Server address")).toHaveProp("value", "");
  expect(screen.getByLabelText("Password")).toHaveProp("secureTextEntry", true);
  expect(screen.queryByLabelText("Allow HTTP")).toBeNull();
  expect(
    screen.getByText("Connection and credentials removed from this device."),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Close editor" }));
  expect(screen.queryByText("New server")).toBeNull();
  expect(
    screen.getByText("Connection and credentials removed from this device."),
  ).toBeOnTheScreen();
});

test("finishes after selecting a saved profile", async () => {
  const done = jest.fn();
  mockProfiles = [{ ...savedProfile, allowDevelopmentHttp: false }];
  await render(<ConnectionScreen onDone={done} />);

  await pressButton("Select Saved server");

  expect(screen.getByText("Saved server selected.")).toBeOnTheScreen();
  expect(screen.queryByText("HTTP allowed, not encrypted")).toBeNull();
  expect(done).toHaveBeenCalledTimes(1);
});

test("moves through the form from the keyboard for each authentication mode", async () => {
  mockCreateOpenCodeClient.mockReturnValue(reachableClient());
  await render(<ConnectionScreen />);
  await openForm();

  await fireEvent(screen.getByLabelText("Server address"), "submitEditing");
  await fireEvent(screen.getByLabelText("Connection name"), "submitEditing");
  await fireEvent(screen.getByLabelText("Username"), "submitEditing");
  expect(screen.getByLabelText("Password")).toHaveProp("textContentType", "password");

  await fireEvent.press(screen.getByRole("radio", { name: "Bearer" }));
  expect(screen.queryByLabelText("Username")).toBeNull();
  expect(screen.getByLabelText("Token")).toHaveProp("textContentType", "none");
  expect(screen.getByRole("button", { name: "Show token" })).toBeOnTheScreen();
  await fireEvent(screen.getByLabelText("Connection name"), "submitEditing");

  await fireEvent.press(screen.getByRole("radio", { name: "None" }));
  expect(screen.queryByLabelText("Token")).toBeNull();
  expect(screen.getByLabelText("Connection name")).toHaveProp("returnKeyType", "go");
  expect(screen.getByLabelText("Connection name")).toHaveProp("submitBehavior", "blurAndSubmit");
  expect(mockCreateOpenCodeClient).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("Server address"), "https://server.test");
  await act(async () => {
    fireEvent(screen.getByLabelText("Connection name"), "submitEditing");
  });
  expect(mockConnectionsSave).toHaveBeenCalledWith(
    expect.not.objectContaining({ credential: expect.anything() }),
  );
  expect(mockConnectionsSave).toHaveBeenCalledWith(
    expect.objectContaining({ draft: expect.objectContaining({ authMode: "none" }) }),
  );
});

test("asks for the missing credential before connecting", async () => {
  await render(<ConnectionScreen />);
  await openForm();
  await fireEvent.changeText(screen.getByLabelText("Server address"), "https://server.test");

  await pressConnect();
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a username and password.");
  await fireEvent.press(screen.getByRole("radio", { name: "Bearer" }));
  await pressConnect();
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a bearer token.");
  expect(mockCreateOpenCodeClient).not.toHaveBeenCalled();
});

test("blocks localhost on a physical device", async () => {
  mockIsDevice = true;
  await render(<ConnectionScreen />);
  await openForm();

  await fillBasic("https://localhost");
  await pressConnect();

  expect(screen.getByRole("alert")).toHaveTextContent(
    "localhost points to this phone. Use your computer's network address, Tailscale address, or hostname.",
  );
  expect(mockCreateOpenCodeClient).not.toHaveBeenCalled();
});

test("shows a loading row until saved connections are ready", async () => {
  mockReady = false;
  await render(<ConnectionScreen />);

  expect(screen.getByText("Saved servers")).toBeOnTheScreen();
  expect(screen.queryByText("Connect to OpenCode")).toBeNull();
  expect(screen.getByRole("header", { name: "Connections" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Scan pairing code" })).toBeNull();
});

test("offers only manual entry on first run without pairing", async () => {
  await render(<ConnectionScreen />);

  expect(screen.queryByRole("button", { name: "Scan pairing code" })).toBeNull();
  expect(screen.queryByRole("header", { name: "Connections" })).toBeNull();
  await openForm();
  expect(screen.getByRole("header", { name: "Connections" })).toBeOnTheScreen();
  expect(screen.getByText("New server")).toBeOnTheScreen();
});

test("uses Android ripples and a leading title", async () => {
  const os = jest.replaceProperty(Platform, "OS", "android");
  restorers.push(() => os.restore());
  mockProfiles = [savedProfile];
  mockSelectedProfileId = savedProfile.id;
  render(<ConnectionScreen onDone={() => undefined} />);
  await act(async () => {
    await Promise.resolve();
  });

  expect(screen.getByRole("header", { name: "Connections" })).toHaveStyle({ flex: 1 });
  expect(screen.getByRole("button", { name: "Done" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Select Saved server" })).toBeSelected();
  await openSavedProfile();
  expect(screen.getByRole("button", { name: "Show password" })).toBeOnTheScreen();
});

test("stacks saved server rows and the HTTP switch for large text", async () => {
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 2 } });
  mockProfiles = [savedProfile];
  await render(<ConnectionScreen />);

  expect(screen.getByText("Saved server")).not.toHaveProp("numberOfLines");
  await openSavedProfile();
  expect(screen.getByText("Server details")).toBeOnTheScreen();
  expect(screen.getByLabelText("Allow HTTP")).toBeOnTheScreen();
});
