import { expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Dimensions, Platform, StyleSheet, Text, View } from "react-native";
import { SettingsGroup, SettingsRow, SettingText } from "./management-layout";

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
    expect(screen.getByRole("header", { name: "Transcript" })).toHaveStyle({
      fontSize: 13,
      fontWeight: "600",
      paddingHorizontal: 16,
    });
    const row = screen.UNSAFE_getByType(SettingsRow).findByType(View);
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({
      minHeight: 52,
      paddingHorizontal: 16,
      flexDirection: fontScale >= 1.3 ? "column" : "row",
      alignItems: fontScale >= 1.3 ? "stretch" : "center",
    });
    view.unmount();
    Dimensions.set({ window: originalWindow, screen: originalScreen });
  },
);

test("the last settings row drops its separator", () => {
  render(
    <SettingsGroup title="Security">
      <SettingsRow>
        <Text>First</Text>
      </SettingsRow>
      <SettingsRow last>
        <Text>Last</Text>
      </SettingsRow>
    </SettingsGroup>,
  );
  const [first, last] = screen
    .UNSAFE_getAllByType(SettingsRow)
    .map((row) => StyleSheet.flatten(row.findByType(View).props.style));
  expect(first).toMatchObject({ borderBottomWidth: StyleSheet.hairlineWidth });
  expect(last?.borderBottomWidth).toBeUndefined();
});

test.each<["ios" | "android", boolean]>([
  ["ios", true],
  ["android", false],
])("on %s a setting's text sets platform-specific focus props", (os, accessible) => {
  jest.replaceProperty(Platform, "OS", os);
  try {
    render(<SettingText description="Display model reasoning." title="Show reasoning" />);
    // Android maps accessible to keyboard focus, so static text uses screenReaderFocusable.
    const label = screen.UNSAFE_getByType(SettingText).findByType(View);
    expect(label.props.accessible).toBe(accessible);
    expect(label.props.screenReaderFocusable).toBe(true);
    expect(label.props.accessibilityLabel).toBe("Show reasoning. Display model reasoning.");
  } finally {
    jest.restoreAllMocks();
  }
});
