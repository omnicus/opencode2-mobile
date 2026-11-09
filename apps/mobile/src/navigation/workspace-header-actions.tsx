import Feather from "@expo/vector-icons/Feather";
import { Keyboard, Platform, Pressable, StyleSheet, View } from "react-native";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { minTouchTarget, palette, radius, rippleFeedback } from "../theme";
import { attentionAccessibilityValue } from "./attention-labels";

const ripple = rippleFeedback.row;

type HeaderDestination = "Connections" | "FollowedProjects" | "Pending" | "Settings";

export function WorkspaceHeaderActions({
  navigate,
  onNewSession,
}: {
  navigate: (destination: HeaderDestination) => void;
  onNewSession?: (() => void) | undefined;
}) {
  const selection = useWorkspaceSelection();
  const count = selection.pendingCount;
  const coverage = selection.attentionCoverage.completeness;
  const freshness = selection.attentionCoverage.freshness;

  return (
    <View style={styles.actions}>
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
          color={palette.ink}
          importantForAccessibility="no-hide-descendants"
          name="settings"
          size={22}
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
        size={22}
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
