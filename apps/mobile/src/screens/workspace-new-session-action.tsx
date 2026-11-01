import Feather from "@expo/vector-icons/Feather";
import { useEffect, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WorkspaceHeaderActions } from "../navigation/workspace-header-actions";

import {
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  space,
  typeRamp,
  typography,
} from "../theme";

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
    // iOS sends Will events, so the pill hides as the keyboard starts to rise. Android only
    // sends Did events.
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () =>
      setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () =>
      setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if ((!eligible && !showSettings) || keyboardVisible) return null;
  return (
    <View pointerEvents="box-none" style={styles.dock}>
      {showSettings && onNavigate ? (
        <WorkspaceHeaderActions floating navigate={onNavigate} />
      ) : null}
      {eligible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New session"
          accessibilityHint="Choose a project for a new session"
          android_ripple={
            Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)" } : undefined
          }
          onPress={onPress}
          style={({ pressed }) => [
            styles.button,
            pressed && Platform.OS === "ios" && styles.pressed,
          ]}
        >
          <Feather accessible={false} name="plus" size={18} color={palette.background} />
          <Text dynamicTypeRamp={typeRamp.control} style={styles.label}>
            New session
          </Text>
        </Pressable>
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
    gap: space.sm,
  },
  button: {
    flexShrink: 1,
    // Settings stays at the far left; New session takes the right edge.
    marginLeft: "auto",
    minHeight: minTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    borderRadius: radius.pill,
    backgroundColor: palette.signal,
    paddingHorizontal: space.md,
    elevation: 3,
    boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.2)",
  },
  label: { ...typography.control, color: palette.background, flexShrink: 1 },
  pressed: { opacity: pressedOpacity },
});
