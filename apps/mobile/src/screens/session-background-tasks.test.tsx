import { expect, jest, test } from "@jest/globals";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";

import { palette } from "../theme";
import { SessionBackgroundTasks } from "./session-background-tasks";

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
  expect(screen.getByRole("header", { name: "Subagents" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Working" })).toBeOnTheScreen();
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
      sessionID="ses_parent"
    />,
  );
  const chip = screen.getByRole("button", {
    name: "2 subagents · 1 needs you, running in this session",
  });
  expect(chip).toHaveStyle({ borderColor: palette.warm });
  expect(screen.getByTestId("subagent-monitor-waiting")).toBeOnTheScreen();
  fireEvent.press(chip);
  expect(screen.getByRole("header", { name: "Needs you" })).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Deploy preview, @review, Needs approval" }),
  ).toBeOnTheScreen();
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
