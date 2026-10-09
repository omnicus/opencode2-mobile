import { expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Keyboard } from "react-native";
import { WorkspaceNewSessionAction } from "./workspace-new-session-action";

test("thumb action is available only when eligible and the keyboard is hidden", () => {
  let show = () => {};
  let hide = () => {};
  const remove = jest.fn();
  const visible = jest.spyOn(Keyboard, "isVisible").mockReturnValue(false);
  const listeners = jest.spyOn(Keyboard, "addListener").mockImplementation((event, callback) => {
    if (event === "keyboardDidShow") show = () => callback({} as never);
    if (event === "keyboardDidHide") hide = () => callback({} as never);
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
  }
});
