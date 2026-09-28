import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

import { CopyTextButton } from "./copy-text-button";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

beforeEach(() => {
  jest.mocked(Clipboard.setStringAsync).mockReset().mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

test("restores the copy label two seconds after a successful copy", async () => {
  jest.useFakeTimers();
  render(<CopyTextButton text="example" label="Copy code" />);
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Copy code" })));
  expect(screen.getByText("Copied")).toBeOnTheScreen();
  act(() => jest.advanceTimersByTime(1_999));
  expect(screen.getByText("Copied")).toBeOnTheScreen();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByText("Copied")).toBeNull();
  expect(screen.getByText("Copy code")).toBeOnTheScreen();
});

test("copies exact text and reports a failed write without claiming success", async () => {
  jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false);
  render(<CopyTextButton text={"  first\n\nsecond\n"} />);
  fireEvent.press(screen.getByRole("button", { name: "Copy text" }));
  await screen.findByText("Retry copy");
  expect(screen.queryByText("Copied")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Copy text" }));
  await screen.findByText("Copied");
  expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith("  first\n\nsecond\n");
});
