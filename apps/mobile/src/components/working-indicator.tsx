import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState, StyleSheet, View } from "react-native";
import Animated, { type CSSAnimationKeyframes, steps } from "react-native-reanimated";

import { palette } from "../theme";

// OpenCode's terminal dot spinner, rendered as pixels instead of font-dependent glyphs.
const frames = [0x0b, 0x19, 0x39, 0x38, 0x3c, 0x34, 0x26, 0x27, 0x07, 0x0f];
const dots = [0, 1, 2, 3, 4, 5].map((bit) => ({
  bit,
  animation: Object.fromEntries(
    [...frames, frames[0]].map((frame, index) => [
      `${index * 10}%`,
      { opacity: ((frame ?? 0) & (1 << bit)) !== 0 ? 1 : 0 },
    ]),
  ) as CSSAnimationKeyframes,
}));

export function WorkingIndicator() {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === "active");

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled);
      })
      .catch(() => undefined);
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    const app = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => {
      mounted = false;
      motion.remove();
      app.remove();
    };
  }, []);

  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.icon}>
      {dots.map(({ bit, animation }) => (
        <Animated.View
          key={bit}
          style={[
            styles.dot,
            {
              left: bit < 3 ? 0 : 6,
              top: (bit % 3) * 6,
              opacity: (0x0b & (1 << bit)) !== 0 ? 1 : 0,
            },
            !reducedMotion && {
              animationName: animation,
              animationDuration: 800,
              animationIterationCount: "infinite",
              animationTimingFunction: steps(1, "end"),
              animationPlayState: foreground ? "running" : "paused",
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { width: 10, height: 16, flexShrink: 0 },
  dot: { position: "absolute", width: 4, height: 4, backgroundColor: palette.signal },
});
