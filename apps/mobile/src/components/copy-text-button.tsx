import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text } from "react-native";
import {
  minTouchTarget,
  palette,
  pressedOpacity,
  rippleFeedback,
  space,
  typeRamp,
  typography,
} from "../theme";
import { Button } from "./button";

export function CopyTextButton({
  text,
  label = "Copy text",
  iconOnly = false,
  appearance = "text",
}: {
  text: string;
  label?: string;
  iconOnly?: boolean;
  // "button" matches a full-width secondary Button for sheets with other actions.
  appearance?: "text" | "button";
}) {
  const [result, setResult] = useState<{ text: string; status: "copied" | "failed" }>();
  const pending = useRef(false);
  const status = result?.text === text ? result.status : undefined;
  useEffect(() => {
    if (result?.status !== "copied") return;
    const timer = setTimeout(() => setResult(undefined), 2_000);
    return () => clearTimeout(timer);
  }, [result]);
  async function copy() {
    if (pending.current) return;
    pending.current = true;
    try {
      const copied = await Clipboard.setStringAsync(text);
      if (!copied) throw new Error("CLIPBOARD_WRITE_FAILED");
      setResult({ text, status: "copied" });
      AccessibilityInfo.announceForAccessibility("Copied to clipboard");
    } catch {
      setResult({ text, status: "failed" });
      AccessibilityInfo.announceForAccessibility("Could not copy. Try again.");
    } finally {
      pending.current = false;
    }
  }
  const shown = status === "copied" ? "Copied" : status === "failed" ? "Retry copy" : label;
  if (appearance === "button") {
    return (
      <Button
        accessibilityLabel={label}
        fullWidth
        icon={status === "copied" ? "check" : "copy"}
        label={shown}
        onPress={() => void copy()}
      />
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={rippleFeedback.borderless}
      onPress={() => void copy()}
      style={({ pressed }) => [styles.action, pressed && Platform.OS === "ios" && styles.pressed]}
    >
      {iconOnly && !status ? (
        <Feather accessible={false} name="copy" size={14} color={palette.dim} />
      ) : (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.label}>
          {shown}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: space.xs,
  },
  label: { ...typography.footnote, color: palette.dim },
  pressed: { opacity: pressedOpacity },
});

import Feather from "@expo/vector-icons/Feather";
