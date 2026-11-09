import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";

import {
  control,
  disabledOpacity,
  minTouchTarget,
  palette,
  pressedOpacity,
  rippleColor,
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

// Text buttons have no side padding so they line up with text; keep the touch area.
const textHitSlop = { left: space.sm, right: space.sm };

export function Button({
  label,
  onPress,
  variant = "secondary",
  size = "regular",
  disabled = false,
  busy = false,
  fullWidth = false,
  align = "start",
  accessibilityHint,
  accessibilityLabel,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: "regular" | "compact";
  disabled?: boolean;
  busy?: boolean;
  // Alias for align="stretch".
  fullWidth?: boolean;
  align?: "start" | "center" | "stretch";
  accessibilityHint?: string;
  accessibilityLabel?: string;
  icon?: ComponentProps<typeof Feather>["name"];
  // Layout only (margins, flexGrow); not colors or type.
  style?: StyleProp<ViewStyle>;
}) {
  const color = labelColors[variant];
  const inactive = disabled || busy;
  const alignment = fullWidth ? "stretch" : align;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      android_ripple={
        Platform.OS === "android"
          ? { color: rippleColor, borderless: variant === "text" }
          : undefined
      }
      disabled={inactive}
      hitSlop={variant === "text" ? textHitSlop : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === "compact" && styles.compact,
        variant === "text" && styles.text,
        variant === "primary" && styles.primary,
        (variant === "secondary" || variant === "danger") && styles.outlined,
        alignStyles[alignment],
        style,
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
    flexDirection: "row",
    justifyContent: "center",
    gap: space.xs,
    overflow: "hidden",
  },
  compact: { paddingHorizontal: space.sm },
  text: { minWidth: minTouchTarget, paddingHorizontal: 0 },
  primary: { backgroundColor: palette.signal },
  outlined: { borderColor: palette.border, borderWidth: 1 },
  pressed: { opacity: pressedOpacity },
  disabled: { opacity: disabledOpacity },
  label: {
    ...typography.control,
    flexShrink: 1,
    includeFontPadding: false,
    textAlign: "center",
  },
});

const alignStyles = StyleSheet.create({
  start: { alignSelf: "flex-start" },
  center: { alignSelf: "center" },
  stretch: { alignSelf: "stretch" },
});
