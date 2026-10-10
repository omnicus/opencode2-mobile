import type { ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { palette, radius, space, typography, usesLargeTextLayout } from "../theme";

export function SettingsGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={managementStyles.section}>
      <Text accessibilityRole="header" style={managementStyles.sectionTitle}>
        {title}
      </Text>
      <View style={managementStyles.group}>{children}</View>
    </View>
  );
}

export function SettingsRow({ children }: { children: ReactNode }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View
      style={[
        managementStyles.row,
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
  description: { ...typography.caption, color: palette.dim },
  section: { gap: space.xs },
  sectionTitle: { ...typography.label, color: palette.dim },
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
    gap: space.sm,
    minHeight: 48,
    padding: space.sm,
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLargeText: { alignItems: "stretch", flexDirection: "column" },
});
