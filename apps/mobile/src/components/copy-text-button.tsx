import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text } from "react-native";

import { palette, space, typography } from "../theme";

export function CopyTextButton({
  text,
  label = "Copy text",
  iconOnly = false,
}: {
  text: string;
  label?: string;
  iconOnly?: boolean;
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => void copy()}
      style={styles.action}
    >
      {iconOnly && !status ? (
        <Feather accessible={false} name="copy" size={20} color={palette.dim} />
      ) : (
        <Text style={styles.label}>
          {status === "copied" ? "Copied" : status === "failed" ? "Retry copy" : label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: space.xs,
  },
  label: { ...typography.caption, color: palette.dim },
});

import Feather from "@expo/vector-icons/Feather";
