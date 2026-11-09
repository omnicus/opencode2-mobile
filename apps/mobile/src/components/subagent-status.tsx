import Feather from "@expo/vector-icons/Feather";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  isSubagentInFlight,
  type SubagentAttention,
  type SubagentPresentation,
} from "../screens/session-transcript-model";
import { formatElapsed } from "../screens/workspace-screen-model";
import { palette, typography } from "../theme";
import { WorkingIndicator } from "./working-indicator";

type SubagentState = SubagentPresentation["state"];

// One vocabulary for subagent state, shared by transcript cards and the session monitor.
export function subagentStateLabel(state: SubagentState, waitingFor?: SubagentAttention) {
  switch (state) {
    case "streaming":
      return "Preparing";
    case "running":
      return "Running";
    case "waiting":
      return waitingFor === "input" ? "Needs answer" : "Needs approval";
    case "completed":
      return "Completed";
    case "interrupted":
      return "Interrupted";
    case "error":
      return "Failed";
  }
}

// Working is blue, attention and stops amber, failure red, a finished run dim: the hue only
// reinforces the label beside it.
export function subagentStateColor(state: SubagentState) {
  switch (state) {
    case "streaming":
    case "running":
      return palette.info;
    case "waiting":
    case "interrupted":
      return palette.warm;
    case "error":
      return palette.danger;
    case "completed":
      return palette.dim;
  }
}

export function SubagentStatusGlyph({
  state,
  waitingFor,
}: {
  state: SubagentState;
  waitingFor?: SubagentAttention | undefined;
}) {
  if (state === "running" || state === "streaming") {
    return (
      <View style={styles.glyph} testID="subagent-glyph-working">
        <WorkingIndicator color={state === "streaming" ? palette.dim : palette.info} />
      </View>
    );
  }
  const name =
    state === "waiting"
      ? waitingFor === "input"
        ? "help-circle"
        : "lock"
      : state === "completed"
        ? "check-circle"
        : state === "interrupted"
          ? "minus-circle"
          : "alert-circle";
  return (
    <View style={styles.glyph} testID={`subagent-glyph-${state}`}>
      <Feather
        accessible={false}
        color={state === "completed" ? palette.success : subagentStateColor(state)}
        name={name}
        size={16}
      />
    </View>
  );
}

// Ticks once a second while the subagent runs and freezes at its finish. Screen readers skip
// it, so they are not told every new second.
export function SubagentElapsed({
  finishedAt,
  startedAt,
  state,
}: {
  finishedAt?: number | undefined;
  startedAt?: number | undefined;
  state: SubagentState;
}) {
  const live = isSubagentInFlight(state);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live || startedAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [live, startedAt]);
  if (startedAt === undefined) return null;
  const end = live ? now : finishedAt;
  if (end === undefined) return null;
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {` · ${formatElapsed(end - startedAt, true)}`}
    </Text>
  );
}

export const subagentStatusStyles = StyleSheet.create({
  meta: { ...typography.footnote, color: palette.dim },
});

const styles = StyleSheet.create({
  glyph: { alignItems: "center", height: 20, justifyContent: "center", width: 16 },
});
