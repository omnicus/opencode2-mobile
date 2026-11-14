import Feather from "@expo/vector-icons/Feather";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Button } from "../components/button";
import { focusAccessibility, ModalSheet } from "../components/modal-sheet";
import {
  SubagentElapsed,
  SubagentMetaLine,
  SubagentStatusGlyph,
  subagentOutcomeLabel,
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
  usesLargeTextLayout,
} from "../theme";
import { BackgroundShellDetail } from "./session-background-shell-detail";
import {
  backgroundWorkSummary,
  type ShellCandidate,
  shortShellCommand,
} from "./session-background-shells-model";
import { useRunningShells, useStopShell } from "./session-shell-output";
import {
  isSubagentInFlight,
  type SessionSubagent,
  type SubagentAttentionMap,
  sanitizeTranscriptText,
  sessionSubagents,
} from "./session-transcript-model";

const chipHeight = 36;

// The session's background work: a chip above the composer while any child or shell is live, and a sheet that lists every child this session launched (waiting first, then
// working, then finished) and its running shells. Child rows open the child; running children
// can be stopped after a confirmation. Shell rows open the shell's output and Stop in place.
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
  const shells = useRunningShells(messages);
  const stopShell = useStopShell();
  useBackgroundSubagentAnnouncements(subagents, stale);
  const running = live.length + shells.length;
  // Shells whose status refresh failed are only last known: the chip says so and stays still
  // when nothing it counts is confirmed live.
  const uncertain = shells.some((shell) => shell.lastKnown);
  const confirmedLive = live.length + shells.filter((shell) => !shell.lastKnown).length > 0;
  if ((running === 0 || stale) && !visible) return null;
  const count = backgroundWorkSummary(live.length, shells.length);
  const label =
    waiting > 0 ? `${count} · ${waiting} ${waiting === 1 ? "needs" : "need"} you` : count;
  const chipVisible = running > 0 && !stale;
  return (
    <View style={chipVisible && styles.container}>
      {chipVisible ? (
        <Pressable
          ref={triggerRef}
          accessibilityRole="button"
          accessibilityLabel={`${label.replaceAll(" · ", ", ")}, ${uncertain ? "status unavailable" : "running in this session"}`}
          accessibilityHint="Shows this session's background work"
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
            <WorkingIndicator animated={confirmedLive} />
          )}
          <Text
            dynamicTypeRamp={typeRamp.control}
            style={[styles.label, uncertain && styles.labelUncertain]}
          >
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
        onStopShell={stale ? undefined : stopShell}
        returnFocusRef={triggerRef}
        shells={shells}
        stale={stale}
        subagents={subagents}
        visible={visible}
      />
    </View>
  );
}

// Background launches fold into "Used N tools", so their cards are not mounted to announce a
// change. The chip's component always runs, so it tells screen readers on both platforms when a
// background subagent needs you, fails, or completes. Running states and stale data stay quiet.
function useBackgroundSubagentAnnouncements(subagents: SessionSubagent[], stale: boolean) {
  const previous = useRef<Map<string, SessionSubagent["state"]>>(undefined);
  useEffect(() => {
    const background = subagents.filter((subagent) => subagent.background);
    const before = previous.current;
    previous.current = new Map(background.map((subagent) => [subagent.key, subagent.state]));
    if (!before || stale) return;
    const messages: string[] = [];
    for (const subagent of background) {
      const was = before.get(subagent.key);
      const outcome = subagentOutcomeLabel(subagent.state);
      if (was === undefined || was === subagent.state || !outcome) continue;
      messages.push(
        `Background subagent ${sanitizeTranscriptText(subagent.title, 256)} ${outcome}`,
      );
    }
    // One announcement per update: on iOS a second call cuts the first one off.
    if (messages.length > 0) AccessibilityInfo.announceForAccessibility(messages.join(". "));
  });
}

function SubagentMonitorSheet({
  onClose,
  onOpenChild,
  onStopChild,
  onStopShell,
  returnFocusRef,
  shells,
  stale,
  subagents,
  visible,
}: {
  onClose: () => void;
  onOpenChild: (sessionID: string) => void;
  onStopChild?: ((sessionID: string) => Promise<void>) | undefined;
  onStopShell?: ((shellID: string) => Promise<void>) | undefined;
  returnFocusRef: RefObject<View | null>;
  shells: ShellCandidate[];
  stale: boolean;
  subagents: SessionSubagent[];
  visible: boolean;
}) {
  const [showFinished, setShowFinished] = useState(false);
  // The open shell is kept here, not looked up in the running list, so a shell that ends while
  // its page is open stays visible until Back or the sheet closes.
  const [openShell, setOpenShell] = useState<ShellCandidate>();
  // Back returns focus to the row that opened the page, or to the Shells header once it is gone.
  const shellRows = useRef(new Map<string, View>());
  const shellsHeader = useRef<Text>(null);
  // The list's first heading, or its empty state: present whatever is left to show.
  const listStart = useRef<Text | null>(null);
  const back = () => {
    const shellID = openShell?.shellID;
    setOpenShell(undefined);
    requestAnimationFrame(() =>
      focusAccessibility(
        (shellID ? shellRows.current.get(shellID) : undefined) ??
          shellsHeader.current ??
          listStart.current,
      ),
    );
  };
  const sections = [
    { title: "Needs you", rows: subagents.filter((subagent) => subagent.state === "waiting") },
    {
      title: "Subagents",
      rows: subagents.filter(
        (subagent) => subagent.state === "running" || subagent.state === "streaming",
      ),
    },
  ];
  const finished = subagents.filter((subagent) => !isSubagentInFlight(subagent.state));
  const firstSection = sections.find((section) => section.rows.length > 0);
  const close = () => {
    setOpenShell(undefined);
    onClose();
  };
  return (
    <ModalSheet
      onClose={close}
      // Android back steps from the shell page to the list. An iOS swipe always dismisses the
      // native sheet, so it must close, or the sheet state would stay open behind it.
      onRequestClose={Platform.OS === "android" && openShell ? back : close}
      scrollable={!openShell}
      returnFocusRef={returnFocusRef}
      subtitle={stale ? "Status unavailable · showing last known" : "In this session"}
      title="Background work"
      visible={visible}
    >
      {openShell ? (
        <BackgroundShellDetail onBack={back} onStop={onStopShell} shell={openShell} stale={stale} />
      ) : (
        <>
          {sections.map((section) =>
            section.rows.length > 0 ? (
              <View key={section.title} style={styles.section}>
                <Text
                  ref={section === firstSection ? listStart : undefined}
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
          {shells.length > 0 ? (
            <View style={styles.section}>
              <Text
                ref={shellsHeader}
                accessibilityRole="header"
                dynamicTypeRamp={typeRamp.sectionLabel}
                style={styles.sectionTitle}
              >
                Shells
              </Text>
              <View style={styles.group}>
                {shells.map((shell, index) => (
                  <ShellMonitorRow
                    key={shell.key}
                    last={index === shells.length - 1}
                    onOpen={setOpenShell}
                    rowRef={(row) => {
                      if (row) shellRows.current.set(shell.shellID, row);
                      else shellRows.current.delete(shell.shellID);
                    }}
                    shell={shell}
                    stale={stale || Boolean(shell.lastKnown)}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {sections.every((section) => section.rows.length === 0) && shells.length === 0 ? (
            <Text ref={listStart} dynamicTypeRamp={typeRamp.subheadline} style={styles.empty}>
              Nothing is running in this session.
            </Text>
          ) : null}
          {finished.length > 0 ? (
            <View style={styles.section}>
              <Button
                accessibilityLabel={`${showFinished ? "Hide" : "Show"} finished subagents`}
                icon={showFinished ? "chevron-up" : "chevron-down"}
                label={`${showFinished ? "Hide" : "Show"} finished subagents (${finished.length})`}
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
        </>
      )}
    </ModalSheet>
  );
}

function ShellMonitorRow({
  last,
  onOpen,
  rowRef,
  shell,
  stale,
}: {
  last: boolean;
  onOpen: (shell: ShellCandidate) => void;
  rowRef: (row: View | null) => void;
  shell: ShellCandidate;
  stale: boolean;
}) {
  const largeText = usesLargeTextLayout(useWindowDimensions().fontScale);
  const state = stale ? "Last known: Running" : "Running";
  return (
    <View style={[styles.row, !last && styles.separator]}>
      <Pressable
        ref={rowRef}
        accessibilityHint="Shows the shell's output"
        accessibilityLabel={`${shortShellCommand(shell.command)}, ${state}`}
        accessibilityRole="button"
        android_ripple={rippleFeedback.row}
        onPress={() => onOpen(shell)}
        style={({ pressed }) => [
          styles.rowMain,
          pressed && Platform.OS === "ios" && styles.pressed,
        ]}
      >
        <View style={styles.shellGlyph}>
          <Feather
            accessible={false}
            color={stale ? palette.dim : palette.info}
            name="terminal"
            size={16}
          />
        </View>
        <View style={styles.copy}>
          <Text
            dynamicTypeRamp={typeRamp.body}
            numberOfLines={largeText ? 4 : 2}
            style={styles.command}
          >
            {shell.command}
          </Text>
          {/* The ticking time is a sibling of the state, never inside it. */}
          <View style={subagentStatusStyles.metaRow}>
            <Text
              dynamicTypeRamp={typeRamp.footnote}
              style={[styles.meta, !stale && styles.running]}
            >
              {state}
            </Text>
            <SubagentElapsed
              frozen={stale}
              startedAt={shell.startedAt}
              state="running"
              style={styles.meta}
            />
          </View>
        </View>
        <Feather accessible={false} color={palette.dim} name="chevron-right" size={18} />
      </Pressable>
    </View>
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
  const title = sanitizeTranscriptText(subagent.title, 256);
  const agent = subagent.agent ? `@${sanitizeTranscriptText(subagent.agent, 128)}` : "";
  const childSessionID = subagent.childSessionID;
  // A child that needs you invites review, not stopping; it can still be stopped from inside.
  const waiting = subagent.state === "waiting";
  const stop = useStopSubagent(
    title,
    childSessionID && onStop && isSubagentInFlight(subagent.state) && !waiting
      ? () => onStop(childSessionID)
      : undefined,
  );
  return (
    <View style={[styles.row, !last && styles.separator]}>
      <Pressable
        accessibilityHint={childSessionID ? "Opens the subagent session" : undefined}
        accessibilityLabel={`${title}${agent ? `, ${agent}` : ""}, ${subagentStateLabel(subagent.state, subagent.waitingFor)}`}
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
          <SubagentMetaLine
            agent={agent}
            background={subagent.background}
            // The monitor announces background changes once; its rows stay quiet.
            live={!subagent.background}
            finishedAt={subagent.finishedAt}
            numberOfLines={2}
            startedAt={subagent.startedAt}
            state={subagent.state}
            suffix={waiting && childSessionID ? " · Review" : undefined}
            waitingFor={subagent.waitingFor}
          />
          {stop.failed ? (
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
        {childSessionID && !stop.available ? (
          <Feather accessible={false} color={palette.dim} name="chevron-right" size={18} />
        ) : null}
      </Pressable>
      {stop.available ? (
        <View style={styles.rowAction}>
          <Button
            accessibilityLabel={`Stop ${title}`}
            busy={stop.stopping}
            label={stop.stopping ? "Stopping" : "Stop"}
            onPress={stop.confirm}
            size="compact"
            variant="danger"
          />
        </View>
      ) : null}
    </View>
  );
}

// Once a stop is sent the row stays "Stopping" until the refreshed state moves it out of
// Working, so a stale Running row never offers Stop again. A failure re-enables it.
function useStopSubagent(title: string, stop: (() => Promise<void>) | undefined) {
  const [stopping, setStopping] = useState(false);
  const [failed, setFailed] = useState(false);
  function confirm() {
    if (!stop) return;
    Alert.alert(`Stop ${title}?`, "The parent session may continue without its result.", [
      { style: "cancel", text: "Keep running" },
      {
        onPress: () => {
          setStopping(true);
          setFailed(false);
          stop().catch(() => {
            setFailed(true);
            setStopping(false);
          });
        },
        style: "destructive",
        text: "Stop subagent",
      },
    ]);
  }
  return { available: Boolean(stop), confirm, failed, stopping };
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
  command: { ...typography.code, color: palette.ink },
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
  labelUncertain: { color: palette.dim },
  meta: { ...typography.footnote, color: palette.dim },
  pressed: { opacity: pressedOpacity },
  row: { alignItems: "center", flexDirection: "row", paddingRight: space.sm },
  rowAction: { flexShrink: 0 },
  // Running matches the subagent rows beside it.
  running: { color: palette.info },
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
  shellGlyph: { alignItems: "center", height: 20, justifyContent: "center", width: 16 },
  separator: { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.body, color: palette.ink },
  waitingDot: {
    backgroundColor: palette.warm,
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
});
