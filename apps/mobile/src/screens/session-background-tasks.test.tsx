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
  fireEvent.press(screen.getByRole("button", { name: "1 subagent running in background" }));
  expect(screen.getByText("Background tasks")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Open child session for subagent 1" }));
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
