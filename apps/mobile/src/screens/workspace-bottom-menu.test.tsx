import { expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Keyboard, type KeyboardEventName, Platform } from "react-native";
import { WorkspaceBottomMenu } from "./workspace-bottom-menu";

let mockPendingCount = 0;
let mockFreshness = "current";
jest.mock("../state/workspace-selection-context", () => ({
  useWorkspaceSelection: () => ({
    pendingCount: mockPendingCount,
    attentionCoverage: { freshness: mockFreshness, completeness: "complete" },
  }),
}));

test.each([
  ["ios", "keyboardWillShow", "keyboardWillHide"],
  ["android", "keyboardDidShow", "keyboardDidHide"],
] satisfies ["ios" | "android", KeyboardEventName, KeyboardEventName][])(
  "%s menu hides while the keyboard is up and when the screen hides it",
  (os, showEvent, hideEvent) => {
    let show = () => {};
    let hide = () => {};
    const remove = jest.fn();
    const platformOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: os });
    const visible = jest.spyOn(Keyboard, "isVisible").mockReturnValue(false);
    const listeners = jest.spyOn(Keyboard, "addListener").mockImplementation((event, callback) => {
      if (event === showEvent) show = () => callback({} as never);
      if (event === hideEvent) hide = () => callback({} as never);
      return { remove } as unknown as ReturnType<typeof Keyboard.addListener>;
    });
    const props = { active: "chat" as const, onNewSession: jest.fn(), onSelect: jest.fn() };
    const view = render(<WorkspaceBottomMenu {...props} />);
    try {
      fireEvent.press(screen.getByRole("button", { name: "New session" }));
      expect(props.onNewSession).toHaveBeenCalledTimes(1);
      act(show);
      expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "Chat" })).toBeNull();
      act(hide);
      expect(screen.getByRole("tab", { name: "Chat" })).toBeOnTheScreen();
      view.rerender(<WorkspaceBottomMenu {...props} hidden />);
      expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
    } finally {
      view.unmount();
      expect(remove).toHaveBeenCalledTimes(2);
      listeners.mockRestore();
      visible.mockRestore();
      Object.defineProperty(Platform, "OS", { configurable: true, value: platformOS });
    }
  },
);

test("New session sits last, on the right, apart from the three tabs", () => {
  const onSelect = jest.fn();
  render(<WorkspaceBottomMenu active="pulls" onNewSession={jest.fn()} onSelect={onSelect} />);
  const order = screen
    .getAllByRole(/^(button|tab)$/)
    .map((element) => element.props.accessibilityLabel);
  expect(order).toEqual(["Chat", "PRs", "Approvals", "New session"]);
  expect(screen.getByRole("tab", { name: "PRs" })).toBeSelected();
  expect(screen.getByRole("tab", { name: "Chat" })).not.toBeSelected();
  fireEvent.press(screen.getByRole("tab", { name: "Approvals" }));
  expect(onSelect).toHaveBeenCalledWith("approvals");
});

test("Approvals shows the request count, or a dot while coverage is uncertain", () => {
  mockPendingCount = 3;
  const view = render(
    <WorkspaceBottomMenu active="chat" onNewSession={jest.fn()} onSelect={jest.fn()} />,
  );
  try {
    expect(screen.getByText("3", { includeHiddenElements: true })).toBeTruthy();
    mockPendingCount = 120;
    view.rerender(
      <WorkspaceBottomMenu active="chat" onNewSession={jest.fn()} onSelect={jest.fn()} />,
    );
    expect(screen.getByText("99+", { includeHiddenElements: true })).toBeTruthy();
    mockPendingCount = 0;
    mockFreshness = "stale";
    view.rerender(
      <WorkspaceBottomMenu active="chat" onNewSession={jest.fn()} onSelect={jest.fn()} />,
    );
    expect(
      screen.getByTestId("workspace-approvals-badge", { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.queryByText(/\d/, { includeHiddenElements: true })).toBeNull();
    mockFreshness = "current";
    view.rerender(
      <WorkspaceBottomMenu active="chat" onNewSession={jest.fn()} onSelect={jest.fn()} />,
    );
    expect(
      screen.queryByTestId("workspace-approvals-badge", { includeHiddenElements: true }),
    ).toBeNull();
  } finally {
    mockPendingCount = 0;
    mockFreshness = "current";
    view.unmount();
  }
});
