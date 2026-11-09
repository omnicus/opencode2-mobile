import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps, Ref } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type View,
  type ViewStyle,
} from "react-native";

import {
  control,
  disabledOpacity,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
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
  ref,
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
  // For focus return from a sheet the button opened.
  ref?: Ref<View>;
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
      ref={ref}
      style={({ pressed }) => [
        styles.button,
        size === "compact" && styles.compact,
        variant === "text" && styles.text,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "danger" && styles.danger,
        alignStyles[alignment],
        style,
        // Filled buttons change their fill when pressed, so labels keep their contrast; text
        // buttons have no fill and dim instead.
        pressed && Platform.OS === "ios" && pressedStyles[variant],
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
  // Capsules with filled, tinted variants, so every button reads as a control on any surface.
  button: {
    ...control,
    borderRadius: radius.pill,
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
  secondary: { backgroundColor: palette.selected },
  danger: { backgroundColor: palette.dangerFill },
  disabled: { opacity: disabledOpacity },
  label: {
    ...typography.control,
    flexShrink: 1,
    includeFontPadding: false,
    textAlign: "center",
  },
});

// Pressed fills keep labels at 4.9:1 or better (danger 5.2:1, secondary 8.6:1, primary 13.4:1).
const pressedStyles = StyleSheet.create({
  primary: { backgroundColor: "#d6dbe6" },
  secondary: { backgroundColor: "#3d4459" },
  danger: { backgroundColor: "#4a2d42" },
  text: { opacity: pressedOpacity },
});

const alignStyles = StyleSheet.create({
  start: { alignSelf: "flex-start" },
  center: { alignSelf: "center" },
  stretch: { alignSelf: "stretch" },
});
