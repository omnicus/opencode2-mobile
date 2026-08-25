import Feather from "@expo/vector-icons/Feather";
import { useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";

import { ModalSheet } from "../components/modal-sheet";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { palette, radius, space } from "../theme";

type HeaderDestination = "Connections" | "FollowedProjects" | "Pending" | "Settings";

export function WorkspaceHeaderActions({
  navigate,
}: {
  navigate: (destination: HeaderDestination) => void;
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
    <View style={styles.actions}>
      <Pressable
        accessibilityHint="Opens workspace options"
        accessibilityLabel="Workspace options"
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
          size={25}
        />
      </Pressable>
      <ModalSheet
        onClose={() => setMenuOpen(false)}
        subtitle="Project, connection, and device settings"
        title="Workspace options"
        visible={menuOpen}
      >
        <View style={styles.menuGroup}>
          <MenuButton
            description="Permission and form requests"
            label={needsYouMenuLabel}
            onPress={() => open("Pending")}
          />
          <MenuButton
            description="Choose projects shown in Sessions"
            label="Followed projects"
            onPress={() => open("FollowedProjects")}
          />
          <MenuButton
            description="Switch or edit OpenCode servers"
            label="Connections"
            onPress={() => open("Connections")}
          />
          <MenuButton
            description="Device security and diagnostics"
            label="Settings"
            last
            onPress={() => open("Settings")}
          />
        </View>
      </ModalSheet>
    </View>
  );
}

function MenuButton({
  description,
  label,
  last,
  onPress,
}: {
  description: string;
  label: string;
  last?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={description}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuButton,
        last && styles.menuButtonLast,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.menuCopy}>
        <Text style={styles.menuLabel}>{label}</Text>
        <Text style={styles.menuDescription}>{description}</Text>
      </View>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.disclosure}>
        &gt;
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: "center", flexDirection: "row" },
  disclosure: { color: palette.dim, fontSize: 18, marginLeft: space.sm },
  menuButton: {
    alignItems: "center",
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  menuButtonLast: { borderBottomWidth: 0 },
  menuCopy: { flex: 1, minWidth: 0 },
  menuDescription: { color: palette.dim, fontSize: 12, marginTop: 3 },
  menuGroup: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  menuLabel: { color: palette.ink, fontSize: 15, fontWeight: "700" },
  optionsButton: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  optionsButtonPressed: { backgroundColor: palette.card },
  pressed: { opacity: 0.58 },
});
