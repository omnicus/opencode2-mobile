import Feather from "@expo/vector-icons/Feather";
import { useEffect, useRef, useState } from "react";
import { type StyleProp, StyleSheet, Text, type TextStyle, View } from "react-native";

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
    case "finished":
      return "Finished";
    case "interrupted":
      return "Interrupted";
    case "error":
      return "Failed";
  }
}

// What a transition is announced as: "Background subagent Review needs you". Running states
// are not announced; a child that stopped without reporting how is never called a success.
export function subagentOutcomeLabel(state: SubagentState) {
  switch (state) {
    case "running":
    case "streaming":
      return undefined;
    case "waiting":
      return "needs you";
    case "error":
      return "failed";
    case "interrupted":
      return "was interrupted";
    case "finished":
      return "finished, outcome unknown";
    case "completed":
      return "completed";
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
    case "finished":
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
        {/* Still: the Working line and the chip carry the motion; the blue label says it runs. */}
        <WorkingIndicator
          animated={false}
          color={state === "streaming" ? palette.dim : palette.info}
        />
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
        : state === "finished"
          ? "circle"
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
// it, so they are not told every new second. Render it as a sibling of any live-region text,
// never nested inside one: Android flattens nested Text into one node, which would make the
// live region change, and be read out, every second.
export function SubagentElapsed({
  finishedAt,
  frozen = false,
  startedAt,
  state,
  style,
}: {
  finishedAt?: number | undefined;
  // Last-known state from a stale connection: show the time at the last update, without ticking.
  frozen?: boolean;
  startedAt?: number | undefined;
  state: SubagentState;
  style?: StyleProp<TextStyle>;
}) {
  const live = isSubagentInFlight(state) && !frozen;
  // Opened while already frozen, it never saw a live tick, so any time shown would be a guess.
  const sawLive = useRef(!frozen);
  if (!frozen) sawLive.current = true;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live || startedAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [live, startedAt]);
  if (startedAt === undefined) return null;
  if (frozen && isSubagentInFlight(state) && !sawLive.current) return null;
  const end = live || (frozen && isSubagentInFlight(state)) ? now : finishedAt;
  if (end === undefined) return null;
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={style}>
      {` · ${formatElapsed(end - startedAt, true)}`}
    </Text>
  );
}

// "@agent · Background · State · 1m 23s", with the state in its color. Optional suffix such
// as " · Review" for rows that invite action.
export function SubagentMetaLine({
  agent,
  background,
  finishedAt,
  live = true,
  numberOfLines,
  startedAt,
  state,
  suffix,
  waitingFor,
}: {
  agent?: string | undefined;
  background: boolean;
  finishedAt?: number | undefined;
  // Whether state changes are read out here (Android live region). Off where another view owns
  // the announcement, so one change is never read twice.
  live?: boolean;
  numberOfLines?: number | undefined;
  startedAt?: number | undefined;
  state: SubagentState;
  suffix?: string | undefined;
  waitingFor?: SubagentAttention | undefined;
}) {
  // The live region holds only the state words; the ticking time is a hidden sibling.
  return (
    <View style={subagentStatusStyles.metaRow}>
      <Text
        accessibilityLiveRegion={live ? "polite" : "none"}
        dynamicTypeRamp="footnote"
        numberOfLines={numberOfLines}
        style={[subagentStatusStyles.meta, styles.metaShrink]}
      >
        {agent ? `${agent} · ` : ""}
        {background ? "Background · " : ""}
        <Text style={{ color: subagentStateColor(state) }}>
          {subagentStateLabel(state, waitingFor)}
        </Text>
        {suffix ?? ""}
      </Text>
      <SubagentElapsed
        finishedAt={finishedAt}
        startedAt={startedAt}
        state={state}
        style={subagentStatusStyles.meta}
      />
    </View>
  );
}

export const subagentStatusStyles = StyleSheet.create({
  meta: { ...typography.footnote, color: palette.dim },
  metaRow: { alignItems: "baseline", flexDirection: "row", flexWrap: "wrap" },
});

const styles = StyleSheet.create({
  glyph: { alignItems: "center", height: 20, justifyContent: "center", width: 16 },
  metaShrink: { flexShrink: 1 },
});
