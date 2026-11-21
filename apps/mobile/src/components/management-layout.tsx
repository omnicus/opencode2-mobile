import type { ReactNode } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { palette, radius, space, typeRamp, typography, usesLargeTextLayout } from "../theme";

export function SettingsGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={managementStyles.section}>
      <Text
        accessibilityRole="header"
        dynamicTypeRamp={typeRamp.sectionLabel}
        style={managementStyles.sectionTitle}
      >
        {title}
      </Text>
      <View style={managementStyles.group}>{children}</View>
    </View>
  );
}

export function SettingsRow({ children, last = false }: { children: ReactNode; last?: boolean }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View
      style={[
        managementStyles.row,
        !last && managementStyles.separator,
        usesLargeTextLayout(fontScale) && managementStyles.rowLargeText,
      ]}
    >
      {children}
    </View>
  );
}

// A setting's title and explanation. They form one screen reader stop, so a row is read as
// "title, explanation" before its control instead of as two separate text elements.
// On Android, `accessible` also makes a view keyboard focusable, which would add a Tab stop
// for static text; screenReaderFocusable groups it for TalkBack only. TalkBack grouping is not
// yet device-verified below API 28.
export function SettingText({
  description,
  live = false,
  title,
}: {
  description: string;
  // Announces description changes on Android, for status that updates in place.
  live?: boolean;
  title: string;
}) {
  return (
    <View
      accessible={Platform.OS !== "android"}
      // The period gives screen readers a pause between the title and its explanation.
      accessibilityLabel={`${title}. ${description}`}
      accessibilityLiveRegion={live ? "polite" : undefined}
      screenReaderFocusable
      style={managementStyles.settingLabel}
    >
      <Text dynamicTypeRamp={typeRamp.body} style={managementStyles.settingTitle}>
        {title}
      </Text>
      <Text dynamicTypeRamp={typeRamp.footnote} style={managementStyles.settingCopy}>
        {description}
      </Text>
    </View>
  );
}

export const managementStyles = StyleSheet.create({
  content: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 680,
    padding: space.md,
    paddingBottom: space.xl,
    gap: space.md,
  },
  description: { ...typography.footnote, color: palette.dim },
  section: { gap: space.xs },
  sectionTitle: { ...typography.sectionLabel, color: palette.dim, paddingHorizontal: space.md },
  group: {
    backgroundColor: palette.card,
    borderRadius: radius.md,
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  separator: { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLargeText: { alignItems: "stretch", flexDirection: "column" },
  // The text column beside a row's icon tile; inline actions sit under the text in it.
  settingText: { flexGrow: 1, flexShrink: 1 },
  settingLabel: { gap: 2 },
  settingTitle: { ...typography.body, color: palette.ink },
  settingCopy: { ...typography.footnote, color: palette.dim },
  inlineAction: { marginTop: space.sm },
});
