import Feather from "@expo/vector-icons/Feather";
import { Keyboard, Platform, Pressable, StyleSheet, View } from "react-native";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { minTouchTarget, palette, radius } from "../theme";
import { attentionAccessibilityValue } from "./attention-labels";

const ripple = Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)" } : undefined;

type HeaderDestination = "Connections" | "FollowedProjects" | "Pending" | "Settings";

export function WorkspaceHeaderActions({
  navigate,
  onNewSession,
  floating = false,
}: {
  navigate: (destination: HeaderDestination) => void;
  onNewSession?: (() => void) | undefined;
  floating?: boolean;
}) {
  const selection = useWorkspaceSelection();
  const count = selection.pendingCount;
  const coverage = selection.attentionCoverage.completeness;
  const freshness = selection.attentionCoverage.freshness;

  return (
    <View style={[styles.actions, floating && styles.floating]}>
      {onNewSession ? <NewSessionButton onPress={onNewSession} /> : null}
      <Pressable
        accessibilityHint="Opens requests that need you, followed projects, connections, and device settings"
        accessibilityLabel="Settings"
        accessibilityValue={{
          text: attentionAccessibilityValue(count, selection.attentionCoverage),
        }}
        accessibilityRole="button"
        onPress={() => {
          Keyboard.dismiss();
          navigate("Settings");
        }}
        android_ripple={ripple}
        style={({ pressed }) => [
          styles.optionsButton,
          pressed && Platform.OS === "ios" && styles.optionsButtonPressed,
        ]}
      >
        <Feather
          accessibilityElementsHidden
          color={palette.signal}
          importantForAccessibility="no-hide-descendants"
          name="settings"
          size={20}
        />
        {count > 0 || freshness !== "current" || coverage === "incomplete" ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID="workspace-attention-indicator"
            style={[styles.attentionDot, count === 0 && styles.attentionDotUncertain]}
          />
        ) : null}
      </Pressable>
    </View>
  );
}

export function NewSessionButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityHint="Choose a project for a new session"
      accessibilityLabel="New session"
      accessibilityRole="button"
      onPress={() => {
        Keyboard.dismiss();
        onPress();
      }}
      android_ripple={ripple}
      style={({ pressed }) => [
        styles.optionsButton,
        pressed && Platform.OS === "ios" && styles.optionsButtonPressed,
      ]}
    >
      <Feather
        accessibilityElementsHidden
        color={palette.ink}
        importantForAccessibility="no-hide-descendants"
        name="edit"
        size={24}
      />
    </Pressable>
  );
}

export function SessionAttentionMarker() {
  const selection = useWorkspaceSelection();
  const count = selection.pendingCount;
  const { freshness, completeness } = selection.attentionCoverage;
  if (count === 0 && freshness === "current" && completeness === "complete") return null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="session-attention-marker"
      style={[styles.attentionDot, count === 0 && styles.attentionDotUncertain]}
    />
  );
}

const styles = StyleSheet.create({
  floating: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.2)",
  },
  attentionDot: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.warm,
  },
  attentionDotUncertain: { backgroundColor: palette.dim },
  actions: {
    alignItems: "center",
    flexDirection: "row",
  },
  optionsButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: minTouchTarget,
    justifyContent: "center",
    overflow: "hidden",
    width: minTouchTarget,
  },
  optionsButtonPressed: { backgroundColor: palette.card },
});
