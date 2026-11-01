import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { createRef } from "react";
import {
  AccessibilityInfo,
  Dimensions,
  type EmitterSubscription,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { pressedOpacity } from "../theme";
import { ModalSheet } from "./modal-sheet";
import { modalSheetLayout } from "./modal-sheet-model";

const ReactNative = jest.requireActual<typeof import("react-native")>("react-native");
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");
let reduceMotionListener: ((enabled: boolean) => void) | undefined;
const removeListener = jest.fn();

beforeEach(() => {
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 } });
  reduceMotionListener = undefined;
  removeListener.mockClear();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((
    _event: string,
    listener: (enabled: boolean) => void,
  ) => {
    reduceMotionListener = listener;
    return { remove: removeListener } as unknown as EmitterSubscription;
  }) as typeof AccessibilityInfo.addEventListener);
  jest.spyOn(AccessibilityInfo, "setAccessibilityFocus").mockImplementation(() => undefined);
  jest.spyOn(ReactNative, "findNodeHandle").mockImplementation((node) => (node ? 7 : null));
});

afterEach(() => {
  jest.restoreAllMocks();
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

function sheet(props: Partial<Parameters<typeof ModalSheet>[0]> = {}) {
  return (
    <ModalSheet title="Settings" visible onClose={() => undefined} {...props}>
      <Text>Sheet body</Text>
    </ModalSheet>
  );
}

test("tapping the backdrop closes a compact sheet", () => {
  const close = jest.fn();
  render(
    <ModalSheet onClose={close} size="compact" title="Session actions" visible>
      <Text>Rename</Text>
    </ModalSheet>,
  );
  fireEvent.press(screen.getByTestId("modal-sheet-backdrop", { includeHiddenElements: true }));
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole("button", { name: "Close Session actions" }));
  expect(close).toHaveBeenCalledTimes(2);
});

test("page sheets have no tappable backdrop", () => {
  render(
    <ModalSheet onClose={jest.fn()} title="Details" visible>
      <Text>Body</Text>
    </ModalSheet>,
  );
  expect(screen.queryByTestId("modal-sheet-backdrop", { includeHiddenElements: true })).toBeNull();
});

test("renders the title, optional subtitle, and a labelled close button", async () => {
  const onClose = jest.fn();
  const view = render(sheet({ subtitle: "Workspace", closeLabel: "Cancel", onClose }));
  await act(async () => undefined);
  expect(screen.getByRole("header", { name: "Settings" })).toBeOnTheScreen();
  expect(screen.getByText("Workspace")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Close Settings" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Cancel")).toBeOnTheScreen();
  view.rerender(sheet());
  expect(screen.queryByText("Workspace")).toBeNull();
  expect(screen.getByText("Done")).toBeOnTheScreen();
});

test("scrolls content by default and fixes it when not scrollable", async () => {
  const view = render(sheet());
  await act(async () => undefined);
  expect(view.UNSAFE_queryByType(ScrollView)).not.toBeNull();
  view.rerender(sheet({ scrollable: false }));
  expect(view.UNSAFE_queryByType(ScrollView)).toBeNull();
  expect(screen.getByText("Sheet body")).toBeOnTheScreen();
});

test("follows the reduce motion setting and unsubscribes on unmount", async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
  const view = render(sheet());
  await act(async () => undefined);
  expect(view.UNSAFE_getByType(Modal).props.animationType).toBe("none");
  act(() => reduceMotionListener?.(false));
  expect(view.UNSAFE_getByType(Modal).props.animationType).toBe("slide");
  view.unmount();
  expect(removeListener).toHaveBeenCalledTimes(1);
});

test("ignores reduce motion results after unmount and lookup failures", async () => {
  let resolve: ((enabled: boolean) => void) | undefined;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(
    new Promise<boolean>((done) => {
      resolve = done;
    }),
  );
  const view = render(sheet());
  view.unmount();
  await act(async () => resolve?.(true));
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRejectedValue(new Error("native"));
  const next = render(sheet());
  await act(async () => undefined);
  expect(next.UNSAFE_getByType(Modal).props.animationType).toBe("slide");
});

test("moves accessibility focus to the heading when shown", async () => {
  const view = render(sheet());
  await act(async () => undefined);
  act(() => view.UNSAFE_getByType(Modal).props.onShow());
  expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(7);
});

test("returns focus on dismiss only when a return target is mounted", async () => {
  const focus = jest.mocked(AccessibilityInfo.setAccessibilityFocus);
  const returnFocusRef = createRef<View>();
  const view = render(
    <>
      <View ref={returnFocusRef} />
      {sheet({ returnFocusRef })}
    </>,
  );
  await act(async () => undefined);
  focus.mockClear();
  act(() => view.UNSAFE_getByType(Modal).props.onDismiss());
  expect(focus).toHaveBeenCalledWith(7);
  view.rerender(sheet({ returnFocusRef: createRef<View>() }));
  focus.mockClear();
  act(() => view.UNSAFE_getByType(Modal).props.onDismiss());
  view.rerender(sheet());
  act(() => view.UNSAFE_getByType(Modal).props.onDismiss());
  expect(focus).not.toHaveBeenCalled();
});

test("returns focus after closing on Android but leaves iOS to the native dismissal", async () => {
  const frames: FrameRequestCallback[] = [];
  jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancel = jest.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);
  const returnFocusRef = createRef<View>();
  const tree = (visible: boolean) => (
    <>
      <View ref={returnFocusRef} />
      {sheet({ returnFocusRef, visible })}
    </>
  );
  jest.replaceProperty(Platform, "OS", "ios");
  const view = render(tree(true));
  await act(async () => undefined);
  view.rerender(tree(false));
  expect(frames).toHaveLength(0);
  jest.replaceProperty(Platform, "OS", "android");
  view.rerender(tree(true));
  view.rerender(tree(false));
  expect(frames).toHaveLength(1);
  jest.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear();
  act(() => frames[0]?.(0));
  expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(7);
  view.rerender(tree(true));
  expect(cancel).toHaveBeenCalledWith(1);
  view.unmount();
  const withoutTarget = render(sheet());
  withoutTarget.rerender(sheet({ visible: false }));
  expect(frames).toHaveLength(1);
});

test("uses Android keyboard behavior", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  const view = render(sheet());
  await act(async () => undefined);
  expect(view.UNSAFE_getByType(ScrollView).props.keyboardDismissMode).toBe("on-drag");
});

test("lays out page, full, and compact sheets for the window and text size", () => {
  expect(modalSheetLayout("page", false, 1000)).toEqual({
    compact: false,
    overlay: false,
    bottom: false,
    presentationStyle: "pageSheet",
  });
  expect(modalSheetLayout("full", false, 400)).toEqual({
    compact: false,
    overlay: false,
    bottom: false,
    presentationStyle: "fullScreen",
  });
  expect(modalSheetLayout("full", false, 700)).toEqual({
    compact: false,
    overlay: true,
    bottom: false,
    presentationStyle: "overFullScreen",
  });
  expect(modalSheetLayout("compact", false, 400)).toEqual({
    compact: true,
    overlay: true,
    bottom: true,
    presentationStyle: "overFullScreen",
  });
  expect(modalSheetLayout("compact", false, 800).bottom).toBe(false);
  expect(modalSheetLayout("compact", true, 400)).toEqual({
    compact: false,
    overlay: false,
    bottom: false,
    presentationStyle: "fullScreen",
  });
});

test("the close button ripples on Android and dims when pressed on iOS", async () => {
  const closeButton = () =>
    screen.UNSAFE_root.findAll(
      (element: { props: Record<string, unknown> }) =>
        element.props.accessibilityLabel === "Close Settings" &&
        typeof element.props.style === "function",
    )[0];
  const opacity = (pressed: boolean) =>
    StyleSheet.flatten(closeButton()?.props.style({ pressed })).opacity;
  jest.replaceProperty(Platform, "OS", "android");
  const view = render(sheet());
  await act(async () => undefined);
  expect(closeButton()?.props.android_ripple).toEqual({
    color: "rgba(255,255,255,0.12)",
    borderless: true,
  });
  expect(opacity(true)).toBeUndefined();
  jest.replaceProperty(Platform, "OS", "ios");
  view.rerender(sheet());
  expect(closeButton()?.props.android_ripple).toBeUndefined();
  expect(opacity(true)).toBe(pressedOpacity);
  expect(opacity(false)).toBeUndefined();
});
