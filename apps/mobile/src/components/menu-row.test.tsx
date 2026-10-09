import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
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
  expect(rename).toHaveStyle({ minHeight: 48 });
  expect(screen.getByText("Rename")).toHaveStyle({ fontSize: 15 });
  expect(screen.getByText("Rename").props.numberOfLines).toBeUndefined();
  fireEvent.press(rename);
  fireEvent.press(screen.getByRole("button", { name: "Delete" }));
  expect(press).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
});
