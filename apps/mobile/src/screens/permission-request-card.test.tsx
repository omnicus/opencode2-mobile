import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { palette, radius, space, typography } from "../theme";
import { PermissionRequestCard } from "./permission-request-card";

const command = `python3 - <<'PY'\n${"print('review me')\n".repeat(100)}PY`;
const request = {
  action: "shell",
  id: "per_approval",
  sessionID: "ses_owner",
  resources: [command],
  save: ["python3 *"],
};

test("permission messages use neutral headings and shared error typography", () => {
  render(<PermissionRequestCard request={request} replying={false} error onReply={jest.fn()} />);
  expect(screen.getByText("Permission required")).toHaveStyle({
    ...typography.heading,
    color: palette.ink,
  });
  expect(screen.getByRole("alert")).toHaveStyle({
    ...typography.body,
    color: palette.danger,
  });
});

test("shell requests show a short preview and preserve full commands and scope in Details", () => {
  const reply = jest.fn();
  render(
    <PermissionRequestCard request={request} replying={false} error={false} onReply={reply} />,
  );
  expect(screen.getByText("Run shell command")).toBeOnTheScreen();
  expect(screen.queryByText(command)).toBeNull();
  expect(screen.queryByText("python3 *")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Always allow" }));
  expect(reply).toHaveBeenCalledWith("per_approval", "ses_owner", "always");
  fireEvent.press(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText(command)).toBeOnTheScreen();
  expect(screen.getByText("python3 *")).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Always allow saves the displayed patterns, which can cover more than this request.",
    ),
  ).toBeOnTheScreen();
});

test("custom tool permissions use desktop wording and keep raw resources in Details", () => {
  render(
    <PermissionRequestCard
      request={{ ...request, action: "mobile-approval-ui-test" }}
      replying={false}
      error={false}
      onReply={jest.fn()}
    />,
  );
  expect(screen.getByText("Permission required")).toBeOnTheScreen();
  expect(screen.getByText("Call tool mobile-approval-ui-test")).toBeOnTheScreen();
  expect(screen.queryByText(/python3/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText(command)).toBeOnTheScreen();
});

test("pending replies disable every choice and errors give a retry path", () => {
  const view = render(
    <PermissionRequestCard request={request} replying error={false} onReply={jest.fn()} />,
  );
  for (const name of ["Allow once", "Always allow", "Reject"])
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

test("compact approval actions retain all three reply values", () => {
  const reply = jest.fn();
  render(
    <PermissionRequestCard request={request} replying={false} error={false} onReply={reply} />,
  );
  for (const [name, value] of [
    ["Allow once", "once"],
    ["Always allow", "always"],
    ["Reject", "reject"],
  ] as const) {
    const button = screen.getByRole("button", { name });
    expect(button).toHaveStyle({
      minHeight: 44,
      borderRadius: radius.sm,
      paddingHorizontal: space.sm,
    });
    expect(button).not.toHaveStyle({ flexGrow: 1 });
    fireEvent.press(button);
    expect(reply).toHaveBeenLastCalledWith(request.id, request.sessionID, value);
  }
});
