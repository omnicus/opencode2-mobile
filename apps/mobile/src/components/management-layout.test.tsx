import { expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { SettingsGroup, SettingsRow } from "./management-layout";

test.each([1, 1.5])(
  "settings rows adapt to font scale %s without reducing touch targets",
  (fontScale) => {
    const originalWindow = Dimensions.get("window");
    const originalScreen = Dimensions.get("screen");
    Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale } });
    const view = render(
      <SettingsGroup title="Transcript">
        <SettingsRow>
          <Text>Detailed transcript</Text>
        </SettingsRow>
      </SettingsGroup>,
    );
    expect(screen.getByRole("header", { name: "Transcript" })).toBeOnTheScreen();
    const row = screen.UNSAFE_getByType(SettingsRow).findByType(View);
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({
      minHeight: 48,
      flexDirection: fontScale >= 1.3 ? "column" : "row",
      alignItems: fontScale >= 1.3 ? "stretch" : "center",
    });
    view.unmount();
    Dimensions.set({ window: originalWindow, screen: originalScreen });
  },
);
