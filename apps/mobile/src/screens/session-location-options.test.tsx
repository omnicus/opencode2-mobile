import { beforeEach, expect, jest, test } from "@jest/globals";
import type { McpServer } from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { switchColors } from "../theme";
import { SessionLocationOptions } from "./session-location-options";

const mockList = jest.fn<(...args: unknown[]) => Promise<{ data: McpServer[] }>>();
const mockConnect = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockDisconnect = jest.fn<(...args: unknown[]) => Promise<void>>();
let mockRuntime = { connectionId: "connection-1", restClient: {}, status: "connected" };
jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  listOpenCodeMcpServers: (...args: unknown[]) => mockList(...args),
  connectOpenCodeMcpServer: (...args: unknown[]) => mockConnect(...args),
  disconnectOpenCodeMcpServer: (...args: unknown[]) => mockDisconnect(...args),
  classifyOpenCodeError: (error: unknown) =>
    error instanceof Error && error.message === "unsupported" ? "INCOMPATIBLE" : "UNKNOWN",
}));
jest.mock("../state/connection-runtime-context", () => ({
  useConnectionRuntime: () => mockRuntime,
}));
jest.mock("./app-shell", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ActionButton: ({
      label,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      label: string;
      onPress: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={onPress}
      >
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => undefined) }));

beforeEach(() => {
  mockRuntime = { connectionId: "connection-1", restClient: {}, status: "connected" };
  mockList.mockReset().mockResolvedValue({ data: [] });
  mockConnect.mockReset().mockResolvedValue(undefined);
  mockDisconnect.mockReset().mockResolvedValue(undefined);
});
const location = { directory: "/workspace/child" };
function element(queryClient: QueryClient, ready = true) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionLocationOptions
        connectionId="connection-1"
        location={location}
        ready={ready}
        branch="feature/mobile"
      />
    </QueryClientProvider>
  );
}
function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  const view = render(element(client));
  fireEvent.press(screen.getByRole("button", { name: "Location options" }));
  return { client, view };
}

test("loads on open, states the location-wide scope, and copies the branch", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } },
  });
  render(element(client));
  expect(mockList).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Location options" }));
  expect(await screen.findByText("No MCP servers configured for this location.")).toBeOnTheScreen();
  expect(screen.getByText(/MCP changes affect all sessions/)).toBeOnTheScreen();
  expect(mockList).toHaveBeenCalledWith(
    {},
    location,
    expect.objectContaining({ signal: expect.anything() }),
  );
  fireEvent.press(screen.getByRole("button", { name: "Copy branch name" }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith("feature/mobile"));
});

test("keeps the on-track distinct from the thumb using shared native switch colors", async () => {
  mockList.mockResolvedValue({ data: [{ name: "docs", status: { status: "connected" } }] });
  setup();
  const toggle = await screen.findByRole("switch", { name: "MCP server docs for this location" });
  expect(toggle.props.onTintColor).toBe(switchColors.trackColor.true);
  expect(toggle.props.tintColor).toBe(switchColors.trackColor.false);
  expect(toggle.props.thumbTintColor).toBe(switchColors.thumbColor);
  expect(toggle).toHaveStyle({ backgroundColor: switchColors.ios_backgroundColor });
  expect(toggle.props.onTintColor).not.toBe(toggle.props.thumbTintColor);
});

test("connects and disconnects using refreshed server state and exact cache keys", async () => {
  mockList.mockResolvedValue({ data: [{ name: "docs", status: { status: "disabled" } }] });
  mockConnect.mockImplementation(async () => {
    mockList.mockResolvedValue({ data: [{ name: "docs", status: { status: "connected" } }] });
  });
  mockDisconnect.mockImplementation(async () => {
    mockList.mockResolvedValue({ data: [{ name: "docs", status: { status: "disabled" } }] });
  });
  const { client } = setup();
  client.setQueryData(openCodeQueryKeys.mcpServers("connection-2", location), { data: ["other"] });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const toggle = await screen.findByRole("switch", { name: "MCP server docs for this location" });
  expect(toggle).not.toBeChecked();
  fireEvent(toggle, "valueChange", true);
  await waitFor(() => {
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
  });
  fireEvent(toggle, "valueChange", false);
  await waitFor(() => {
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
  });
  expect(mockConnect).toHaveBeenCalledWith(
    {},
    location,
    "docs",
    expect.objectContaining({ signal: expect.anything() }),
  );
  expect(mockDisconnect).toHaveBeenCalledWith(
    {},
    location,
    "docs",
    expect.objectContaining({ signal: expect.anything() }),
  );
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: openCodeQueryKeys.mcpServers("connection-1", location),
  });
  expect(
    client.getQueryState(openCodeQueryKeys.mcpServers("connection-2", location))?.isInvalidated,
  ).toBe(false);
});

test("uses explicit pending/authentication/failure states without raw server errors", async () => {
  mockList.mockResolvedValue({
    data: [
      { name: "pending", status: { status: "pending" } },
      { name: "auth", status: { status: "needs_auth", error: "secret server error" } },
      { name: "failed", status: { status: "failed", error: "secret server error" } },
    ],
  });
  setup();
  expect(await screen.findByText("Needs authentication")).toBeOnTheScreen();
  expect(
    screen.getByRole("switch", { name: "MCP server pending for this location" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("switch", { name: "MCP server pending for this location" }),
  ).toBeChecked();
  expect(screen.getByRole("switch", { name: "MCP server auth for this location" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "MCP server auth for this location" })).toBeEnabled();
  expect(screen.getByRole("switch", { name: "MCP server failed for this location" })).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Retry connection to MCP server failed" }),
  ).toBeEnabled();
  expect(screen.queryByText("secret server error")).toBeNull();
});

test("disables cached controls after losing or switching connection", async () => {
  mockList.mockResolvedValue({ data: [{ name: "docs", status: { status: "connected" } }] });
  const { client, view } = setup();
  await screen.findByText("Connected");
  mockRuntime.status = "offline";
  view.rerender(element(client));
  expect(screen.getByRole("switch", { name: "MCP server docs for this location" })).toBeDisabled();
  mockRuntime.connectionId = "connection-2";
  view.rerender(element(client));
  expect(screen.queryByText("docs")).toBeNull();
  expect(mockDisconnect).not.toHaveBeenCalled();
});

test("reconciles uncertain mutations and never retries automatically", async () => {
  mockList.mockResolvedValue({ data: [{ name: "docs", status: { status: "disabled" } }] });
  mockConnect.mockRejectedValue(new Error("private failure"));
  setup();
  fireEvent(
    await screen.findByRole("switch", { name: "MCP server docs for this location" }),
    "valueChange",
    true,
  );
  expect(await screen.findByText(/MCP change could not be confirmed/)).toBeOnTheScreen();
  await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThan(1));
  expect(mockConnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("private failure")).toBeNull();
  await waitFor(() => {
    const toggle = screen.getByRole("switch", { name: "MCP server docs for this location" });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
  });
});

test("shows unsupported and retryable list failures", async () => {
  mockList.mockRejectedValue(new Error("unsupported"));
  const { view } = setup();
  expect(await screen.findByText("This server does not expose MCP management.")).toBeOnTheScreen();
  view.unmount();
  mockList.mockRejectedValue(new Error("network"));
  setup();
  expect(await screen.findByRole("button", { name: "Try again" })).toBeOnTheScreen();
  mockList.mockResolvedValue({ data: [] });
  fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No MCP servers configured for this location.")).toBeOnTheScreen();
});

test("blocks duplicate actions across sheet reopening and aborts when leaving", async () => {
  mockList.mockResolvedValue({ data: [{ name: "docs", status: { status: "disabled" } }] });
  let complete: (() => void) | undefined;
  mockConnect.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const { view } = setup();
  const connect = await screen.findByRole("switch", {
    name: "MCP server docs for this location",
  });
  fireEvent(connect, "valueChange", true);
  fireEvent(connect, "valueChange", true);
  await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByRole("button", { name: "Close Location options" }));
  fireEvent.press(screen.getByRole("button", { name: "Location options" }));
  expect(screen.getByRole("switch", { name: "MCP server docs for this location" })).toBeDisabled();
  expect(screen.getByRole("switch", { name: "MCP server docs for this location" })).toBeChecked();
  const options = mockConnect.mock.calls[0]?.[3] as { signal: AbortSignal };
  view.unmount();
  expect(options.signal.aborted).toBe(true);
  await act(async () => {
    complete?.();
  });
});

test("can switch off a server awaiting authentication", async () => {
  mockList.mockResolvedValue({
    data: [{ name: "auth", status: { status: "needs_auth", error: "private" } }],
  });
  mockDisconnect.mockImplementation(async () => {
    mockList.mockResolvedValue({ data: [{ name: "auth", status: { status: "disabled" } }] });
  });
  setup();
  const toggle = await screen.findByRole("switch", { name: "MCP server auth for this location" });
  fireEvent(toggle, "valueChange", false);
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(mockDisconnect).toHaveBeenCalledWith(
    {},
    location,
    "auth",
    expect.objectContaining({ signal: expect.anything() }),
  );
  expect(mockConnect).not.toHaveBeenCalled();
});

test("does not confuse a failed connection with a switched-off server", async () => {
  mockList.mockResolvedValue({ data: [{ name: "docs", status: { status: "disabled" } }] });
  mockConnect.mockImplementation(async () => {
    mockList.mockResolvedValue({
      data: [{ name: "docs", status: { status: "failed", error: "private" } }],
    });
  });
  setup();
  const toggle = await screen.findByRole("switch", { name: "MCP server docs for this location" });
  fireEvent(toggle, "valueChange", true);
  expect(await screen.findByText("Connection failed")).toBeOnTheScreen();
  expect(toggle).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Retry connection to MCP server docs" }),
  ).toBeOnTheScreen();
});
