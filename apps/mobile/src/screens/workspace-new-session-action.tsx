import Feather from "@expo/vector-icons/Feather";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import { WorkspaceHeaderActions } from "../navigation/workspace-header-actions";

import { palette, space, typeRamp, typography } from "../theme";

export function WorkspaceNewSessionAction({
  eligible,
  onPress,
  onNavigate,
  showSettings = false,
}: {
  eligible: boolean;
  onPress: () => void;
  onNavigate?: (destination: "Connections" | "FollowedProjects" | "Pending" | "Settings") => void;
  showSettings?: boolean;
}) {
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if ((!eligible && !showSettings) || keyboardVisible) return null;
  return (
    <View pointerEvents="box-none" style={styles.dock}>
      {eligible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New session"
          accessibilityHint="Choose a project for a new session"
          onPress={onPress}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Feather accessible={false} name="plus" size={18} color={palette.background} />
          <Text dynamicTypeRamp={typeRamp.control} style={styles.label}>
            New session
          </Text>
        </Pressable>
      ) : null}
      {showSettings && onNavigate ? (
        <WorkspaceHeaderActions floating navigate={onNavigate} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    bottom: space.md,
    right: space.md,
    left: space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space.sm,
  },
  button: {
    flexShrink: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    borderRadius: 24,
    backgroundColor: palette.signal,
    paddingHorizontal: space.md,
    elevation: 3,
    boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.2)",
  },
  label: { ...typography.control, color: palette.background, flexShrink: 1 },
  pressed: { opacity: 0.75 },
});
