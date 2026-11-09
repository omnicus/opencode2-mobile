import { StyleSheet, Text, View } from "react-native";

import { palette, typeRamp, typography } from "../theme";

// The session title with its project underneath, centered in the header.
export function SessionHeaderTitle({
  subtitle,
  title,
}: {
  subtitle?: string | undefined;
  title: string;
}) {
  return (
    <View style={styles.title} testID="session-header-title">
      <Text
        accessibilityRole="header"
        dynamicTypeRamp={typeRamp.navTitle}
        numberOfLines={1}
        style={styles.name}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text dynamicTypeRamp={typeRamp.footnote} numberOfLines={1} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  name: { ...typography.navTitle, color: palette.ink, textAlign: "center" },
  subtitle: { ...typography.footnote, color: palette.dim, textAlign: "center" },
  title: { alignItems: "center", flexShrink: 1, minWidth: 0 },
});
