import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { createRef } from "react";
import type { TextInput } from "react-native";

import { palette } from "../theme";
import { SearchField } from "./search-field";

test("search input uses body text and only offers clear once there is a query", () => {
  const change = jest.fn();
  const view = render(<SearchField value="" placeholder="Search sessions" onChangeText={change} />);
  const input = screen.getByLabelText("Search sessions");
  expect(input).toHaveStyle({ fontSize: 17, lineHeight: 22, color: palette.ink });
  expect(input).toHaveProp("autoCapitalize", "none");
  expect(input).toHaveProp("autoCorrect", false);
  expect(input).toHaveProp("keyboardAppearance", "dark");
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.changeText(input, "deploy");
  expect(change).toHaveBeenCalledWith("deploy");

  view.rerender(
    <SearchField
      value="deploy"
      placeholder="Search sessions"
      clearAccessibilityLabel="Clear session search"
      onChangeText={change}
    />,
  );
  const clear = screen.getByRole("button", { name: "Clear session search" });
  expect(clear).toHaveStyle({ width: 48 });
  fireEvent.press(clear);
  expect(change).toHaveBeenLastCalledWith("");
});

test("forwards the ref and container style", () => {
  const ref = createRef<TextInput>();
  render(
    <SearchField
      ref={ref}
      value="x"
      accessibilityLabel="Search files"
      style={{ marginTop: 4 }}
      onChangeText={() => {}}
    />,
  );
  expect(ref.current).not.toBeNull();
  expect(screen.getByRole("button", { name: "Clear search" })).toBeOnTheScreen();
  expect(screen.getByLabelText("Search files").parent?.parent).toHaveStyle({
    marginTop: 4,
    minHeight: 48,
    borderRadius: 12,
  });
});

test("passes return key and submit handling to the input", () => {
  const submit = jest.fn();
  render(
    <SearchField
      value="deploy"
      placeholder="Search projects"
      returnKeyType="search"
      onSubmitEditing={submit}
      onChangeText={() => {}}
    />,
  );
  const input = screen.getByLabelText("Search projects");
  expect(input).toHaveProp("returnKeyType", "search");
  fireEvent(input, "submitEditing", { nativeEvent: { text: "deploy" } });
  expect(submit).toHaveBeenCalledTimes(1);
});
