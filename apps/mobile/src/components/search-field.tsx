import Feather from "@expo/vector-icons/Feather";
import type { Ref } from "react";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";

import { minTouchTarget, palette, pressedOpacity, radius, space, typography } from "../theme";

// The field's 1px border covers the rest of the clear button's 48pt target.
const clearHitSlop = { top: 1, bottom: 1 };

export function SearchField({
  ref,
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  editable,
  onFocus,
  onBlur,
  autoFocus,
  returnKeyType,
  onSubmitEditing,
  clearAccessibilityLabel = "Clear search",
  style,
}: {
  ref?: Ref<TextInput>;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  editable?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
  clearAccessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.field, style]}>
      <Feather accessible={false} name="search" size={18} color={palette.dim} />
      <TextInput
        ref={ref}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        editable={editable}
        keyboardAppearance="dark"
        onBlur={onBlur}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={palette.dim}
        returnKeyType={returnKeyType}
        style={styles.input}
        value={value}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
          hitSlop={clearHitSlop}
          onPress={() => onChangeText("")}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        >
          <Feather accessible={false} name="x-circle" size={18} color={palette.dim} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    alignItems: "center",
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: 14,
  },
  input: {
    ...typography.body,
    color: palette.ink,
    flex: 1,
    includeFontPadding: false,
    // Lets the field shrink so the clear button stays inside it.
    minWidth: 0,
    minHeight: minTouchTarget - 2,
    paddingVertical: 0,
  },
  clear: {
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    marginRight: -14,
    width: minTouchTarget,
  },
  pressed: { opacity: pressedOpacity },
});
