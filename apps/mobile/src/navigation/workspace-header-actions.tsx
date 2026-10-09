import Feather from "@expo/vector-icons/Feather";
import { useState } from "react";
import { Keyboard, Pressable, StyleSheet, View } from "react-native";
import { MenuGroup, MenuRow } from "../components/menu-row";
import { ModalSheet } from "../components/modal-sheet";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { palette } from "../theme";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const count = selection.pendingCount;
  const coverage = selection.attentionCoverage.completeness;
  const freshness = selection.attentionCoverage.freshness;
  const visualCount = count > 99 ? "99+" : `${count}`;
  const needsYouMenuLabel =
    count > 0
      ? `Needs you, ${visualCount}`
      : freshness === "reconciling"
        ? "Needs you, syncing"
        : coverage === "incomplete"
          ? "Needs you, coverage incomplete"
          : "Needs you";

  function open(destination: HeaderDestination) {
    setMenuOpen(false);
    Keyboard.dismiss();
    navigate(destination);
  }

  return (
    <View style={[styles.actions, floating && styles.floating]}>
      {onNewSession ? <NewSessionButton onPress={onNewSession} /> : null}
      <Pressable
        accessibilityHint="Opens workspace options and pending requests"
        accessibilityLabel="Workspace options"
        accessibilityValue={{
          text: `${count} known ${count === 1 ? "request" : "requests"}, ${freshness}${coverage === "incomplete" ? ", coverage incomplete" : ""}`,
        }}
        accessibilityRole="button"
        onPress={() => {
          Keyboard.dismiss();
          setMenuOpen(true);
        }}
        style={({ pressed }) => [styles.optionsButton, pressed && styles.optionsButtonPressed]}
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
      <ModalSheet
        onClose={() => setMenuOpen(false)}
        subtitle="Project, connection, and device settings"
        title="Workspace options"
        visible={menuOpen}
        size="compact"
        closeLabel="Close"
      >
        <MenuGroup>
          <MenuRow
            icon="inbox"
            description="Permission and form requests"
            label={needsYouMenuLabel}
            onPress={() => open("Pending")}
          />
          <MenuRow
            icon="folder"
            description="Choose projects shown in Sessions"
            label="Followed projects"
            onPress={() => open("FollowedProjects")}
          />
          <MenuRow
            icon="server"
            description="Switch or edit OpenCode servers"
            label="Connections"
            onPress={() => open("Connections")}
          />
          <MenuRow
            icon="settings"
            description="Device security and diagnostics"
            label="Settings"
            last
            onPress={() => open("Settings")}
          />
        </MenuGroup>
      </ModalSheet>
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
      style={({ pressed }) => [styles.optionsButton, pressed && styles.optionsButtonPressed]}
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
    borderRadius: 24,
    width: 48,
    height: 48,
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
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  optionsButtonPressed: { backgroundColor: palette.card },
});
