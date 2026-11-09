import Feather from "@expo/vector-icons/Feather";
import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { MenuGroup, MenuRow } from "./menu-row";

test("compact menu rows keep full touch targets and readable uncapped labels", () => {
  const press = jest.fn();
  render(
    <MenuGroup>
      <MenuRow icon="edit-2" label="Rename" onPress={press} />
      <MenuRow icon="trash-2" label="Delete" danger disabled last onPress={press} />
    </MenuGroup>,
  );
  const rename = screen.getByRole("button", { name: "Rename" });
  expect(rename).toHaveStyle({ minHeight: 52 });
  expect(screen.getByText("Rename")).toHaveStyle({ fontSize: 17, lineHeight: 22 });
  expect(StyleSheet.flatten(screen.getByText("Rename").props.style).fontWeight).toBeUndefined();
  expect(screen.getByText("Rename").props.numberOfLines).toBeUndefined();
  fireEvent.press(rename);
  fireEvent.press(screen.getByRole("button", { name: "Delete" }));
  expect(press).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete" })).toHaveStyle({ opacity: 0.5 });
});

test("row descriptions use footnote text", () => {
  render(
    <MenuGroup>
      <MenuRow
        icon="info"
        label="About"
        description="Version and licenses"
        last
        onPress={() => {}}
      />
    </MenuGroup>,
  );
  expect(screen.getByText("Version and licenses")).toHaveStyle({ fontSize: 13, lineHeight: 18 });
  expect(screen.getByRole("button", { name: "About" })).toHaveStyle({ minHeight: 52 });
});

test("expandable rows report state and swap the chevron direction", () => {
  const view = render(
    <MenuGroup>
      <MenuRow icon="activity" label="Advanced" expanded={false} last onPress={() => {}} />
    </MenuGroup>,
  );
  const chevron = () =>
    screen.UNSAFE_getAllByType(Feather).map((icon) => icon.props.name as string);
  expect(screen.getByRole("button", { name: "Advanced" })).toBeCollapsed();
  expect(chevron()).toEqual(["activity", "chevron-right"]);
  view.rerender(
    <MenuGroup>
      <MenuRow icon="activity" label="Advanced" expanded last onPress={() => {}} />
    </MenuGroup>,
  );
  expect(screen.getByRole("button", { name: "Advanced" })).toBeExpanded();
  expect(chevron()).toEqual(["activity", "chevron-down"]);
});

test("plain rows keep the forward chevron and no expanded state", () => {
  render(<MenuRow icon="info" label="About" onPress={() => {}} />);
  expect(screen.getByRole("button", { name: "About" })).toHaveProp("accessibilityState", {
    disabled: false,
  });
  expect(screen.UNSAFE_getAllByType(Feather)[1]?.props.name).toBe("chevron-right");
});

test("a badge shows a short count and screen readers hear the value instead", () => {
  render(
    <MenuRow
      accessibilityValue="3 requests need you, up to date"
      badge="3"
      icon="inbox"
      label="Needs you"
      onPress={() => {}}
    />,
  );
  const row = screen.getByRole("button", { name: "Needs you" });
  expect(row).toHaveProp("accessibilityValue", { text: "3 requests need you, up to date" });
  expect(screen.getByText("3")).toHaveStyle({ fontSize: 13 });
});

test("a visible value is also the row's accessibility value", () => {
  render(
    <MenuGroup>
      <MenuRow icon="server" label="Connections" last onPress={() => {}} value="Studio Mac" />
    </MenuGroup>,
  );
  expect(screen.getByRole("button", { name: "Connections" })).toHaveProp("accessibilityValue", {
    text: "Studio Mac",
  });
});
