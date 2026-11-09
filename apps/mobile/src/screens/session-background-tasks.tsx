import Feather from "@expo/vector-icons/Feather";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { type RefObject, useRef, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "../components/button";
import { ModalSheet } from "../components/modal-sheet";
import {
  SubagentElapsed,
  SubagentStatusGlyph,
  subagentStateColor,
  subagentStateLabel,
  subagentStatusStyles,
} from "../components/subagent-status";
import { WorkingIndicator } from "../components/working-indicator";
import {
  floatingShadow,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  rippleFeedback,
  space,
  typeRamp,
  typography,
} from "../theme";
import {
  isSubagentInFlight,
  type SessionSubagent,
  type SubagentAttentionMap,
  sanitizeTranscriptText,
  sessionSubagents,
} from "./session-transcript-model";

const chipHeight = 36;

// The session's subagent monitor: a chip above the composer while any child is live, and a
// sheet that lists every child this session launched, waiting first, then working, then
// finished. Rows open the child; running rows can be stopped after a confirmation.
export function SessionBackgroundTasks({
  activeSessions,
  attention,
  messages,
  onOpenChild,
  onStopChild,
  sessionID,
  stale = false,
}: {
  activeSessions?: Readonly<Record<string, unknown>> | undefined;
  attention?: SubagentAttentionMap | undefined;
  messages: SessionMessageInfo[];
  onOpenChild: (sessionID: string) => void;
  onStopChild?: ((sessionID: string) => Promise<void>) | undefined;
  sessionID?: string;
  // Disconnected or unable to load messages: keep the last-known rows but claim nothing live.
  stale?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<View>(null);
  const subagents = sessionSubagents(messages, activeSessions, sessionID, attention);
  const live = subagents.filter((subagent) => isSubagentInFlight(subagent.state));
  const waiting = live.filter((subagent) => subagent.state === "waiting").length;
  if ((live.length === 0 || stale) && !visible) return null;
  const count = `${live.length} ${live.length === 1 ? "subagent" : "subagents"}`;
  const label =
    waiting > 0 ? `${count} · ${waiting} ${waiting === 1 ? "needs" : "need"} you` : count;
  return (
    <View style={styles.container}>
      {live.length > 0 && !stale ? (
        <Pressable
          ref={triggerRef}
          accessibilityRole="button"
          accessibilityLabel={`${label}, running in this session`}
          accessibilityHint="Shows this session's subagents"
          accessibilityState={{ expanded: visible }}
          hitSlop={(minTouchTarget - chipHeight) / 2}
          onPress={() => setVisible(true)}
          style={({ pressed }) => [
            styles.chip,
            waiting > 0 && styles.chipWaiting,
            pressed && styles.pressed,
          ]}
          testID="subagent-monitor-chip"
        >
          {waiting > 0 ? (
            <View style={styles.waitingDot} testID="subagent-monitor-waiting" />
          ) : (
            <WorkingIndicator />
          )}
          <Text dynamicTypeRamp={typeRamp.control} style={styles.label}>
            {label}
          </Text>
        </Pressable>
      ) : null}
      <SubagentMonitorSheet
        onClose={() => setVisible(false)}
        onOpenChild={(childSessionID) => {
          setVisible(false);
          onOpenChild(childSessionID);
        }}
        onStopChild={onStopChild}
        returnFocusRef={triggerRef}
        stale={stale}
        subagents={subagents}
        visible={visible}
      />
    </View>
  );
}

function SubagentMonitorSheet({
  onClose,
  onOpenChild,
  onStopChild,
  returnFocusRef,
  stale,
  subagents,
  visible,
}: {
  onClose: () => void;
  onOpenChild: (sessionID: string) => void;
  onStopChild?: ((sessionID: string) => Promise<void>) | undefined;
  returnFocusRef: RefObject<View | null>;
  stale: boolean;
  subagents: SessionSubagent[];
  visible: boolean;
}) {
  const [showFinished, setShowFinished] = useState(false);
  const sections = [
    { title: "Needs you", rows: subagents.filter((subagent) => subagent.state === "waiting") },
    {
      title: "Working",
      rows: subagents.filter(
        (subagent) => subagent.state === "running" || subagent.state === "streaming",
      ),
    },
  ];
  const finished = subagents.filter((subagent) => !isSubagentInFlight(subagent.state));
  return (
    <ModalSheet
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      subtitle={stale ? "Status unavailable · showing last known" : "In this session"}
      title="Subagents"
      visible={visible}
    >
      {sections.map((section) =>
        section.rows.length > 0 ? (
          <View key={section.title} style={styles.section}>
            <Text
              accessibilityRole="header"
              dynamicTypeRamp={typeRamp.sectionLabel}
              style={styles.sectionTitle}
            >
              {section.title}
            </Text>
            <View style={styles.group}>
              {section.rows.map((subagent, index) => (
                <SubagentMonitorRow
                  key={subagent.key}
                  last={index === section.rows.length - 1}
                  onOpen={onOpenChild}
                  onStop={onStopChild}
                  subagent={subagent}
                />
              ))}
            </View>
          </View>
        ) : null,
      )}
      {sections.every((section) => section.rows.length === 0) ? (
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.empty}>
          Nothing is running in this session.
        </Text>
      ) : null}
      {finished.length > 0 ? (
        <View style={styles.section}>
          <Button
            accessibilityLabel={`${showFinished ? "Hide" : "Show"} finished subagents`}
            icon={showFinished ? "chevron-up" : "chevron-down"}
            label={`${showFinished ? "Hide" : "Show"} finished (${finished.length})`}
            onPress={() => setShowFinished((current) => !current)}
            size="compact"
            variant="text"
          />
          {showFinished ? (
            <View style={styles.group}>
              {finished.map((subagent, index) => (
                <SubagentMonitorRow
                  key={subagent.key}
                  last={index === finished.length - 1}
                  onOpen={onOpenChild}
                  subagent={subagent}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </ModalSheet>
  );
}

function SubagentMonitorRow({
  last,
  onOpen,
  onStop,
  subagent,
}: {
  last: boolean;
  onOpen: (sessionID: string) => void;
  onStop?: ((sessionID: string) => Promise<void>) | undefined;
  subagent: SessionSubagent;
}) {
  // Once a stop is sent the row stays "Stopping" until the refreshed state moves it out of
  // Working, so a stale Running row never offers Stop again.
  const [stopping, setStopping] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  const title = sanitizeTranscriptText(subagent.title, 256);
  const agent = subagent.agent ? `@${sanitizeTranscriptText(subagent.agent, 128)}` : "";
  const stateLabel = subagentStateLabel(subagent.state, subagent.waitingFor);
  const childSessionID = subagent.childSessionID;
  // A child that needs you invites review, not stopping; it can still be stopped from inside.
  const waiting = subagent.state === "waiting";
  const canStop = Boolean(
    onStop && childSessionID && isSubagentInFlight(subagent.state) && !waiting,
  );

  function confirmStop() {
    if (!childSessionID || !onStop) return;
    Alert.alert(`Stop ${title}?`, "The parent session may continue without its result.", [
      { style: "cancel", text: "Keep running" },
      {
        onPress: () => {
          setStopping(true);
          setStopFailed(false);
          onStop(childSessionID).catch(() => {
            setStopFailed(true);
            setStopping(false);
          });
        },
        style: "destructive",
        text: "Stop subagent",
      },
    ]);
  }

  return (
    <View style={[styles.row, !last && styles.separator]}>
      <Pressable
        accessibilityHint={childSessionID ? "Opens the subagent session" : undefined}
        accessibilityLabel={`${title}${agent ? `, ${agent}` : ""}, ${stateLabel}`}
        accessibilityRole={childSessionID ? "button" : undefined}
        android_ripple={childSessionID ? rippleFeedback.row : undefined}
        disabled={!childSessionID}
        onPress={() => {
          if (childSessionID) onOpen(childSessionID);
        }}
        style={({ pressed }) => [
          styles.rowMain,
          pressed && Platform.OS === "ios" && styles.pressed,
        ]}
      >
        <SubagentStatusGlyph state={subagent.state} waitingFor={subagent.waitingFor} />
        <View style={styles.copy}>
          <Text dynamicTypeRamp={typeRamp.body} numberOfLines={2} style={styles.title}>
            {title}
          </Text>
          <Text
            dynamicTypeRamp={typeRamp.footnote}
            numberOfLines={2}
            style={subagentStatusStyles.meta}
          >
            {agent ? `${agent} · ` : ""}
            {subagent.background ? "Background · " : ""}
            <Text style={{ color: subagentStateColor(subagent.state) }}>{stateLabel}</Text>
            <SubagentElapsed
              finishedAt={subagent.finishedAt}
              startedAt={subagent.startedAt}
              state={subagent.state}
            />
            {waiting && childSessionID ? " · Review" : ""}
          </Text>
          {stopFailed ? (
            <Text
              accessibilityRole="alert"
              dynamicTypeRamp={typeRamp.footnote}
              style={styles.error}
            >
              The subagent could not be stopped. Try again.
            </Text>
          ) : null}
        </View>
        {/* A Stop button already ends running rows; the chevron would crowd it. */}
        {childSessionID && !canStop ? (
          <Feather accessible={false} color={palette.dim} name="chevron-right" size={18} />
        ) : null}
      </Pressable>
      {canStop ? (
        <View style={styles.rowAction}>
          <Button
            accessibilityLabel={`Stop ${title}`}
            busy={stopping}
            label={stopping ? "Stopping" : "Stop"}
            onPress={confirmStop}
            size="compact"
            variant="danger"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: space.md, paddingVertical: space.xs },
  // Floats above the composer as a compact pill, like the OpenCode iOS app.
  chip: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    ...floatingShadow,
    flexDirection: "row",
    gap: space.sm,
    minHeight: chipHeight,
    paddingHorizontal: 14,
  },
  chipWaiting: { borderColor: palette.warm },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  empty: { ...typography.subheadline, color: palette.dim },
  error: { ...typography.footnote, color: palette.danger },
  group: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  label: { ...typography.control, color: palette.ink, flexShrink: 1 },
  pressed: { opacity: pressedOpacity },
  row: { alignItems: "center", flexDirection: "row", paddingRight: space.sm },
  rowAction: { flexShrink: 0 },
  rowMain: {
    alignItems: "flex-start",
    flex: 1,
    flexDirection: "row",
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  section: { gap: space.xs },
  sectionTitle: { ...typography.sectionLabel, color: palette.dim, paddingHorizontal: space.md },
  separator: { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.body, color: palette.ink },
  waitingDot: {
    backgroundColor: palette.warm,
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
});
