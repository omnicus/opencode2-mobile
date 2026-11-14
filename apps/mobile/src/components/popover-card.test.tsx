import { expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { RefObject } from "react";
import { Dimensions, Keyboard, Modal, StyleSheet, Text, type View } from "react-native";

import { space } from "../theme";
import { PopoverCard } from "./popover-card";

const mockInsets = { bottom: 0, left: 0, right: 0, top: 0 };
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => mockInsets }));

function anchorAt(position: { y: number }, height = 36) {
  return {
    current: {
      measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) =>
        callback(16, position.y, 120, height),
    },
  } as unknown as RefObject<View | null>;
}

function renderCard(
  anchorRef: RefObject<View | null>,
  props: Partial<Parameters<typeof PopoverCard>[0]> = {},
) {
  const onClose = jest.fn();
  render(
    <PopoverCard
      anchorRef={anchorRef}
      label="Background work"
      onClose={onClose}
      returnFocusRef={{ current: null }}
      visible
      {...props}
    >
      <Text>Row</Text>
    </PopoverCard>,
  );
  return { onClose };
}

const card = () => screen.getByTestId("popover-card");

test("pins the card's bottom edge to the bottom of the control it opens from", () => {
  const windowHeight = Dimensions.get("window").height;
  const { onClose } = renderCard(anchorAt({ y: windowHeight - 200 }));
  expect(card()).toHaveStyle({ bottom: 164 });
  fireEvent.press(screen.getByTestId("popover-backdrop", { includeHiddenElements: true }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("never grows taller than the space above it, and fills it for a self-sizing page", () => {
  const windowHeight = Dimensions.get("window").height;
  // An anchor near the top leaves little room: the card shrinks instead of a fixed minimum.
  renderCard(anchorAt({ y: 60 }), { fill: true, scrollable: false });
  const style = StyleSheet.flatten(card().props.style);
  expect(style.bottom).toBe(windowHeight - 96);
  expect(style.maxHeight).toBeLessThan(160);
  expect(style.height).toBe(style.maxHeight);
});

test("measures the control again when the window changes size or the keyboard moves", () => {
  const windowHeight = Dimensions.get("window").height;
  const position = { y: windowHeight - 200 };
  const listeners = new Map<string, () => void>();
  const addListener = jest.spyOn(Keyboard, "addListener").mockImplementation(((
    event: string,
    listener: () => void,
  ) => {
    listeners.set(event, listener);
    return { remove: jest.fn() };
  }) as never);
  const window = Dimensions.get("window");
  try {
    renderCard(anchorAt(position));
    expect(card()).toHaveStyle({ bottom: 164 });
    position.y = windowHeight - 300;
    act(() => {
      Dimensions.set({ window: { ...window, width: window.width + 1 } });
    });
    expect(card()).toHaveStyle({ bottom: 264 });
    position.y = windowHeight - 250;
    act(() => listeners.get("keyboardDidHide")?.());
    expect(card()).toHaveStyle({ bottom: 214 });
    // The card can fold the composer under its anchor as it opens; showing measures again.
    position.y = windowHeight - 220;
    act(() => screen.UNSAFE_getByType(Modal).props.onShow());
    expect(card()).toHaveStyle({ bottom: 184 });
  } finally {
    act(() => {
      Dimensions.set({ window });
    });
    addListener.mockRestore();
  }
});

test("the escape gesture uses the inner page's back before closing", () => {
  const onRequestClose = jest.fn();
  const { onClose } = renderCard(anchorAt({ y: 600 }), { onRequestClose });
  fireEvent(card(), "accessibilityEscape");
  expect(onRequestClose).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});

test("stays clear of a notch on one side instead of centering into it", () => {
  const window = Dimensions.get("window");
  mockInsets.right = 44;
  try {
    act(() => {
      Dimensions.set({ window: { ...window, width: 700 } });
    });
    renderCard(anchorAt({ y: 300 }));
    const style = StyleSheet.flatten(card().props.style);
    const rightMargin = 700 - Number(style.left) - Number(style.width);
    expect(rightMargin).toBeGreaterThanOrEqual(44 + space.sm);
    expect(Number(style.left)).toBeGreaterThanOrEqual(space.md);
  } finally {
    mockInsets.right = 0;
    act(() => {
      Dimensions.set({ window });
    });
  }
});
