import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from "react-native";

import {
  control,
  disabledOpacity,
  minTouchTarget,
  palette,
  pressedOpacity,
  space,
  typeRamp,
  typography,
} from "../theme";

export type ButtonVariant = "primary" | "secondary" | "text" | "danger";

const labelColors: Record<ButtonVariant, string> = {
  primary: palette.background,
  secondary: palette.ink,
  text: palette.signal,
  danger: palette.danger,
};

export function Button({
  label,
  onPress,
  variant = "secondary",
  size = "regular",
  disabled = false,
  busy = false,
  fullWidth = false,
  accessibilityHint,
  accessibilityLabel,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: "regular" | "compact";
  disabled?: boolean;
  busy?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  icon?: ComponentProps<typeof Feather>["name"];
}) {
  const color = labelColors[variant];
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      android_ripple={
        Platform.OS === "android"
          ? { color: "rgba(255,255,255,0.12)", borderless: variant === "text" }
          : undefined
      }
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === "compact" && styles.compact,
        variant === "primary" && styles.primary,
        (variant === "secondary" || variant === "danger") && styles.outlined,
        fullWidth && styles.fullWidth,
        pressed && Platform.OS === "ios" && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {busy ? <ActivityIndicator color={color} size="small" /> : null}
      {icon ? <Feather accessible={false} name={icon} size={16} color={color} /> : null}
      <Text dynamicTypeRamp={typeRamp.control} style={[styles.label, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    ...control,
    minHeight: minTouchTarget,
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    justifyContent: "center",
    gap: space.xs,
    overflow: "hidden",
  },
  compact: { paddingHorizontal: space.sm },
  primary: { backgroundColor: palette.signal },
  outlined: { borderColor: palette.border, borderWidth: 1 },
  fullWidth: { alignSelf: "stretch" },
  pressed: { opacity: pressedOpacity },
  disabled: { opacity: disabledOpacity },
  label: {
    ...typography.control,
    flexShrink: 1,
    includeFontPadding: false,
    textAlign: "center",
  },
});
