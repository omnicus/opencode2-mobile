import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import {
  getOpenCodeShell,
  getOpenCodeShellOutput,
  type OpenCodeClient,
  removeOpenCodeShell,
  type SessionMessageInfo,
  type ShellGetOutput,
} from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render as renderWithoutQueries,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { AccessibilityInfo, Alert, type AlertButton, Modal, Platform } from "react-native";

import { palette } from "../theme";
import { SessionBackgroundTasks } from "./session-background-tasks";
import { SessionShellScope } from "./session-shell-output";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  getOpenCodeShell: jest.fn(),
  getOpenCodeShellOutput: jest.fn(),
  isShellNotFoundError: (error: unknown) =>
    (error as { _tag?: string })?._tag === "ShellNotFoundError",
  maxShellOutputBytes: 65536,
  removeOpenCodeShell: jest.fn(),
}));

const getShell = jest.mocked(getOpenCodeShell);
const getOutput = jest.mocked(getOpenCodeShellOutput);
const removeShell = jest.mocked(removeOpenCodeShell);
const location = { directory: "/workspace" };
const notFound = Object.assign(new Error("Shell not found"), { _tag: "ShellNotFoundError" });
// Shell IDs the fake server has removed; later reads answer not found, as on the server.
let removed = new Set<string>();
let shellStates: Record<string, Partial<ShellGetOutput["data"]>> = {};
let shellOutput: Record<string, string> = {};
// Cleared after each test, so no cache timer outlives it.
const queryClients: QueryClient[] = [];

function testQueryClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);
  return queryClient;
}

afterEach(() => {
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
});

beforeEach(() => {
  removed = new Set();
  shellStates = {};
  shellOutput = {};
  getShell.mockReset().mockImplementation(async (_client, _location, id) => {
    const state = shellStates[id];
    if (!state || removed.has(id)) throw notFound;
    return {
      location,
      data: {
        command: "pnpm dev",
        cwd: "/workspace",
        file: "/output",
        id,
        metadata: {},
        shell: "sh",
        status: "running",
        time: { started: 1_000 },
        ...state,
      },
    };
  });
  getOutput.mockReset().mockImplementation(async (_client, _location, id, options) => {
    if (removed.has(id)) throw notFound;
    const bytes = shellOutput[id] ?? "";
    const cursor = options?.cursor ?? 0;
    return {
      location,
      data: {
        cursor: bytes.length,
        output: bytes.slice(cursor),
        size: bytes.length,
        truncated: false,
      },
    };
  });
  removeShell.mockReset().mockImplementation(async (_client, _location, id) => {
    removed.add(id);
  });
});

// No shell scope, so shell status stays unknown and only subagents are counted.
function render(element: ReactElement) {
  const queryClient = testQueryClient();
  return renderWithoutQueries(element, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function taskMessage(state: "running" | "completed" | "error"): SessionMessageInfo {
  return {
    id: `msg_${state}`,
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 1 },
    content: [
      {
        type: "text",
        text: `<task id="ses_child" state="${state}">\n<summary>Private task content</summary>\n<${state === "error" ? "task_error" : "task_result"}>Result</${state === "error" ? "task_error" : "task_result"}>\n</task>`,
      },
    ],
  };
}

function launch(sessionID: string, description = "Restyle"): SessionMessageInfo {
  return {
    id: `msg_${sessionID}`,
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 1, completed: 1 },
    content: [
      {
        id: `tool_${sessionID}`,
        name: "subagent",
        type: "tool",
        time: { created: 1 },
        state: {
          status: "completed",
          input: { background: true, description, subagent_type: "review" },
          metadata: { sessionID, status: "running" },
          content: [{ type: "text", text: "The subagent is working in the background." }],
        },
      },
    ],
  };
}

test("the chip opens the monitor, whose rows open the child without repeating its content", () => {
  const onOpenChild = jest.fn();
  render(<SessionBackgroundTasks messages={[taskMessage("running")]} onOpenChild={onOpenChild} />);
  expect(screen.queryByText("Private task content")).toBeNull();
  const chip = screen.getByRole("button", { name: "1 subagent, running in this session" });
  expect(chip).toHaveStyle({ minHeight: 36 });
  expect(chip.props.hitSlop).toBe(6);
  fireEvent.press(chip);
  expect(screen.getByRole("header", { name: "Background work" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Subagents" })).toBeOnTheScreen();
  expect(screen.queryByRole("header", { name: "Shells" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Delegated task, Running" }));
  expect(onOpenChild).toHaveBeenCalledWith("ses_child");
});

test.each(["completed", "error"] as const)(
  "a %s result removes the chip and moves the child to Finished",
  (state) => {
    const view = render(
      <SessionBackgroundTasks messages={[taskMessage("running")]} onOpenChild={jest.fn()} />,
    );
    fireEvent.press(screen.getByRole("button", { name: "1 subagent, running in this session" }));
    view.rerender(
      <SessionBackgroundTasks
        messages={[taskMessage(state), taskMessage("running")]}
        onOpenChild={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("subagent-monitor-chip")).toBeNull();
    // An open monitor stays open, so the finish is visible instead of the sheet vanishing.
    expect(screen.getByText("Nothing is running in this session.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Show finished subagents" }));
    expect(
      screen.getByRole("button", {
        name: `Delegated task, ${state === "error" ? "Failed" : "Completed"}`,
      }),
    ).toBeOnTheScreen();
  },
);

test("empty session has no chip", () => {
  render(<SessionBackgroundTasks messages={[]} onOpenChild={jest.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
});

test("launches count while their child sessions are active", () => {
  const messages = [launch("ses_a"), launch("ses_b"), launch("ses_c")];
  const view = render(<SessionBackgroundTasks messages={messages} onOpenChild={jest.fn()} />);
  expect(
    screen.getByRole("button", { name: "3 subagents, running in this session" }),
  ).toBeOnTheScreen();

  view.rerender(
    <SessionBackgroundTasks
      activeSessions={{ ses_a: {}, ses_c: {} }}
      messages={messages}
      onOpenChild={jest.fn()}
      sessionID="ses_parent"
    />,
  );
  expect(
    screen.getByRole("button", { name: "2 subagents, running in this session" }),
  ).toBeOnTheScreen();
});

test("rows name each subagent by its task and agent", () => {
  const onOpenChild = jest.fn();
  render(
    <SessionBackgroundTasks
      messages={[launch("ses_settings", "Review settings screen")]}
      onOpenChild={onOpenChild}
    />,
  );
  fireEvent.press(screen.getByRole("button", { name: "1 subagent, running in this session" }));
  expect(screen.getByText("Review settings screen")).toBeOnTheScreen();
  expect(screen.getByText(/@review · Background ·/)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Review settings screen, @review, Running" }));
  expect(onOpenChild).toHaveBeenCalledWith("ses_settings");
});

test("a child blocked on a request is counted, flagged, and listed first", () => {
  render(
    <SessionBackgroundTasks
      activeSessions={{ ses_busy: {} }}
      attention={new Map([["ses_blocked", "permission" as const]])}
      messages={[launch("ses_busy", "Run tests"), launch("ses_blocked", "Deploy preview")]}
      onOpenChild={jest.fn()}
      onStopChild={jest.fn(async () => undefined)}
      sessionID="ses_parent"
    />,
  );
  const chip = screen.getByRole("button", {
    name: "2 subagents, 1 needs you, running in this session",
  });
  expect(chip).toHaveStyle({ borderColor: palette.warm });
  expect(screen.getByTestId("subagent-monitor-waiting")).toBeOnTheScreen();
  fireEvent.press(chip);
  expect(screen.getByRole("header", { name: "Needs you" })).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Deploy preview, @review, Needs approval" }),
  ).toBeOnTheScreen();
  // The blocked row invites review; only working rows offer Stop.
  expect(screen.getByText(/@review · Background · Needs approval/)).toHaveTextContent(/· Review$/);
  expect(screen.queryByRole("button", { name: "Stop Deploy preview" })).toBeNull();
  expect(screen.getByRole("button", { name: "Stop Run tests" })).toBeOnTheScreen();
});

test("stopping a running child asks first, then calls stop with its session", async () => {
  const onStopChild = jest.fn(async () => undefined);
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons?: AlertButton[]) =>
      buttons?.find((button) => button.text === "Stop subagent")?.onPress?.(),
    );
  try {
    render(
      <SessionBackgroundTasks
        messages={[launch("ses_tests", "Run tests")]}
        onOpenChild={jest.fn()}
        onStopChild={onStopChild}
      />,
    );
    fireEvent.press(screen.getByRole("button", { name: "1 subagent, running in this session" }));
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Stop Run tests" }));
    });
    expect(alert).toHaveBeenCalledWith(
      "Stop Run tests?",
      "The parent session may continue without its result.",
      expect.any(Array),
    );
    expect(onStopChild).toHaveBeenCalledWith("ses_tests");
  } finally {
    alert.mockRestore();
  }
});

test("after a stop is sent the row stays Stopping until the refreshed state moves it", async () => {
  const onStopChild = jest.fn(async () => undefined);
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons?: AlertButton[]) =>
      buttons?.find((button) => button.text === "Stop subagent")?.onPress?.(),
    );
  try {
    render(
      <SessionBackgroundTasks
        messages={[launch("ses_tests", "Run tests")]}
        onOpenChild={jest.fn()}
        onStopChild={onStopChild}
      />,
    );
    fireEvent.press(screen.getByRole("button", { name: "1 subagent, running in this session" }));
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Stop Run tests" }));
    });
    // Still Running in the snapshot, so the row must not offer Stop again.
    expect(screen.getByRole("button", { name: "Stop Run tests" })).toBeDisabled();
    expect(screen.getByText("Stopping")).toBeOnTheScreen();
  } finally {
    alert.mockRestore();
  }
});

test("a stale monitor hides the chip and keeps last-known rows without Stop", () => {
  const messages = [launch("ses_tests", "Run tests")];
  const view = render(
    <SessionBackgroundTasks
      messages={messages}
      onOpenChild={jest.fn()}
      onStopChild={jest.fn(async () => undefined)}
    />,
  );
  fireEvent.press(screen.getByRole("button", { name: "1 subagent, running in this session" }));
  view.rerender(<SessionBackgroundTasks messages={messages} onOpenChild={jest.fn()} stale />);
  expect(screen.queryByTestId("subagent-monitor-chip")).toBeNull();
  expect(screen.getByText("Status unavailable · showing last known")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Run tests, @review, Running" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Stop Run tests" })).toBeNull();
});

test("a failed stop explains itself and offers Stop again", async () => {
  const onStopChild = jest.fn(async () => {
    throw new Error("UNREACHABLE");
  });
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons?: AlertButton[]) =>
      buttons?.find((button) => button.text === "Stop subagent")?.onPress?.(),
    );
  try {
    render(
      <SessionBackgroundTasks
        messages={[launch("ses_tests", "Run tests")]}
        onOpenChild={jest.fn()}
        onStopChild={onStopChild}
      />,
    );
    fireEvent.press(screen.getByRole("button", { name: "1 subagent, running in this session" }));
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Stop Run tests" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The subagent could not be stopped. Try again.",
    );
    expect(screen.getByRole("button", { name: "Stop Run tests" })).toBeEnabled();
  } finally {
    alert.mockRestore();
  }
});

function shellLaunch(
  shellID: string,
  command: string,
  options: { background?: "input" | "metadata" | "moved"; status?: string } = {},
): SessionMessageInfo {
  const background = options.background ?? "input";
  return {
    id: `msg_${shellID}`,
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 1, completed: 2 },
    content: [
      {
        id: `tool_${shellID}`,
        name: "shell",
        type: "tool",
        time: { created: 1, ran: 1 },
        state: {
          status: "completed",
          input: { command, ...(background === "input" ? { background: true } : {}) },
          metadata: {
            shellID,
            status: options.status ?? "running",
            ...(background === "metadata" ? { background: true } : {}),
          },
          content: [{ type: "text", text: "Command started in the background." }],
        },
      },
    ],
  };
}

// The chip appears once shell status loads; let its indicator settle inside act.
async function findChip(name: string) {
  const chip = await screen.findByRole("button", { name });
  await act(async () => undefined);
  return chip;
}

function renderWithShells(element: ReactElement, enabled = true) {
  const queryClient = testQueryClient();
  return renderWithoutQueries(element, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <SessionShellScope.Provider
          value={{ client: {} as OpenCodeClient, connectionId: "connection-1", enabled, location }}
        >
          {children}
        </SessionShellScope.Provider>
      </QueryClientProvider>
    ),
  });
}

test("running background shells join the chip and get their own section", async () => {
  shellStates = { sh_dev: {}, sh_watch: {}, sh_done: { exit: 0, status: "exited" } };
  renderWithShells(
    <SessionBackgroundTasks
      messages={[
        shellLaunch("sh_done", "pnpm build"),
        shellLaunch("sh_watch", "pnpm test --watch", { background: "metadata" }),
        shellLaunch("sh_dev", "pnpm dev", { background: "moved" }),
        taskMessage("running"),
      ]}
      onOpenChild={jest.fn()}
    />,
  );
  const chip = await findChip("1 subagent, 2 shells, running in this session");
  fireEvent.press(chip);
  expect(screen.getByRole("header", { name: "Subagents" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Shells" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "pnpm dev, Running" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "pnpm test --watch, Running" })).toBeOnTheScreen();
  // The server says this one exited, so it is not listed as running.
  expect(screen.queryByText("pnpm build")).toBeNull();
});

test("shell-only work names shells, and nothing running shows no chip", async () => {
  shellStates = { sh_dev: {} };
  const view = renderWithShells(
    <SessionBackgroundTasks
      messages={[shellLaunch("sh_dev", "pnpm dev")]}
      onOpenChild={jest.fn()}
    />,
  );
  expect(await findChip("1 shell, running in this session")).toBeOnTheScreen();
  view.rerender(
    <SessionBackgroundTasks
      messages={[shellLaunch("sh_dev", "pnpm dev", { status: "exited" })]}
      onOpenChild={jest.fn()}
    />,
  );
  expect(screen.queryByTestId("subagent-monitor-chip")).toBeNull();
});

test("a foreground shell that still blocks its turn is not background work", async () => {
  shellStates = { sh_blocking: {} };
  const message = shellLaunch("sh_blocking", "pnpm test", { background: "moved" });
  if (message.type !== "assistant" || message.content[0]?.type !== "tool") throw new Error("shape");
  const tool = message.content[0];
  const running = {
    ...message,
    time: { created: 1 },
    content: [
      {
        ...tool,
        state: { status: "running", input: tool.state.input, metadata: { shellID: "sh_blocking" } },
      },
    ],
  } as SessionMessageInfo;
  renderWithShells(<SessionBackgroundTasks messages={[running]} onOpenChild={jest.fn()} />);
  await act(async () => undefined);
  expect(getShell).not.toHaveBeenCalled();
  expect(screen.queryByTestId("subagent-monitor-chip")).toBeNull();
});

test("a shell row opens its command, elapsed time and output tail, and Back returns", async () => {
  shellStates = { sh_dev: {} };
  shellOutput = { sh_dev: "\u001b[32mready\u001b[0m on :3000\r\n" };
  renderWithShells(
    <SessionBackgroundTasks
      messages={[shellLaunch("sh_dev", "pnpm dev")]}
      onOpenChild={jest.fn()}
    />,
  );
  fireEvent.press(await findChip("1 shell, running in this session"));
  fireEvent.press(screen.getByRole("button", { name: "pnpm dev, Running" }));
  expect(screen.getByRole("header", { name: "Shell" })).toBeOnTheScreen();
  expect(screen.getByText("pnpm dev")).toBeOnTheScreen();
  expect(await screen.findByText("ready on :3000")).toBeOnTheScreen();
  expect(screen.getByText(/^Running/)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Stop pnpm dev" })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Back to background work" }));
  expect(screen.getByRole("header", { name: "Shells" })).toBeOnTheScreen();
});

test("an empty running shell says it has no output yet", async () => {
  shellStates = { sh_dev: {} };
  renderWithShells(
    <SessionBackgroundTasks
      messages={[shellLaunch("sh_dev", "pnpm dev")]}
      onOpenChild={jest.fn()}
    />,
  );
  fireEvent.press(await findChip("1 shell, running in this session"));
  fireEvent.press(screen.getByRole("button", { name: "pnpm dev, Running" }));
  expect(await screen.findByText("No output yet")).toBeOnTheScreen();
});

test("Stop asks first, removes the shell, and then shows that it stopped", async () => {
  shellStates = { sh_dev: {} };
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons?: AlertButton[]) =>
      buttons?.find((button) => button.text === "Stop shell")?.onPress?.(),
    );
  try {
    renderWithShells(
      <SessionBackgroundTasks
        messages={[shellLaunch("sh_dev", "pnpm dev")]}
        onOpenChild={jest.fn()}
      />,
    );
    fireEvent.press(await findChip("1 shell, running in this session"));
    fireEvent.press(screen.getByRole("button", { name: "pnpm dev, Running" }));
    await act(async () => {
      fireEvent.press(await screen.findByRole("button", { name: "Stop pnpm dev" }));
    });
    expect(alert).toHaveBeenCalledWith(
      "Stop pnpm dev?",
      "This ends the command on the server.",
      expect.any(Array),
    );
    expect(removeShell).toHaveBeenCalledWith(expect.anything(), location, "sh_dev");
    // The page stays open after the shell leaves the running list.
    expect(await screen.findByText("Stopped")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Stop pnpm dev" })).toBeNull();
    expect(screen.getByRole("header", { name: "Shell" })).toBeOnTheScreen();
  } finally {
    alert.mockRestore();
  }
});

test.each([
  [{ exit: 0, status: "exited" as const }, "Exited"],
  [{ exit: 2, status: "exited" as const }, "Exited with code 2"],
  [{ status: "timeout" as const }, "Timed out"],
  [{ status: "killed" as const }, "Stopped"],
])("a shell that ends while open shows how it ended (%o)", async (end, label) => {
  shellStates = { sh_dev: {} };
  const queryClient = testQueryClient();
  renderWithoutQueries(
    <QueryClientProvider client={queryClient}>
      <SessionShellScope.Provider
        value={{
          client: {} as OpenCodeClient,
          connectionId: "connection-1",
          enabled: true,
          location,
        }}
      >
        <SessionBackgroundTasks
          messages={[shellLaunch("sh_dev", "pnpm dev")]}
          onOpenChild={jest.fn()}
        />
      </SessionShellScope.Provider>
    </QueryClientProvider>,
  );
  fireEvent.press(await findChip("1 shell, running in this session"));
  fireEvent.press(screen.getByRole("button", { name: "pnpm dev, Running" }));
  expect(await screen.findByRole("button", { name: "Stop pnpm dev" })).toBeOnTheScreen();
  shellStates = { sh_dev: { ...end, time: { completed: 61_000, started: 1_000 } } };
  await act(async () => {
    await queryClient.invalidateQueries();
  });
  expect(await screen.findByText(label)).toBeOnTheScreen();
  // The run time freezes at the server's completion time, beside the state, not inside it.
  expect(screen.getByText(" · 1m", { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Stop pnpm dev" })).toBeNull();
  expect(screen.getByRole("header", { name: "Shell" })).toBeOnTheScreen();
  // The chip reads its own status query, which settles on its own refresh.
  await waitFor(() => expect(screen.queryByTestId("subagent-monitor-chip")).toBeNull());
});

test("a stale monitor keeps the shell page without Stop", async () => {
  shellStates = { sh_dev: {} };
  const messages = [shellLaunch("sh_dev", "pnpm dev")];
  const view = renderWithShells(
    <SessionBackgroundTasks messages={messages} onOpenChild={jest.fn()} />,
  );
  fireEvent.press(await findChip("1 shell, running in this session"));
  fireEvent.press(screen.getByRole("button", { name: "pnpm dev, Running" }));
  expect(await screen.findByRole("button", { name: "Stop pnpm dev" })).toBeOnTheScreen();
  view.rerender(<SessionBackgroundTasks messages={messages} onOpenChild={jest.fn()} stale />);
  expect(screen.getByText("Status unavailable · showing last known")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Stop pnpm dev" })).toBeNull();
});

async function openShellPage(command = "pnpm dev") {
  fireEvent.press(await findChip("1 shell, running in this session"));
  fireEvent.press(screen.getByRole("button", { name: `${command}, Running` }));
  expect(await screen.findByRole("button", { name: `Stop ${command}` })).toBeOnTheScreen();
}

test("Android back on the shell page returns to the list instead of closing the sheet", async () => {
  const platform = jest.replaceProperty(Platform, "OS", "android");
  try {
    shellStates = { sh_dev: {} };
    renderWithShells(
      <SessionBackgroundTasks
        messages={[shellLaunch("sh_dev", "pnpm dev")]}
        onOpenChild={jest.fn()}
      />,
    );
    await openShellPage();
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(screen.getByRole("header", { name: "Shells" })).toBeOnTheScreen();
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(false);
  } finally {
    platform.restore();
  }
});

test("an iOS swipe on the shell page closes the sheet, so the chip can open it again", async () => {
  shellStates = { sh_dev: {} };
  renderWithShells(
    <SessionBackgroundTasks
      messages={[shellLaunch("sh_dev", "pnpm dev")]}
      onOpenChild={jest.fn()}
    />,
  );
  await openShellPage();
  act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(false);
  fireEvent.press(screen.getByRole("button", { name: "1 shell, running in this session" }));
  expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(true);
  expect(screen.getByRole("header", { name: "Shells" })).toBeOnTheScreen();
});

test("a failed output refresh shows the last known state without Stop", async () => {
  shellStates = { sh_dev: {} };
  const queryClient = testQueryClient();
  renderWithoutQueries(
    <QueryClientProvider client={queryClient}>
      <SessionShellScope.Provider
        value={{
          client: {} as OpenCodeClient,
          connectionId: "connection-1",
          enabled: true,
          location,
        }}
      >
        <SessionBackgroundTasks
          messages={[shellLaunch("sh_dev", "pnpm dev")]}
          onOpenChild={jest.fn()}
        />
      </SessionShellScope.Provider>
    </QueryClientProvider>,
  );
  await openShellPage();
  getShell.mockRejectedValue(new Error("UNREACHABLE"));
  await act(async () => {
    await queryClient.refetchQueries({ type: "active" });
  });
  expect(await screen.findByText("Shell output could not be refreshed.")).toBeOnTheScreen();
  expect(screen.getByText("Last known: Running")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Stop pnpm dev" })).toBeNull();
});

test("Back after the only shell ended returns to the list, which still says what runs", async () => {
  shellStates = { sh_dev: {} };
  const queryClient = testQueryClient();
  renderWithoutQueries(
    <QueryClientProvider client={queryClient}>
      <SessionShellScope.Provider
        value={{
          client: {} as OpenCodeClient,
          connectionId: "connection-1",
          enabled: true,
          location,
        }}
      >
        <SessionBackgroundTasks
          messages={[shellLaunch("sh_dev", "pnpm dev")]}
          onOpenChild={jest.fn()}
        />
      </SessionShellScope.Provider>
    </QueryClientProvider>,
  );
  await openShellPage();
  shellStates = { sh_dev: { exit: 0, status: "exited" } };
  await act(async () => {
    await queryClient.invalidateQueries();
  });
  expect(await screen.findByText("Exited")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Back to background work" }));
  // The empty state is the focus target once the row and the Shells header are gone.
  expect(screen.getByText("Nothing is running in this session.")).toBeOnTheScreen();
  expect(screen.queryByRole("header", { name: "Shells" })).toBeNull();
});

test("background subagent changes are announced from the chip", () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  announce.mockClear();
  try {
    const view = render(
      <SessionBackgroundTasks
        activeSessions={{ ses_tests: {} }}
        messages={[launch("ses_tests", "Run tests")]}
        onOpenChild={jest.fn()}
        sessionID="ses_parent"
      />,
    );
    expect(announce).not.toHaveBeenCalled();
    view.rerender(
      <SessionBackgroundTasks
        activeSessions={{ ses_tests: {} }}
        attention={new Map([["ses_tests", "permission" as const]])}
        messages={[launch("ses_tests", "Run tests")]}
        onOpenChild={jest.fn()}
        sessionID="ses_parent"
      />,
    );
    expect(announce).toHaveBeenCalledWith("Background subagent Run tests needs you");
    announce.mockClear();
    // Two changes in one update are read as one announcement, so neither cuts the other off.
    view.rerender(
      <SessionBackgroundTasks
        activeSessions={{ ses_tests: {}, ses_lint: {} }}
        messages={[launch("ses_tests", "Run tests"), launch("ses_lint", "Lint")]}
        onOpenChild={jest.fn()}
        sessionID="ses_parent"
      />,
    );
    announce.mockClear();
    view.rerender(
      <SessionBackgroundTasks
        activeSessions={{ ses_tests: {}, ses_lint: {} }}
        attention={
          new Map([
            ["ses_tests", "permission" as const],
            ["ses_lint", "input" as const],
          ])
        }
        messages={[launch("ses_tests", "Run tests"), launch("ses_lint", "Lint")]}
        onOpenChild={jest.fn()}
        sessionID="ses_parent"
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "Background subagent Lint needs you. Background subagent Run tests needs you",
    );
  } finally {
    announce.mockRestore();
  }
});

test("the live region holds the state words only, never the ticking time", async () => {
  shellStates = { sh_dev: {} };
  renderWithShells(
    <SessionBackgroundTasks
      messages={[shellLaunch("sh_dev", "pnpm dev")]}
      onOpenChild={jest.fn()}
    />,
  );
  await openShellPage();
  const status = screen.getByText("Running");
  expect(status.props.accessibilityLiveRegion).toBe("polite");
  expect(status).toHaveTextContent("Running", { exact: true });
});

test("stopping a shell that already ended shows how it ended, not a failure", async () => {
  shellStates = { sh_dev: {} };
  removeShell.mockImplementation(async () => {
    removed.add("sh_dev");
    throw notFound;
  });
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons?: AlertButton[]) =>
      buttons?.find((button) => button.text === "Stop shell")?.onPress?.(),
    );
  try {
    renderWithShells(
      <SessionBackgroundTasks
        messages={[shellLaunch("sh_dev", "pnpm dev")]}
        onOpenChild={jest.fn()}
      />,
    );
    await openShellPage();
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Stop pnpm dev" }));
    });
    expect(await screen.findByText("Stopped")).toBeOnTheScreen();
    expect(screen.queryByText("The shell could not be stopped. Try again.")).toBeNull();
  } finally {
    alert.mockRestore();
  }
});

test("a stale page keeps the last output and says the state is last known", async () => {
  shellStates = { sh_dev: {} };
  shellOutput = { sh_dev: "ready on :3000\n" };
  const messages = [shellLaunch("sh_dev", "pnpm dev")];
  const view = renderWithShells(
    <SessionBackgroundTasks messages={messages} onOpenChild={jest.fn()} />,
  );
  await openShellPage();
  expect(await screen.findByText("ready on :3000")).toBeOnTheScreen();
  view.rerender(<SessionBackgroundTasks messages={messages} onOpenChild={jest.fn()} stale />);
  expect(screen.getByText("Last known: Running")).toBeOnTheScreen();
  expect(screen.getByText("ready on :3000")).toBeOnTheScreen();
});

test("long commands are read aloud as one short line", async () => {
  const command = `pnpm exec node --eval "${"x".repeat(200)}"\necho done`;
  shellStates = { sh_long: {} };
  renderWithShells(
    <SessionBackgroundTasks messages={[shellLaunch("sh_long", command)]} onOpenChild={jest.fn()} />,
  );
  fireEvent.press(await findChip("1 shell, running in this session"));
  const row = screen.getByRole("button", { name: /, Running$/ });
  expect(row.props.accessibilityLabel.length).toBeLessThan(140);
  expect(row.props.accessibilityLabel).not.toContain("echo done");
});

test("a failed status refresh makes the chip say its status is unavailable, without motion", async () => {
  shellStates = { sh_dev: {} };
  const queryClient = testQueryClient();
  renderWithoutQueries(
    <QueryClientProvider client={queryClient}>
      <SessionShellScope.Provider
        value={{
          client: {} as OpenCodeClient,
          connectionId: "connection-1",
          enabled: true,
          location,
        }}
      >
        <SessionBackgroundTasks
          messages={[shellLaunch("sh_dev", "pnpm dev")]}
          onOpenChild={jest.fn()}
        />
      </SessionShellScope.Provider>
    </QueryClientProvider>,
  );
  await findChip("1 shell, running in this session");
  getShell.mockRejectedValue(new Error("UNREACHABLE"));
  await act(async () => {
    await queryClient.refetchQueries({ type: "active" });
  });
  expect(
    await screen.findByRole("button", { name: "1 shell, status unavailable" }),
  ).toBeOnTheScreen();
  // Sighted users see the uncertainty too: the count is dimmed.
  expect(screen.getByText("1 shell")).toHaveStyle({ color: palette.dim });
  fireEvent.press(screen.getByRole("button", { name: "1 shell, status unavailable" }));
  expect(screen.getByRole("button", { name: "pnpm dev, Last known: Running" })).toBeOnTheScreen();
});
