import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { Text } from "react-native";

import { RootErrorBoundary } from "./root-error-boundary";

let mockShouldThrow = true;

function Fragile() {
  const [renders] = useState(() => 1);
  if (mockShouldThrow) throw new Error("private render detail");
  return <Text>Recovered {renders}</Text>;
}

test("explains a render failure in plain words and recovers on retry", () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  render(
    <RootErrorBoundary>
      <Fragile />
    </RootErrorBoundary>,
  );

  expect(screen.getByRole("header", { name: "Something went wrong." })).toBeOnTheScreen();
  expect(screen.queryByText(/native shell/)).toBeNull();
  expect(screen.queryByText(/private render detail/)).toBeNull();

  mockShouldThrow = false;
  fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("Recovered 1")).toBeOnTheScreen();
  consoleError.mockRestore();
});
