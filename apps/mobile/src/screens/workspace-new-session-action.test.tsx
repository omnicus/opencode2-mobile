import { expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Keyboard, type KeyboardEventName, Platform } from "react-native";
import { WorkspaceNewSessionAction } from "./workspace-new-session-action";

jest.mock("../state/workspace-selection-context", () => ({
  useWorkspaceSelection: () => ({
    pendingCount: 0,
    attentionCoverage: { freshness: "current", completeness: "complete" },
  }),
}));

test.each([
  ["ios", "keyboardWillShow", "keyboardWillHide"],
  ["android", "keyboardDidShow", "keyboardDidHide"],
] satisfies ["ios" | "android", KeyboardEventName, KeyboardEventName][])(
  "%s thumb action is available only when eligible and the keyboard is hidden",
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
    const onPress = jest.fn();
    const view = render(<WorkspaceNewSessionAction eligible onPress={onPress} />);
    try {
      fireEvent.press(screen.getByRole("button", { name: "New session" }));
      expect(onPress).toHaveBeenCalledTimes(1);
      act(show);
      expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
      act(hide);
      expect(screen.getByRole("button", { name: "New session" })).toBeOnTheScreen();
      view.rerender(<WorkspaceNewSessionAction eligible={false} onPress={onPress} />);
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

test("Settings gear sits at the left edge and New session at the right edge", () => {
  render(
    <WorkspaceNewSessionAction eligible showSettings onNavigate={jest.fn()} onPress={jest.fn()} />,
  );
  const [first, second] = screen.getAllByRole("button");
  expect(first).toHaveAccessibleName("Settings");
  expect(second).toHaveAccessibleName("New session");
  expect(second).toHaveStyle({ marginLeft: "auto" });
});

test("floating Settings gear remains available without an eligible new session pill", () => {
  const navigate = jest.fn();
  render(
    <WorkspaceNewSessionAction
      eligible={false}
      showSettings
      onNavigate={navigate}
      onPress={jest.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Settings" }));
  expect(navigate).toHaveBeenCalledWith("Settings");
});
