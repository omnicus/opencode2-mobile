import { Platform, StyleSheet, Text, View } from "react-native";

import { palette, typeRamp, typography } from "../theme";

// Child sessions are titled "Task (@agent subagent)"; the subtitle already says Subagent, so
// the header keeps only the task.
export function headerSessionTitle(title: string | undefined) {
  const task = title?.replace(/\s*\(@[\w.-]+ subagent\)\s*$/, "").trim();
  return task || title?.trim() || "Untitled session";
}

// The session title with its project underneath. iOS centers header titles; Android's native
// header puts them at the leading edge, so both lines follow the platform.
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

const centered = Platform.OS === "ios";

const styles = StyleSheet.create({
  name: { ...typography.navTitle, color: palette.ink, textAlign: centered ? "center" : "left" },
  subtitle: {
    ...typography.footnote,
    color: palette.dim,
    textAlign: centered ? "center" : "left",
  },
  title: { alignItems: centered ? "center" : "flex-start", flexShrink: 1, minWidth: 0 },
});
