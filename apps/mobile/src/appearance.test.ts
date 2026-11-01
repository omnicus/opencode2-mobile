import { Appearance } from "react-native";

import { pinDarkAppearance } from "./appearance";

test("pins native chrome to the dark appearance", () => {
  const setColorScheme = jest.spyOn(Appearance, "setColorScheme").mockImplementation(jest.fn());
  pinDarkAppearance();
  expect(setColorScheme).toHaveBeenCalledWith("dark");
  setColorScheme.mockRestore();
});
