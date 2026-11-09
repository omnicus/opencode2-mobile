import { afterEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ActivityIndicator, Platform, View } from "react-native";

import { palette } from "../theme";
import { Button } from "./button";

afterEach(() => {
  jest.restoreAllMocks();
});

test("secondary buttons keep a full touch target and shared control text", () => {
  const press = jest.fn();
  render(<Button label="Test connection" onPress={press} />);
  const button = screen.getByRole("button", { name: "Test connection" });
  expect(button).toHaveStyle({
    minHeight: 48,
    backgroundColor: palette.selected,
    borderRadius: 999,
    paddingHorizontal: 16,
    alignSelf: "flex-start",
  });
  expect(button).not.toHaveStyle({ borderWidth: 1 });
  expect(screen.getByText("Test connection")).toHaveStyle({
    fontSize: 14,
    fontWeight: "600",
    color: palette.ink,
    textAlign: "center",
  });
  expect(screen.getByText("Test connection")).toHaveProp("dynamicTypeRamp", "footnote");
  expect(button.props.nativeBackgroundAndroid).toBeUndefined();
  fireEvent.press(button);
  expect(press).toHaveBeenCalledTimes(1);
});

test("variants change fill and label color; compact keeps the touch target", () => {
  render(
    <View>
      <Button label="Save" variant="primary" fullWidth onPress={() => {}} />
      <Button label="Delete" variant="danger" onPress={() => {}} />
      <Button label="Learn more" variant="text" size="compact" onPress={() => {}} />
    </View>,
  );
  expect(screen.getByRole("button", { name: "Save" })).toHaveStyle({
    backgroundColor: palette.signal,
    alignSelf: "stretch",
  });
  expect(screen.getByText("Save")).toHaveStyle({ color: palette.background });
  expect(screen.getByText("Delete")).toHaveStyle({ color: palette.danger });
  expect(screen.getByRole("button", { name: "Delete" })).toHaveStyle({
    backgroundColor: palette.dangerFill,
  });
  const text = screen.getByRole("button", { name: "Learn more" });
  expect(text).toHaveStyle({ minHeight: 48, minWidth: 48, paddingHorizontal: 0 });
  expect(text).toHaveProp("hitSlop", { left: 10, right: 10 });
  expect(text).not.toHaveStyle({ borderWidth: 1 });
  expect(screen.getByText("Learn more")).toHaveStyle({ color: palette.signal });
  expect(screen.getByRole("button", { name: "Delete" })).not.toHaveProp("hitSlop");
});

test("align positions the button and style adds layout overrides", () => {
  render(
    <View>
      <Button label="Center" align="center" onPress={() => {}} />
      <Button
        label="Stretch"
        align="stretch"
        style={{ marginTop: 8, flexGrow: 1 }}
        onPress={() => {}}
      />
    </View>,
  );
  expect(screen.getByRole("button", { name: "Center" })).toHaveStyle({ alignSelf: "center" });
  expect(screen.getByRole("button", { name: "Stretch" })).toHaveStyle({
    alignSelf: "stretch",
    marginTop: 8,
    flexGrow: 1,
    minHeight: 48,
  });
});

test("busy and disabled buttons dim, report state, and ignore presses", () => {
  const press = jest.fn();
  render(
    <View>
      <Button label="Connect" busy onPress={press} />
      <Button label="Retry" disabled accessibilityHint="Tries again" onPress={press} />
    </View>,
  );
  const busy = screen.getByRole("button", { name: "Connect" });
  expect(busy).toBeBusy();
  expect(busy).toBeDisabled();
  expect(busy).toHaveStyle({ opacity: 0.5 });
  expect(screen.UNSAFE_getByType(ActivityIndicator).props.color).toBe(palette.ink);
  const disabled = screen.getByRole("button", { name: "Retry" });
  expect(disabled).toBeDisabled();
  expect(disabled).toHaveProp("accessibilityHint", "Tries again");
  fireEvent.press(busy);
  fireEvent.press(disabled);
  expect(press).not.toHaveBeenCalled();
});

test("Android uses a ripple, borderless only for text buttons", () => {
  jest.replaceProperty(Platform, "OS", "android");
  render(
    <View>
      <Button label="Open" icon="external-link" accessibilityLabel="Open link" onPress={() => {}} />
      <Button label="Skip" variant="text" onPress={() => {}} />
    </View>,
  );
  expect(
    screen.getByRole("button", { name: "Open link" }).props.nativeBackgroundAndroid,
  ).toMatchObject({ type: "RippleAndroid", borderless: false });
  expect(screen.getByRole("button", { name: "Skip" }).props.nativeBackgroundAndroid).toMatchObject({
    type: "RippleAndroid",
    borderless: true,
  });
});
