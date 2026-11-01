import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";

import { palette } from "../theme";
import { SegmentedControl } from "./segmented-control";

const options = [
  { value: "all", label: "All" },
  { value: "active", label: "Active", accessibilityLabel: "Active sessions" },
] as const;

const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

function setFontScale(fontScale: number) {
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale } });
}

beforeEach(() => setFontScale(1));

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

test("radio segments report the checked option and change on press", () => {
  const change = jest.fn();
  render(
    <SegmentedControl
      accessibilityLabel="Session filter"
      options={options}
      value="all"
      onChange={change}
    />,
  );
  expect(screen.getByLabelText("Session filter")).toHaveStyle({
    backgroundColor: palette.card,
    borderRadius: 10,
    padding: 3,
    flexDirection: "row",
  });
  const all = screen.getByRole("radio", { name: "All" });
  expect(all).toBeChecked();
  expect(screen.getByRole("radio", { name: "Active sessions" })).not.toBeChecked();
  expect(all).toHaveStyle({ minHeight: 48, backgroundColor: palette.prompt });
  expect(screen.getByText("All")).toHaveStyle({ color: palette.ink, fontSize: 14 });
  expect(screen.getByText("Active")).toHaveStyle({ color: palette.dim });
  fireEvent.press(screen.getByRole("radio", { name: "Active sessions" }));
  expect(change).toHaveBeenCalledWith("active");
});

test("compact tabs report selection and extend their hit area", () => {
  render(
    <SegmentedControl
      accessibilityLabel="Views"
      options={options}
      value="active"
      role="tablist"
      size="compact"
      onChange={() => {}}
    />,
  );
  expect(screen.getByLabelText("Views")).toHaveStyle({ borderRadius: 9, padding: 2 });
  const active = screen.getByRole("tab", { name: "Active sessions" });
  expect(active).toBeSelected();
  expect(screen.getByRole("tab", { name: "All" })).not.toBeSelected();
  expect(active).toHaveStyle({ minHeight: 32, paddingHorizontal: 14 });
  expect(active).toHaveProp("hitSlop", { top: 8, bottom: 8 });
});

test("large text stacks segments vertically", () => {
  setFontScale(1.5);
  render(
    <SegmentedControl
      accessibilityLabel="Filter"
      options={options}
      value="all"
      onChange={() => {}}
    />,
  );
  expect(screen.getByLabelText("Filter")).toHaveStyle({
    flexDirection: "column",
  });
  expect(screen.getByRole("radio", { name: "All" })).toHaveStyle({ flex: 0 });
});

test("a card surface uses the page color for the track", () => {
  render(
    <SegmentedControl
      accessibilityLabel="Authentication"
      options={options}
      value="all"
      surface="card"
      onChange={() => {}}
    />,
  );
  expect(screen.getByLabelText("Authentication")).toHaveStyle({
    backgroundColor: palette.background,
  });
});

test("disabled segments ignore presses and report the state", () => {
  const change = jest.fn();
  render(
    <SegmentedControl
      accessibilityLabel="Delivery"
      options={options}
      value="all"
      disabled
      onChange={change}
    />,
  );
  const active = screen.getByRole("radio", { name: "Active sessions" });
  expect(active).toBeDisabled();
  fireEvent.press(active);
  expect(change).not.toHaveBeenCalled();
});
