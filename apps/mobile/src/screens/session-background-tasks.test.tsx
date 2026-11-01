import { expect, jest, test } from "@jest/globals";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen } from "@testing-library/react-native";

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

test("background chip opens known child tasks without repeating transcript content", () => {
  const onOpenChild = jest.fn();
  render(<SessionBackgroundTasks messages={[taskMessage("running")]} onOpenChild={onOpenChild} />);
  expect(screen.queryByText("Private task content")).toBeNull();
  const chip = screen.getByRole("button", { name: "1 subagent running in background" });
  expect(chip).toHaveStyle({ minHeight: 36 });
  expect(chip.props.hitSlop).toBe(6);
  fireEvent.press(chip);
  expect(screen.getByText("Background tasks")).toBeOnTheScreen();
  expect(screen.getByText("Subagent 1")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Open Subagent 1" }));
  expect(onOpenChild).toHaveBeenCalledWith("ses_child");
});

test.each(["completed", "error"] as const)(
  "latest %s result removes a running task chip",
  (state) => {
    const view = render(
      <SessionBackgroundTasks messages={[taskMessage("running")]} onOpenChild={jest.fn()} />,
    );
    fireEvent.press(screen.getByRole("button", { name: "1 subagent running in background" }));
    view.rerender(
      <SessionBackgroundTasks
        messages={[taskMessage(state), taskMessage("running")]}
        onOpenChild={jest.fn()}
      />,
    );
    expect(screen.queryByText("Background tasks")).toBeNull();
    expect(screen.queryByRole("button", { name: "1 subagent running in background" })).toBeNull();
  },
);

test("empty session has no task chip", () => {
  render(<SessionBackgroundTasks messages={[]} onOpenChild={jest.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
});

test("background launches count while their child sessions are active", () => {
  const launch = (sessionID: string): SessionMessageInfo => ({
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
          input: { background: true, description: "Restyle" },
          metadata: { sessionID, status: "running" },
          content: [{ type: "text", text: "The subagent is working in the background." }],
        },
      },
    ],
  });
  const messages = [launch("ses_a"), launch("ses_b"), launch("ses_c")];
  const view = render(<SessionBackgroundTasks messages={messages} onOpenChild={jest.fn()} />);
  expect(
    screen.getByRole("button", { name: "3 subagents running in background" }),
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
    screen.getByRole("button", { name: "2 subagents running in background" }),
  ).toBeOnTheScreen();
});

test("the task sheet names each subagent by its task", () => {
  const onOpenChild = jest.fn();
  render(
    <SessionBackgroundTasks
      messages={[
        {
          id: "msg_launch",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          time: { created: 1, completed: 1 },
          content: [
            {
              id: "tool_launch",
              name: "subagent",
              type: "tool",
              time: { created: 1 },
              state: {
                status: "completed",
                input: { background: true, description: "Review settings screen" },
                metadata: { sessionID: "ses_settings", status: "running" },
                content: [{ type: "text", text: "The subagent is working in the background." }],
              },
            },
          ],
        },
      ]}
      onOpenChild={onOpenChild}
    />,
  );
  fireEvent.press(screen.getByRole("button", { name: "1 subagent running in background" }));
  expect(screen.getByText("Review settings screen")).toBeOnTheScreen();
  expect(screen.getByText("Running")).toBeOnTheScreen();
  expect(screen.queryByText(/Subagent 1/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Open Review settings screen" }));
  expect(onOpenChild).toHaveBeenCalledWith("ses_settings");
});
