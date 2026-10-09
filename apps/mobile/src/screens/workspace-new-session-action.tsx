import Feather from "@expo/vector-icons/Feather";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text } from "react-native";

import { palette, space, typeRamp, typography } from "../theme";

export function WorkspaceNewSessionAction({
  eligible,
  onPress,
}: {
  eligible: boolean;
  onPress: () => void;
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
  if (!eligible || keyboardVisible) return null;
  return (
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
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    bottom: space.md,
    right: space.md,
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
  label: { ...typography.control, color: palette.background },
  pressed: { opacity: 0.75 },
});
