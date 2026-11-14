import { useEffect, useRef, useState } from "react";
import {
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Button } from "../components/button";
import { focusAccessibility } from "../components/modal-sheet";
import { SelectableTranscriptText } from "../components/selectable-transcript-text";
import { SubagentElapsed } from "../components/subagent-status";
import { useAnnouncement } from "../components/use-announcement";
import { minTouchTarget, palette, radius, space, typeRamp, typography } from "../theme";
import {
  type ShellCandidate,
  shellOutputTail,
  shellPageStatus,
  shortShellCommand,
} from "./session-background-shells-model";
import { ShellObservation } from "./session-shell-output";
import type { ShellSnapshot } from "./session-shell-output-model";

// Within this distance of the end, new output keeps the box scrolled to the end.
const followThreshold = 24;
// About four lines of command at the default size; grows with text size up to twice that.
const commandMaxHeight = 96;

// One background shell inside the monitor sheet: its command, run time, the last lines of live
// output, and Stop. Once it ends, Stop gives way to how it ended. It stays on screen after the
// shell leaves the running list, until Back or the sheet closes.
export function BackgroundShellDetail({
  onBack,
  onStop,
  shell,
  stale,
}: {
  onBack: () => void;
  onStop?: ((shellID: string) => Promise<void>) | undefined;
  shell: ShellCandidate;
  stale: boolean;
}) {
  const headingRef = useRef<Text>(null);
  // Opening replaces the row that held focus, so focus moves to this page's heading.
  useEffect(() => {
    const frame = requestAnimationFrame(() => focusAccessibility(headingRef.current));
    return () => cancelAnimationFrame(frame);
  }, []);
  const { fontScale } = useWindowDimensions();
  // Back stays pinned; the page below it scrolls, so Back never scrolls away at large text.
  return (
    <View onAccessibilityEscape={onBack} style={styles.container}>
      <Button
        accessibilityLabel="Back to background work"
        align="start"
        icon="chevron-left"
        label="Back"
        onPress={onBack}
        size="compact"
        variant="text"
      />
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        style={styles.pageScroll}
      >
        <Text
          ref={headingRef}
          accessibilityRole="header"
          dynamicTypeRamp={typeRamp.headline}
          style={styles.heading}
        >
          Shell
        </Text>
        <ScrollView
          nestedScrollEnabled
          style={[styles.commandScroll, { maxHeight: commandMaxHeight * Math.min(fontScale, 2) }]}
        >
          <SelectableTranscriptText dynamicTypeRamp={typeRamp.body} style={styles.command}>
            {shell.command}
          </SelectableTranscriptText>
        </ScrollView>
        <ShellObservation shellID={shell.shellID}>
          {(observation) => (
            <ShellState
              error={Boolean(observation?.error)}
              onRetry={observation?.retry}
              onStop={onStop && !stale ? () => onStop(shell.shellID) : undefined}
              shell={shell}
              snapshot={observation?.snapshot}
              stale={stale}
            />
          )}
        </ShellObservation>
      </ScrollView>
    </View>
  );
}

function ShellState({
  error,
  onRetry,
  onStop,
  shell,
  snapshot,
  stale,
}: {
  error: boolean;
  onRetry: (() => void) | undefined;
  onStop: (() => Promise<void>) | undefined;
  shell: ShellCandidate;
  snapshot: ShellSnapshot | undefined;
  stale: boolean;
}) {
  // A failed refresh is as uncertain as a stale connection: last known, frozen, no Stop.
  const degraded = stale || error;
  const status = shellPageStatus(snapshot, degraded);
  const endedAt = useEndedAt(status.ended);
  const stop = useShellStop(shell.command, degraded ? undefined : onStop);
  const statusRef = useRef<Text>(null);
  // The Stop button that held focus is replaced by how the shell ended, so focus follows.
  useEffect(() => {
    if (status.ended && stop.requested) focusAccessibility(statusRef.current);
  }, [status.ended, stop.requested]);
  // Live regions are Android-only; iOS hears the end and a failed stop once each. After a Stop
  // here, focus moves to the end state, which reads it; announcing too would read it twice.
  useAnnouncement(status.ended && !stop.requested && `Shell ${status.ended.toLocaleLowerCase()}`);
  useAnnouncement(stop.failed && stopFailedMessage);
  const info = snapshot?.info;
  return (
    <View style={styles.state}>
      <View style={styles.statusRow}>
        <View style={styles.status}>
          <Text
            ref={statusRef}
            accessibilityLiveRegion={stop.requested ? "none" : "polite"}
            dynamicTypeRamp={typeRamp.footnote}
            style={[styles.statusLabel, toneStyles[status.tone]]}
          >
            {status.label}
          </Text>
          <SubagentElapsed
            finishedAt={info?.time.completed ?? endedAt}
            frozen={degraded && !status.ended}
            startedAt={info?.time.started ?? shell.startedAt}
            state={status.ended ? "completed" : "running"}
            style={styles.statusLabel}
          />
        </View>
        {!status.ended && stop.available ? (
          <Button
            accessibilityLabel={`Stop ${shortShellCommand(shell.command)}`}
            busy={stop.stopping}
            label={stop.stopping ? "Stopping" : "Stop"}
            onPress={stop.confirm}
            size="compact"
            variant="danger"
          />
        ) : null}
      </View>
      <ShellAlerts
        onRetry={onRetry}
        refreshFailed={error}
        stopFailed={stop.failed && !status.ended}
      />
      <ShellTail
        ended={Boolean(status.ended)}
        error={error}
        loaded={Boolean(snapshot)}
        output={snapshot?.output ?? ""}
        stale={stale}
        truncated={Boolean(snapshot?.truncated)}
      />
    </View>
  );
}

// A removed shell reports no completion time; the run time freezes when the page saw it end.
function useEndedAt(ended: string | undefined) {
  const [endedAt, setEndedAt] = useState<number>();
  useEffect(() => {
    if (ended && endedAt === undefined) setEndedAt(Date.now());
  }, [ended, endedAt]);
  return endedAt;
}

function ShellAlerts({
  onRetry,
  refreshFailed,
  stopFailed,
}: {
  onRetry: (() => void) | undefined;
  refreshFailed: boolean;
  stopFailed: boolean;
}) {
  return (
    <>
      {stopFailed ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.footnote} style={styles.error}>
          {stopFailedMessage}
        </Text>
      ) : null}
      {refreshFailed ? (
        <View style={styles.errorRow}>
          <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.footnote} style={styles.error}>
            Shell output could not be refreshed.
          </Text>
          {onRetry ? (
            <Button label="Retry" onPress={onRetry} size="compact" variant="text" />
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const stopFailedMessage = "The shell could not be stopped. Try again.";

// Once a stop is sent, the button stays "Stopping" until the refreshed status says how the
// shell ended and replaces it. A failure re-enables it.
function useShellStop(command: string, onStop: (() => Promise<void>) | undefined) {
  const [stopping, setStopping] = useState(false);
  const [failed, setFailed] = useState(false);
  const [requested, setRequested] = useState(false);
  function confirm() {
    if (!onStop) return;
    Alert.alert(`Stop ${shortShellCommand(command)}?`, "This ends the command on the server.", [
      { style: "cancel", text: "Keep running" },
      {
        onPress: () => {
          setStopping(true);
          setFailed(false);
          setRequested(true);
          onStop().catch(() => {
            setFailed(true);
            setStopping(false);
            setRequested(false);
          });
        },
        style: "destructive",
        text: "Stop shell",
      },
    ]);
  }
  return { available: Boolean(onStop), confirm, failed, requested, stopping };
}

function ShellTail({
  ended,
  error,
  loaded,
  output,
  stale,
  truncated,
}: {
  ended: boolean;
  error: boolean;
  loaded: boolean;
  output: string;
  stale: boolean;
  truncated: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  // Follows new output only while the reader is at the end; scrolling up to read stays put.
  const following = useRef(true);
  const tail = shellOutputTail(output);
  const empty = !loaded
    ? error || stale
      ? "Output unavailable"
      : "Loading output…"
    : ended
      ? "No output"
      : "No output yet";
  return (
    <View style={styles.tail}>
      {tail.text && (tail.clipped || truncated) ? (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.caption}>
          Showing recent output.
        </Text>
      ) : null}
      <ScrollView
        ref={scrollRef}
        accessibilityLabel="Shell output"
        nestedScrollEnabled
        onContentSizeChange={() => {
          if (following.current) scrollRef.current?.scrollToEnd({ animated: false });
        }}
        onScroll={({
          nativeEvent: { contentOffset, contentSize, layoutMeasurement },
        }: NativeSyntheticEvent<NativeScrollEvent>) => {
          following.current =
            contentSize.height - layoutMeasurement.height - contentOffset.y <= followThreshold;
        }}
        scrollEventThrottle={100}
        style={styles.output}
      >
        {tail.text ? (
          <SelectableTranscriptText dynamicTypeRamp={typeRamp.body} style={styles.outputText}>
            {tail.text}
          </SelectableTranscriptText>
        ) : (
          <Text dynamicTypeRamp={typeRamp.footnote} style={styles.empty}>
            {empty}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { ...typography.footnote, color: palette.dim },
  command: { ...typography.code, color: palette.ink },
  commandScroll: { flexGrow: 0 },
  container: { flex: 1, gap: space.sm },
  empty: { ...typography.footnote, color: palette.dim, padding: 12 },
  error: { ...typography.footnote, color: palette.danger, flexShrink: 1 },
  errorRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  failed: { color: palette.danger },
  heading: { ...typography.headline, color: palette.ink },
  output: {
    backgroundColor: palette.raised,
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 360,
  },
  outputText: { ...typography.code, color: palette.dim, padding: 12 },
  page: { gap: space.sm },
  pageScroll: { flex: 1 },
  running: { color: palette.info },
  state: { gap: space.sm },
  status: { alignItems: "baseline", flexDirection: "row", flexShrink: 1, flexWrap: "wrap" },
  statusLabel: { ...typography.footnote, color: palette.dim },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    justifyContent: "space-between",
    minHeight: minTouchTarget,
  },
  stopped: { color: palette.warm },
  tail: { gap: space.xs },
});

const toneStyles = StyleSheet.create({
  dim: {},
  failed: { color: palette.danger },
  running: { color: palette.info },
  stopped: { color: palette.warm },
});
