import { expect, jest, test } from "@jest/globals";
import type { SessionInboxInfo } from "@opencode2-mobile/opencode-adapter";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Alert, type AlertButton, Platform } from "react-native";
import { minTouchTarget, palette, typography } from "../theme";
import type { PromptAdmission } from "./prompt-admission-model";
import { SessionExecutionPanel, SessionWorkingStatus } from "./session-execution-panel";

function confirmAlerts() {
  return jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons?: AlertButton[]) =>
      buttons?.find((button) => button.style === "destructive")?.onPress?.(),
    );
}

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

test("composer-owned Stop removes the duplicate panel control", () => {
  render(
    <SessionExecutionPanel
      active
      hideInterrupt
      admissions={[]}
      inbox={[]}
      permissions={[]}
      permissionReplyError={false}
      projectedMessageIds={new Set()}
      {...callbacks}
    />,
  );
  expect(screen.getByText("Working")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

test("a transcript-pinned status leaves the panel empty while only working", () => {
  render(
    <SessionExecutionPanel
      active
      canBackground
      hideInterrupt
      hideStatus
      admissions={[]}
      inbox={[]}
      permissions={[]}
      permissionReplyError={false}
      projectedMessageIds={new Set()}
      {...callbacks}
    />,
  );
  expect(screen.queryByLabelText("Session execution")).toBeNull();
  expect(screen.queryByText("Working")).toBeNull();
  const onBackground = jest.fn();
  render(
    <SessionWorkingStatus
      canBackground
      hideInterrupt
      onBackground={onBackground}
      onInterrupt={jest.fn()}
    />,
  );
  expect(screen.getByText("Working")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Move to background" }));
  expect(onBackground).toHaveBeenCalledTimes(1);
});

test.each(["admitted", "queued", "steered", "promoted", "executing"] as const)(
  "the %s handoff keeps Working without a non-actionable admission card",
  (status) => {
    render(
      <SessionExecutionPanel
        active
        admissions={[
          {
            id: "msg_handoff",
            kind: "prompt",
            durable: true,
            status,
            submittedAtMs: 1,
          },
        ]}
        inbox={[]}
        permissions={[]}
        permissionReplyError={false}
        projectedMessageIds={new Set()}
        {...callbacks}
      />,
    );
    expect(screen.getByText("Working")).toBeOnTheScreen();
    expect(
      screen.queryByText("Waiting for the durable inbox item or projected message."),
    ).toBeNull();
    expect(screen.queryByText(status.toUpperCase())).toBeNull();
  },
);

test("a brief steering inbox snapshot without a local admission never flashes controls", () => {
  jest.useFakeTimers({ now: 1_000 });
  try {
    const props = {
      active: false,
      admissions: [],
      permissions: [],
      permissionReplyError: false,
      projectedMessageIds: new Set<string>(),
      ...callbacks,
    };
    const view = render(
      <SessionExecutionPanel
        {...props}
        inbox={[
          {
            id: "msg_steering",
            type: "user",
            sessionID: "ses_test",
            delivery: "steer",
            payload: { text: "Prompt" },
            time: { created: 1 },
          },
        ]}
      />,
    );
    expect(screen.queryByText("STEERING")).toBeNull();
    expect(screen.queryByRole("button", { name: "Queue next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    act(() => jest.advanceTimersByTime(100));
    view.rerender(<SessionExecutionPanel {...props} inbox={[]} />);
    act(() => jest.advanceTimersByTime(500));
    expect(screen.queryByLabelText("Session execution")).toBeNull();
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

test("a prompt promoted within 200ms never flashes admission or inbox action cards", () => {
  jest.useFakeTimers({ now: 1_000 });
  try {
    const admission: PromptAdmission = {
      id: "msg_fast",
      kind: "prompt",
      durable: false,
      status: "submitting",
      submittedAtMs: Date.now(),
    };
    const props = {
      active: false,
      admissions: [admission],
      inbox: [] as SessionInboxInfo[],
      permissions: [],
      permissionReplyError: false,
      projectedMessageIds: new Set<string>(),
      ...callbacks,
    };
    const view = render(<SessionExecutionPanel {...props} />);
    expect(screen.queryByText("SENDING")).toBeNull();
    act(() => jest.advanceTimersByTime(100));
    view.rerender(
      <SessionExecutionPanel
        {...props}
        active
        admissions={[{ ...admission, durable: true, status: "queued" }]}
        inbox={[
          {
            id: admission.id,
            type: "user",
            sessionID: "ses_test",
            delivery: "queue",
            payload: { text: "Quick prompt" },
            time: { created: Date.now() },
          },
        ]}
      />,
    );
    expect(screen.queryByText("Queued")).toBeNull();
    expect(screen.queryByRole("button", { name: "Steer now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    act(() => jest.advanceTimersByTime(100));
    view.rerender(
      <SessionExecutionPanel {...props} active projectedMessageIds={new Set([admission.id])} />,
    );
    act(() => jest.advanceTimersByTime(1_000));
    expect(screen.queryByText("SENDING")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

test.each(["submitting", "queued"] as const)(
  "a persistent %s prompt appears after the grace period even across refetches",
  (status) => {
    jest.useFakeTimers({ now: 1_000 });
    try {
      const admission: PromptAdmission = {
        id: "msg_slow",
        kind: "prompt",
        durable: status === "queued",
        status,
        submittedAtMs: Date.now(),
      };
      const props = {
        active: false,
        admissions: [admission],
        inbox:
          status === "queued"
            ? ([
                {
                  id: admission.id,
                  type: "user",
                  sessionID: "ses_test",
                  delivery: "queue",
                  payload: { text: "Waiting prompt" },
                  time: { created: Date.now() },
                },
              ] satisfies SessionInboxInfo[])
            : [],
        permissions: [],
        permissionReplyError: false,
        projectedMessageIds: new Set<string>(),
        ...callbacks,
      };
      const view = render(<SessionExecutionPanel {...props} />);
      act(() => jest.advanceTimersByTime(300));
      view.rerender(<SessionExecutionPanel {...props} admissions={[{ ...admission }]} />);
      act(() => jest.advanceTimersByTime(199));
      expect(screen.queryByLabelText("Session execution")).toBeNull();
      act(() => jest.advanceTimersByTime(1));
      expect(screen.getByText(status === "queued" ? "Queued" : "Sending")).toBeOnTheScreen();
      if (status === "queued") {
        const alert = confirmAlerts();
        fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
        expect(callbacks.onCancelInbox).toHaveBeenCalledWith(admission.id);
        alert.mockRestore();
      }
      view.unmount();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  },
);

test("a projected prompt never retains stale inbox action cards", () => {
  render(
    <SessionExecutionPanel
      active={false}
      admissions={[]}
      inbox={[
        {
          id: "msg_projected",
          type: "user",
          sessionID: "ses_test",
          delivery: "steer",
          payload: { text: "Already in transcript" },
          time: { created: 1 },
        },
      ]}
      permissions={[]}
      permissionReplyError={false}
      projectedMessageIds={new Set(["msg_projected"])}
      {...callbacks}
    />,
  );
  expect(screen.queryByLabelText("Session execution")).toBeNull();
});

test("unknown delivery bypasses the grace period", () => {
  render(
    <SessionExecutionPanel
      active={false}
      admissions={[
        {
          id: "msg_recent_unknown",
          kind: "prompt",
          durable: false,
          status: "unknown-delivery",
          retryOffered: true,
          submittedAtMs: Date.now(),
        },
      ]}
      inbox={[]}
      permissions={[]}
      permissionReplyError={false}
      projectedMessageIds={new Set()}
      {...callbacks}
    />,
  );
  expect(screen.getByRole("button", { name: "Check delivery" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Allow retry (may duplicate)" })).toBeOnTheScreen();
});

test("ordinary active execution does not advertise a background action", () => {
  render(
    <SessionExecutionPanel
      active
      admissions={[]}
      inbox={[]}
      permissions={[]}
      permissionReplyError={false}
      projectedMessageIds={new Set()}
      {...callbacks}
    />,
  );
  expect(screen.getByRole("button", { name: "Stop" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Move to background" })).toBeNull();
});

test("renders active execution and mutable queued inbox work", async () => {
  const inbox = [
    {
      delivery: "queue",
      id: "msg_queued",
      payload: { text: "Queued prompt" },
      sessionID: "ses_test",
      time: { created: 1 },
      type: "user",
    },
  ] satisfies SessionInboxInfo[];
  render(
    <SessionExecutionPanel
      active
      canBackground
      admissions={[]}
      inbox={inbox}
      permissionReplyError={false}
      permissions={[]}
      {...callbacks}
      projectedMessageIds={new Set()}
    />,
  );

  expect(screen.getByText("Working")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Move to background" }));
  expect(callbacks.onBackground).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole("button", { name: "Stop" }));
  expect(callbacks.onInterrupt).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByText("Queued prompt")).toBeOnTheScreen());
  expect(screen.getByText("Queued prompt")).toHaveStyle({
    ...typography.subheadline,
    color: palette.ink,
  });
  expect(screen.getByText("Queued")).toHaveStyle({ ...typography.label, color: palette.dim });
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveStyle({
    borderColor: palette.border,
  });
  fireEvent.press(screen.getByRole("button", { name: "Steer now" }));
  expect(callbacks.onSteerInbox).toHaveBeenCalledWith("msg_queued");
  const alert = confirmAlerts();
  fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(alert).toHaveBeenCalledWith(
    "Cancel queued prompt?",
    "The prompt leaves the queue and is not sent.",
    expect.any(Array),
  );
  expect(callbacks.onCancelInbox).toHaveBeenCalledWith("msg_queued");
  alert.mockRestore();
});

test("cancelling a queued prompt waits for confirmation", async () => {
  callbacks.onCancelInbox.mockClear();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  render(
    <SessionExecutionPanel
      active={false}
      admissions={[]}
      inbox={[
        {
          delivery: "queue",
          id: "msg_queued",
          payload: { text: "Queued prompt" },
          sessionID: "ses_test",
          time: { created: 1 },
          type: "user",
        },
      ]}
      permissionReplyError={false}
      permissions={[]}
      {...callbacks}
      projectedMessageIds={new Set()}
    />,
  );
  await waitFor(() => expect(screen.getByText("Queued prompt")).toBeOnTheScreen());
  fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  const buttons = alert.mock.calls[0]?.[2];
  expect(buttons?.map((button) => [button.text, button.style])).toEqual([
    ["Keep", "cancel"],
    ["Cancel prompt", "destructive"],
  ]);
  expect(callbacks.onCancelInbox).not.toHaveBeenCalled();
  alert.mockRestore();
});

test("agent-switch reminders do not become actionable steering cards", () => {
  render(
    <SessionExecutionPanel
      active={false}
      admissions={[]}
      permissions={[]}
      permissionReplyError={false}
      projectedMessageIds={new Set()}
      {...callbacks}
      inbox={[
        {
          type: "synthetic",
          id: "msg_mode",
          sessionID: "ses_test",
          time: { created: 1 },
          delivery: "steer",
          payload: { text: "<system-reminder>You are in Plan mode.</system-reminder>" },
        },
      ]}
    />,
  );
  expect(screen.queryByText("STEERING")).toBeNull();
  expect(screen.queryByRole("button", { name: "Queue next" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});

test("steering never offers Queue next, even when it remains pending", () => {
  jest.useFakeTimers();
  const view = render(
    <SessionExecutionPanel
      active={false}
      admissions={[]}
      permissions={[]}
      permissionReplyError={false}
      projectedMessageIds={new Set()}
      {...callbacks}
      inbox={[
        {
          type: "synthetic",
          id: "msg_mode",
          sessionID: "ses_test",
          time: { created: 1 },
          delivery: "steer",
          payload: { text: "Mode reminder" },
        },
        {
          type: "user",
          id: "msg_followup",
          sessionID: "ses_test",
          time: { created: 2 },
          delivery: "steer",
          payload: { text: "Please check the tests" },
        },
      ]}
    />,
  );
  try {
    act(() => jest.advanceTimersByTime(5_000));
    expect(screen.queryByText("STEERING")).toBeNull();
    expect(screen.queryByText("Please check the tests")).toBeNull();
    expect(screen.queryByRole("button", { name: "Queue next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
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

  expect(screen.getByText("Delivery unknown")).toBeOnTheScreen();
  expect(screen.getByText(/server may have admitted this prompt/)).toHaveStyle({
    ...typography.subheadline,
    color: palette.dim,
  });
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
  expect(screen.queryByText("Delivery unknown")).not.toBeOnTheScreen();
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
  expect(screen.getByText("Run shell command")).toBeOnTheScreen();
  expect(screen.getByText("pnpm test")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Allow once" }));
  expect(callbacks.onReplyPermission).toHaveBeenCalledWith("per_test", "ses_test", "once");
});

test("a failed permission reply only marks the request that sent it", () => {
  const permissions = ["per_first", "per_second"].map((id) => ({
    action: "shell",
    id,
    resources: [`echo ${id}`],
    save: [],
    sessionID: "ses_test",
  }));
  const props = {
    active: true,
    admissions: [],
    inbox: [],
    permissions,
    projectedMessageIds: new Set<string>(),
    ...callbacks,
  };
  const view = render(<SessionExecutionPanel {...props} permissionReplyError={false} />);
  const secondReject = screen.getAllByRole("button", { name: "Reject" })[1];
  if (!secondReject) throw new Error("Missing second Reject action");
  fireEvent.press(secondReject);
  expect(callbacks.onReplyPermission).toHaveBeenLastCalledWith("per_second", "ses_test", "reject");
  view.rerender(<SessionExecutionPanel {...props} permissionReplyError />);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getAllByText(/^The server did not accept that reply/)).toHaveLength(1);
});

test("status controls keep a 48pt target and VoiceOver hears a permission wait", () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(jest.fn());
  announce.mockClear();
  const view = render(<SessionWorkingStatus onInterrupt={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Stop" })).toHaveStyle({ minHeight: minTouchTarget });
  expect(announce).not.toHaveBeenCalled();
  view.rerender(<SessionWorkingStatus onInterrupt={jest.fn()} waitingFor="permission" />);
  expect(announce).toHaveBeenCalledWith("Waiting for permission");
  announce.mockRestore();
  jest.restoreAllMocks();
});
