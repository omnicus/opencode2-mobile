import type { ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";

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
});
