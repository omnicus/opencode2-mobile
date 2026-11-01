import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
  disabledOpacity,
  palette,
  pressedOpacity,
  radius,
  space,
  typeRamp,
  typography,
} from "../theme";

export function MenuGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

export function MenuRow({
  label,
  description,
  icon,
  onPress,
  disabled = false,
  danger = false,
  last = false,
  disclosure = true,
}: {
  label: string;
  description?: string;
  icon: ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  last?: boolean;
  disclosure?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ disabled }}
      android_ripple={Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)" } : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && styles.separator,
        pressed && Platform.OS === "ios" && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Feather
        accessible={false}
        name={icon}
        size={18}
        color={danger ? palette.danger : palette.dim}
      />
      <View style={styles.copy}>
        <Text dynamicTypeRamp={typeRamp.body} style={[styles.label, danger && styles.danger]}>
          {label}
        </Text>
        {description ? (
          <Text dynamicTypeRamp={typeRamp.footnote} style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>
      {disclosure ? (
        <Feather accessible={false} name="chevron-right" size={16} color={palette.dim} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: palette.card,
    borderRadius: radius.md,
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 12,
  },
  separator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { ...typography.body, color: palette.ink },
  description: { ...typography.footnote, color: palette.dim },
  danger: { color: palette.danger },
  pressed: { opacity: pressedOpacity },
  disabled: { opacity: disabledOpacity },
});
