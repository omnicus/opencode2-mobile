import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ModalSheet } from "../components/modal-sheet";
import { palette, radius, space, typeRamp, typography } from "../theme";
import { runningBackgroundSubagents } from "./session-transcript-model";

export function SessionBackgroundTasks({
  messages,
  onOpenChild,
}: {
  messages: SessionMessageInfo[];
  onOpenChild: (sessionID: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<View>(null);
  const tasks = runningBackgroundSubagents(messages);
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
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      >
        <Text dynamicTypeRamp={typeRamp.control} style={styles.label}>
          {label} · Running
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
        {tasks.map((task, index) => (
          <View key={task.key} style={styles.row}>
            <Text dynamicTypeRamp={typeRamp.control} style={styles.label}>
              Subagent {index + 1} · Running
            </Text>
            {task.childSessionID ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open child session for subagent ${index + 1}`}
                onPress={() => {
                  setVisible(false);
                  if (task.childSessionID) onOpenChild(task.childSessionID);
                }}
                style={styles.action}
              >
                <Text dynamicTypeRamp={typeRamp.control} style={styles.link}>
                  Open child
                </Text>
              </Pressable>
            ) : (
              <Text dynamicTypeRamp={typeRamp.caption} style={styles.muted}>
                Child session unavailable
              </Text>
            )}
          </View>
        ))}
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: space.md, paddingVertical: space.xs },
  chip: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: palette.card,
    paddingHorizontal: space.md,
  },
  label: { ...typography.control, color: palette.ink, flexShrink: 1 },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    paddingVertical: space.sm,
  },
  action: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: space.sm },
  link: { ...typography.control, color: palette.signal },
  muted: { ...typography.caption, color: palette.dim },
  pressed: { opacity: 0.62 },
});
