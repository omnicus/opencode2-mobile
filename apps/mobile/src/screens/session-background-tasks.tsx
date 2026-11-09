import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ModalSheet } from "../components/modal-sheet";
import { WorkingIndicator } from "../components/working-indicator";
import {
  floatingShadow,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  space,
  typeRamp,
  typography,
} from "../theme";
import { runningBackgroundSubagents, sanitizeTranscriptText } from "./session-transcript-model";

const chipHeight = 36;

export function SessionBackgroundTasks({
  activeSessions,
  messages,
  onOpenChild,
  sessionID,
}: {
  activeSessions?: Readonly<Record<string, unknown>> | undefined;
  messages: SessionMessageInfo[];
  onOpenChild: (sessionID: string) => void;
  sessionID?: string;
}) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<View>(null);
  const tasks = runningBackgroundSubagents(messages, activeSessions, sessionID);
  useEffect(() => {
    if (tasks.length === 0) setVisible(false);
  }, [tasks.length]);
  if (tasks.length === 0) return null;
  const label = `${tasks.length} ${tasks.length === 1 ? "subagent" : "subagents"}`;
  return (
    <View style={styles.container}>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={`${label} running in background`}
        accessibilityHint="Shows background tasks for this session"
        accessibilityState={{ expanded: visible }}
        hitSlop={(minTouchTarget - chipHeight) / 2}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      >
        <WorkingIndicator />
        <Text dynamicTypeRamp={typeRamp.control} style={styles.label}>
          {label}
        </Text>
      </Pressable>
      <ModalSheet
        title="Background tasks"
        subtitle="Known running tasks in this session"
        size="compact"
        visible={visible}
        onClose={() => setVisible(false)}
        returnFocusRef={triggerRef}
      >
        {tasks.map((task, index) => {
          const title = task.title
            ? sanitizeTranscriptText(task.title, 256)
            : `Subagent ${index + 1}`;
          return (
            <View key={task.key} style={styles.row}>
              <View style={styles.copy}>
                <Text dynamicTypeRamp={typeRamp.body} style={styles.title}>
                  {title}
                </Text>
                <View style={styles.status}>
                  <WorkingIndicator />
                  <Text dynamicTypeRamp={typeRamp.footnote} style={styles.muted}>
                    Running
                  </Text>
                </View>
              </View>
              {task.childSessionID ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${title}`}
                  onPress={() => {
                    setVisible(false);
                    if (task.childSessionID) onOpenChild(task.childSessionID);
                  }}
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                >
                  <Text dynamicTypeRamp={typeRamp.control} style={styles.link}>
                    Open
                  </Text>
                </Pressable>
              ) : (
                <Text dynamicTypeRamp={typeRamp.footnote} style={styles.muted}>
                  Session unavailable
                </Text>
              )}
            </View>
          );
        })}
      </ModalSheet>
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
  label: { ...typography.control, color: palette.ink, flexShrink: 1 },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  title: { ...typography.body, color: palette.ink },
  status: { alignItems: "center", flexDirection: "row", gap: space.xs },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    paddingVertical: space.sm,
  },
  action: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.sm,
  },
  link: { ...typography.control, color: palette.signal },
  muted: { ...typography.footnote, color: palette.dim },
  pressed: { opacity: pressedOpacity },
});
