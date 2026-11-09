import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { palette, space, typeRamp, typography } from "../theme";

// The shared layout for screens that replace the whole app: app lock, startup storage
// failure, and the render error boundary. It scrolls, so the action stays reachable at the
// largest text sizes and in landscape.
export function FullScreenState({
  children,
  copy,
  eyebrow,
  tone = "neutral",
  title,
}: {
  children?: ReactNode;
  copy?: string | undefined;
  eyebrow: string;
  tone?: "neutral" | "danger";
  title: string;
}) {
  return (
    <SafeAreaView style={styles.shell}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Text
            dynamicTypeRamp={typeRamp.sectionLabel}
            style={[styles.eyebrow, tone === "danger" && styles.eyebrowDanger]}
          >
            {eyebrow}
          </Text>
          <Text
            accessibilityRole="header"
            dynamicTypeRamp={typeRamp.largeTitle}
            style={styles.title}
          >
            {title}
          </Text>
          {copy ? (
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
              {copy}
            </Text>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Body text placed between the copy and the actions, such as an error message.
export function FullScreenStateError({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
      {children}
    </Text>
  );
}

export const fullScreenStateStyles = StyleSheet.create({
  actions: { alignItems: "flex-start", gap: space.sm, marginTop: space.lg },
});

const styles = StyleSheet.create({
  content: { alignSelf: "center", maxWidth: 480, width: "100%" },
  copy: { ...typography.subheadline, color: palette.dim, marginTop: space.sm },
  error: { ...typography.subheadline, color: palette.danger, marginTop: space.md },
  eyebrow: { ...typography.sectionLabel, color: palette.dim },
  eyebrowDanger: { color: palette.danger },
  scroll: { flexGrow: 1, justifyContent: "center", padding: space.lg },
  shell: { backgroundColor: palette.background, flex: 1 },
  title: { ...typography.largeTitle, color: palette.ink, marginTop: space.sm },
});
