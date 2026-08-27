import { expect, jest, test } from "@jest/globals";
import type { SessionInboxInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen } from "@testing-library/react-native";

import type { PromptAdmission } from "./prompt-admission-model";
import { SessionExecutionPanel } from "./session-execution-panel";

const callbacks = {
  onBackground: jest.fn(),
  onAllowRetry: jest.fn(),
  onCancelInbox: jest.fn(),
  onCheckAdmission: jest.fn(),
  onInterrupt: jest.fn(),
  onQueueInbox: jest.fn(),
  onReplyPermission: jest.fn(),
  onSteerInbox: jest.fn(),
  onWait: jest.fn(),
};

test("renders active execution and mutable queued inbox work", () => {
  const inbox = [
    {
      delivery: "queue",
      id: "msg_queued",
      payload: { text: "Queued prompt" },
      sessionID: "ses_test",
      timeCreated: 1,
      type: "user",
    },
  ] satisfies SessionInboxInfo[];
  render(
    <SessionExecutionPanel
      active
      admissions={[]}
      inbox={inbox}
      permissionReplyError={false}
      permissions={[]}
      {...callbacks}
      projectedMessageIds={new Set()}
    />,
  );

  expect(screen.getByText("OpenCode is working")).toBeOnTheScreen();
  expect(screen.getByText("Queued prompt")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Steer now" }));
  fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(callbacks.onSteerInbox).toHaveBeenCalledWith("msg_queued");
  expect(callbacks.onCancelInbox).toHaveBeenCalledWith("msg_queued");
});

test("keeps unknown delivery visible until reconciliation finds the stable ID", () => {
  const admission: PromptAdmission = {
    durable: false,
    id: "msg_unknown",
    kind: "prompt",
    status: "unknown-delivery",
    submittedAtMs: 1,
  };
  const view = render(
    <SessionExecutionPanel
      active={false}
      admissions={[admission]}
      inbox={[]}
      permissionReplyError={false}
      permissions={[]}
      {...callbacks}
      projectedMessageIds={new Set()}
    />,
  );

  expect(screen.getByText("DELIVERY UNKNOWN")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Check delivery" }));
  expect(callbacks.onCheckAdmission).toHaveBeenCalledWith("msg_unknown");

  view.rerender(
    <SessionExecutionPanel
      active={false}
      admissions={[admission]}
      inbox={[]}
      permissionReplyError={false}
      permissions={[]}
      {...callbacks}
      projectedMessageIds={new Set(["msg_unknown"])}
    />,
  );
  expect(screen.queryByText("DELIVERY UNKNOWN")).not.toBeOnTheScreen();
});

test("only offers a duplicate-risk retry after an explicit empty reconciliation", () => {
  const admission: PromptAdmission = {
    durable: false,
    id: "msg_unknown",
    kind: "prompt",
    retryOffered: true,
    status: "unknown-delivery",
    submittedAtMs: 1,
  };
  render(
    <SessionExecutionPanel
      active={false}
      admissions={[admission]}
      inbox={[]}
      permissionReplyError={false}
      permissions={[]}
      {...callbacks}
      projectedMessageIds={new Set()}
    />,
  );

  fireEvent.press(screen.getByRole("button", { name: "Allow retry (may duplicate)" }));
  expect(callbacks.onAllowRetry).toHaveBeenCalledWith("msg_unknown");
});

test("explains that command recovery cannot identify delivery", () => {
  render(
    <SessionExecutionPanel
      active={false}
      admissions={[
        {
          durable: false,
          id: "msg_command",
          kind: "command",
          retryOffered: true,
          status: "unknown-delivery",
          submittedAtMs: 1,
        },
      ]}
      inbox={[]}
      permissionReplyError={false}
      permissions={[]}
      {...callbacks}
      projectedMessageIds={new Set()}
    />,
  );

  expect(screen.getByText(/server may have run this command/i)).toBeOnTheScreen();
});

test("shows and replies to a permission blocking the current session", () => {
  render(
    <SessionExecutionPanel
      active
      admissions={[]}
      inbox={[]}
      permissionReplyError={false}
      permissions={[
        {
          action: "shell",
          id: "per_test",
          resources: ["pnpm test"],
          save: ["pnpm *"],
          sessionID: "ses_test",
        },
      ]}
      {...callbacks}
      projectedMessageIds={new Set()}
    />,
  );

  expect(screen.getByText("Waiting for permission")).toBeOnTheScreen();
  expect(screen.getByText("PERMISSION REQUIRED")).toBeOnTheScreen();
  expect(screen.getByText("pnpm test")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Allow once" }));
  expect(callbacks.onReplyPermission).toHaveBeenCalledWith("per_test", "ses_test", "once");
});
