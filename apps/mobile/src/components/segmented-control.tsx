import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { palette, pressedOpacity, typeRamp, typography, usesLargeTextLayout } from "../theme";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  accessibilityLabel?: string;
};

const compactHitSlop = { top: 8, bottom: 8 };

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "regular",
  role = "radiogroup",
  accessibilityLabel,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "regular" | "compact";
  role?: "radiogroup" | "tablist";
  accessibilityLabel?: string;
}) {
  const { fontScale } = useWindowDimensions();
  const compact = size === "compact";
  const stacked = usesLargeTextLayout(fontScale);
  return (
    <View
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      style={[styles.container, compact && styles.containerCompact, stacked && styles.stacked]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole={role === "tablist" ? "tab" : "radio"}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={role === "tablist" ? { selected } : { checked: selected }}
            android_ripple={
              Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)" } : undefined
            }
            hitSlop={compact ? compactHitSlop : undefined}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              compact && styles.segmentCompact,
              stacked && styles.segmentStacked,
              selected && styles.selected,
              pressed && Platform.OS === "ios" && styles.pressed,
            ]}
          >
            <Text
              dynamicTypeRamp={typeRamp.control}
              style={[styles.label, selected && styles.labelSelected]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.card,
    borderRadius: 10,
    flexDirection: "row",
    padding: 3,
  },
  containerCompact: { borderRadius: 9, padding: 2 },
  stacked: { flexDirection: "column" },
  segment: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
    overflow: "hidden",
  },
  segmentCompact: { borderRadius: 7, minHeight: 32, paddingHorizontal: 14 },
  segmentStacked: { flex: 0, paddingVertical: 6 },
  selected: { backgroundColor: palette.prompt },
  pressed: { opacity: pressedOpacity },
  label: {
    ...typography.control,
    color: palette.dim,
    includeFontPadding: false,
    textAlign: "center",
  },
  labelSelected: { color: palette.ink },
});
