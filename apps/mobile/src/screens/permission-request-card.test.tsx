import { afterEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { AccessibilityInfo, Alert, type AlertButton, Dimensions, Platform } from "react-native";
import { minTouchTarget, palette, typography } from "../theme";
import { PermissionRequestCard } from "./permission-request-card";

const command = `python3 - <<'PY'\n${"print('review me')\n".repeat(100)}PY`;
const request = {
  action: "shell",
  id: "per_approval",
  sessionID: "ses_owner",
  resources: [command],
  save: ["python3 *"],
};
const editRequest = {
  action: "edit",
  id: "per_edit",
  sessionID: "ses_owner",
  resources: ["src/auth/token-refresh.ts", "src/auth/session.ts", "src/auth/cookie.ts"],
  save: ["src/auth/**", "test/auth/**"],
};

afterEach(() => {
  jest.restoreAllMocks();
});

function pressAlertButton(text: string) {
  return jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons?: AlertButton[]) =>
      buttons?.find((button) => button.text === text)?.onPress?.(),
    );
}

test("permission messages use neutral headings and shared error typography", () => {
  render(<PermissionRequestCard request={request} replying={false} error onReply={jest.fn()} />);
  expect(screen.getByText("Run shell command")).toHaveStyle({
    ...typography.headline,
    color: palette.ink,
  });
  expect(screen.getByText("Permission required")).toHaveStyle({
    ...typography.sectionLabel,
    color: palette.warm,
  });
  expect(screen.getByRole("alert")).toHaveStyle({
    ...typography.subheadline,
    color: palette.danger,
  });
});

test("shell requests show six selectable lines and open the full command from the card", () => {
  render(
    <PermissionRequestCard request={request} replying={false} error={false} onReply={jest.fn()} />,
  );
  const preview = screen.getByText(/^python3 - <<'PY'/);
  expect(preview.props.numberOfLines).toBe(6);
  expect(preview.props.selectable).toBe(true);
  expect(screen.queryByText(command)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Show full command" }));
  expect(screen.getByText(command)).toBeOnTheScreen();
  expect(
    within(screen.getByLabelText("Saved permission patterns")).getByText("python3 *"),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Always allow saves the displayed patterns, which can cover more than this request.",
    ),
  ).toBeOnTheScreen();
});

test("short shell commands have no full command button", () => {
  render(
    <PermissionRequestCard
      request={{ ...request, resources: ["pnpm test"] }}
      replying={false}
      error={false}
      onReply={jest.fn()}
    />,
  );
  expect(screen.getByText("pnpm test")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Show full command" })).toBeNull();
});

test("known actions get a plain heading and list the first two resources inline", () => {
  render(
    <PermissionRequestCard
      request={editRequest}
      replying={false}
      error={false}
      onReply={jest.fn()}
    />,
  );
  expect(screen.getByText("Edit 3 files")).toBeOnTheScreen();
  expect(screen.getByText("src/auth/token-refresh.ts")).toBeOnTheScreen();
  expect(screen.getByText("src/auth/session.ts")).toBeOnTheScreen();
  expect(screen.getByText("+1 more")).toBeOnTheScreen();
  expect(screen.queryByText("src/auth/cookie.ts")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText("src/auth/cookie.ts")).toBeOnTheScreen();
});

test("custom tool permissions keep the tool name and show their resources", () => {
  render(
    <PermissionRequestCard
      request={{ ...request, action: "mobile-approval-ui-test", resources: ["one", "two"] }}
      replying={false}
      error={false}
      onReply={jest.fn()}
    />,
  );
  expect(screen.getByText("Call tool mobile-approval-ui-test")).toBeOnTheScreen();
  expect(screen.getByText("one")).toBeOnTheScreen();
  expect(screen.getByText("two")).toBeOnTheScreen();
  expect(screen.queryByText(/more$/)).toBeNull();
});

test("Always allow names the saved pattern and confirms before replying", () => {
  const reply = jest.fn();
  render(
    <PermissionRequestCard request={editRequest} replying={false} error={false} onReply={reply} />,
  );
  const always = screen.getByRole("button", { name: "Always allow src/auth/** and 1 more" });
  expect(always).toHaveStyle({ minHeight: minTouchTarget });
  expect(within(always).getByText(/\+1/)).toBeOnTheScreen();

  const cancel = pressAlertButton("Cancel");
  fireEvent.press(always);
  expect(cancel).toHaveBeenCalledWith(
    "Always allow?",
    expect.stringContaining("src/auth/**\ntest/auth/**"),
    expect.any(Array),
  );
  expect(reply).not.toHaveBeenCalled();

  cancel.mockRestore();
  pressAlertButton("Always allow");
  fireEvent.press(always);
  expect(reply).toHaveBeenCalledWith("per_edit", "ses_owner", "always");
});

test("Always allow without saved patterns explains it covers future matching requests", () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  render(
    <PermissionRequestCard
      request={{ ...editRequest, save: [] }}
      replying={false}
      error={false}
      onReply={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByRole("button", { name: "Always allow" }));
  expect(alert).toHaveBeenCalledWith(
    "Always allow?",
    "Future requests that match this one will be allowed without asking.",
    expect.any(Array),
  );
});

test("Reject sits before Allow once and both reply directly", () => {
  const originalWindow = Dimensions.get("window");
  Dimensions.set({ window: { ...originalWindow, fontScale: 1 } });
  try {
    const reply = jest.fn();
    render(
      <PermissionRequestCard request={request} replying={false} error={false} onReply={reply} />,
    );
    const buttons = screen.getAllByRole("button").map((button) => button.props.accessibilityLabel);
    expect(buttons.indexOf("Reject")).toBeLessThan(buttons.indexOf("Allow once"));
    expect(screen.getByRole("button", { name: "Reject" })).toHaveStyle({ minWidth: 104 });
    expect(screen.getByRole("button", { name: "Allow once" })).toHaveStyle({
      backgroundColor: palette.signal,
      flexGrow: 1,
      minHeight: minTouchTarget,
    });
    fireEvent.press(screen.getByRole("button", { name: "Reject" }));
    expect(reply).toHaveBeenLastCalledWith(request.id, request.sessionID, "reject");
    fireEvent.press(screen.getByRole("button", { name: "Allow once" }));
    expect(reply).toHaveBeenLastCalledWith(request.id, request.sessionID, "once");
  } finally {
    Dimensions.set({ window: originalWindow });
  }
});

test("large text stacks the reply actions", () => {
  const originalWindow = Dimensions.get("window");
  Dimensions.set({ window: { ...originalWindow, fontScale: 1.5 } });
  try {
    render(
      <PermissionRequestCard
        request={request}
        replying={false}
        error={false}
        onReply={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Allow once" })).toHaveStyle({
      alignSelf: "stretch",
    });
    expect(screen.getByRole("button", { name: "Reject" })).not.toHaveStyle({ minWidth: 104 });
  } finally {
    Dimensions.set({ window: originalWindow });
  }
});

test("Details repeats the reply actions and closes after a reply", () => {
  const reply = jest.fn();
  render(
    <PermissionRequestCard request={request} replying={false} error={false} onReply={reply} />,
  );
  fireEvent.press(screen.getByRole("button", { name: "Details" }));
  const allowButtons = screen.getAllByRole("button", { name: "Allow once" });
  expect(allowButtons).toHaveLength(2);
  const sheetAllow = allowButtons[1];
  if (!sheetAllow) throw new Error("Missing Allow once in Details");
  fireEvent.press(sheetAllow);
  expect(reply).toHaveBeenCalledWith(request.id, request.sessionID, "once");
  expect(screen.queryByText(command)).toBeNull();
});

test("pending replies disable every choice and errors give a retry path", () => {
  const view = render(
    <PermissionRequestCard request={request} replying error={false} onReply={jest.fn()} />,
  );
  for (const name of ["Allow once", "Always allow python3 *", "Reject"])
    expect(screen.getByRole("button", { name })).toBeDisabled();
  expect(screen.getByText("Sending permission reply…")).toBeOnTheScreen();
  view.rerender(
    <PermissionRequestCard request={request} replying={false} error onReply={jest.fn()} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The server did not accept that reply. Review the refreshed request and try again.",
  );
  expect(screen.getByRole("button", { name: "Allow once" })).toBeEnabled();
});

test("VoiceOver hears the pending reply and its failure", () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(jest.fn());
  announce.mockClear();
  const view = render(
    <PermissionRequestCard request={request} replying error={false} onReply={jest.fn()} />,
  );
  expect(announce).toHaveBeenCalledWith("Sending permission reply…");
  view.rerender(
    <PermissionRequestCard request={request} replying={false} error onReply={jest.fn()} />,
  );
  expect(announce).toHaveBeenLastCalledWith(
    "The server did not accept that reply. Review the refreshed request and try again.",
  );
});

test("shell previews show the full command button only when layout cuts lines off", () => {
  render(
    <PermissionRequestCard
      request={{ ...request, resources: ["pnpm test --watch"] }}
      replying={false}
      error={false}
      onReply={jest.fn()}
    />,
  );
  const preview = screen.getByText("pnpm test --watch");
  fireEvent(preview, "textLayout", { nativeEvent: { lines: [{ text: "pnpm test" }] } });
  expect(screen.getByRole("button", { name: "Show full command" })).toBeOnTheScreen();
  fireEvent(preview, "textLayout", {
    nativeEvent: { lines: [{ text: "pnpm test " }, { text: "--watch" }] },
  });
  expect(screen.queryByRole("button", { name: "Show full command" })).toBeNull();
  fireEvent(preview, "textLayout", {
    nativeEvent: { lines: Array.from({ length: 7 }, () => ({ text: "" })) },
  });
  expect(screen.getByRole("button", { name: "Show full command" })).toBeOnTheScreen();
});

test("a single saved pattern is named without a count", () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  render(
    <PermissionRequestCard request={request} replying={false} error={false} onReply={jest.fn()} />,
  );
  const always = screen.getByRole("button", { name: "Always allow python3 *" });
  expect(within(always).queryByText(/\+/)).toBeNull();
  fireEvent.press(always);
  expect(alert).toHaveBeenCalledWith(
    "Always allow?",
    "Future requests that match this pattern will be allowed without asking. A pattern can cover more than this request.\n\npython3 *",
    expect.any(Array),
  );
});

test("Details explains known actions and lists resources without saved patterns", () => {
  render(
    <PermissionRequestCard
      request={{
        action: editRequest.action,
        id: editRequest.id,
        resources: editRequest.resources,
        sessionID: editRequest.sessionID,
      }}
      replying={false}
      error={false}
      onReply={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText("Requested resources")).toBeOnTheScreen();
  expect(screen.getByText("OpenCode Mobile explanation")).toBeOnTheScreen();
  expect(
    screen.getByText("Change project files. Edit, write, and patch use this permission."),
  ).toBeOnTheScreen();
  expect(screen.queryByLabelText("Saved permission patterns")).toBeNull();
  expect(
    screen.queryByText(
      "Always allow saves the displayed patterns, which can cover more than this request.",
    ),
  ).toBeNull();
});

test("custom tools without resources show no preview or explanation", () => {
  render(
    <PermissionRequestCard
      request={{ ...request, action: "mobile-approval-ui-test", resources: [], save: [] }}
      replying={false}
      error={false}
      onReply={jest.fn()}
    />,
  );
  expect(screen.getByText("Call tool mobile-approval-ui-test")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Show full command" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText("Requested resources")).toBeOnTheScreen();
  expect(screen.queryByText("OpenCode Mobile explanation")).toBeNull();
});
