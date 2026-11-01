import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions, Text } from "react-native";

import { ModalSheet } from "./modal-sheet";

const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

beforeEach(() => {
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 } });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

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
