import type {
  PermissionReply,
  PermissionRequest,
  SessionInboxInfo,
} from "@opencode2-mobile/opencode-adapter";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { WorkingIndicator } from "../components/working-indicator";
import { control, palette, radius, space, typeRamp, typography } from "../theme";
import { PermissionRequestCard } from "./permission-request-card";
import {
  type PromptAdmission,
  promptAdmissionLabel,
  promptAdmissionNeedsOverlay,
} from "./prompt-admission-model";
import { sanitizeTranscriptText } from "./session-transcript-model";

export function SessionExecutionPanel({
  active,
  admissions,
  busyAction,
  formRequests,
  inbox,
  onAllowRetry,
  onCancelInbox,
  onCheckAdmission,
  onInterrupt,
  onQueueInbox,
  onReplyPermission,
  onSteerInbox,
  permissionReplyError,
  permissions,
  projectedMessageIds,
  replyingPermissionId,
}: {
  active: boolean;
  admissions: PromptAdmission[];
  busyAction?: "background" | "interrupt" | "wait" | undefined;
  formRequests?: ReactNode;
  inbox: SessionInboxInfo[];
  onAllowRetry: (admissionID: string) => void;
  onCancelInbox: (inboxID: string) => void;
  onCheckAdmission: (admissionID: string) => void;
  onInterrupt: () => void;
  onQueueInbox: (inboxID: string) => void;
  onReplyPermission: (requestID: string, sessionID: string, reply: PermissionReply) => void;
  onSteerInbox: (inboxID: string) => void;
  permissionReplyError: boolean;
  permissions: PermissionRequest[];
  projectedMessageIds: Set<string>;
  replyingPermissionId?: string | undefined;
}) {
  const { height } = useWindowDimensions();
  const inboxIds = new Set(inbox.map((item) => item.id));
  const localOverlays = admissions.filter(
    (admission) =>
      !inboxIds.has(admission.id) &&
      promptAdmissionNeedsOverlay(admission, projectedMessageIds.has(admission.id)),
  );
  if (
    !active &&
    inbox.length === 0 &&
    localOverlays.length === 0 &&
    permissions.length === 0 &&
    !formRequests
  ) {
    return null;
  }

  return (
    <ScrollView
      accessibilityLabel="Session execution"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={[styles.shell, permissions.length > 0 && { maxHeight: height * 0.65 }]}
    >
      {active ? (
        <View style={styles.executionRow}>
          <View style={styles.headingRow}>
            {permissions.length > 0 || formRequests ? (
              <View style={styles.activeDot} />
            ) : (
              <WorkingIndicator variant="blocks" />
            )}
            <Text dynamicTypeRamp={typeRamp.control} style={styles.executionTitle}>
              {permissions.length > 0
                ? "Waiting for permission"
                : formRequests
                  ? "Waiting for input"
                  : "Working"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Interrupts the current session"
            accessibilityState={{ disabled: Boolean(busyAction) }}
            disabled={Boolean(busyAction)}
            onPress={onInterrupt}
            style={({ pressed }) => [
              styles.stopButton,
              busyAction && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text dynamicTypeRamp={typeRamp.control} style={styles.stopLabel}>
              {busyAction === "interrupt" ? "Stopping" : "Stop"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {permissions.map((request) => (
        <PermissionRequestCard
          key={request.id}
          request={request}
          replying={replyingPermissionId === request.id}
          error={permissionReplyError}
          onReply={onReplyPermission}
        />
      ))}

      {formRequests}

      {localOverlays.map((admission) => (
        <View key={admission.id} style={styles.admissionCard}>
          <Text dynamicTypeRamp={typeRamp.caption} style={styles.cardEyebrow}>
            {promptAdmissionLabel(admission.status).toUpperCase()}
          </Text>
          <Text dynamicTypeRamp={typeRamp.control} style={styles.cardCopy}>
            {admission.status === "unknown-delivery"
              ? admission.kind === "command"
                ? "The server may have run this command. Check the transcript before sending it again."
                : "The server may have admitted this prompt. Check inbox and transcript state before sending it again."
              : "Waiting for the durable inbox item or projected message."}
          </Text>
          {admission.status === "unknown-delivery" ? (
            <View style={styles.actionRow}>
              <PanelButton label="Check delivery" onPress={() => onCheckAdmission(admission.id)} />
              {admission.retryOffered ? (
                <PanelButton
                  danger
                  label="Allow retry (may duplicate)"
                  onPress={() => onAllowRetry(admission.id)}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      ))}

      {inbox.map((item) => (
        <View key={item.id} style={styles.inboxCard}>
          <View style={styles.inboxHeading}>
            <Text dynamicTypeRamp={typeRamp.caption} style={styles.cardEyebrow}>
              {item.delivery === "queue" ? "QUEUED" : "STEERING"}
            </Text>
            <Text dynamicTypeRamp={typeRamp.caption} style={styles.inboxType}>
              {inboxTypeLabel(item)}
            </Text>
          </View>
          {item.type === "user" ? (
            <Text dynamicTypeRamp={typeRamp.body} selectable style={styles.promptPreview}>
              {boundedPromptPreview(item.payload.text)}
            </Text>
          ) : null}
          <View style={styles.actionRow}>
            {item.delivery === "queue" ? (
              <PanelButton label="Steer now" onPress={() => onSteerInbox(item.id)} />
            ) : (
              <PanelButton label="Queue next" onPress={() => onQueueInbox(item.id)} />
            )}
            <PanelButton danger label="Cancel" onPress={() => onCancelInbox(item.id)} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function PanelButton({
  danger,
  disabled,
  label,
  onPress,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        danger && styles.actionButtonDanger,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text
        dynamicTypeRamp={typeRamp.control}
        style={[styles.actionLabel, danger && styles.actionLabelDanger]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function inboxTypeLabel(item: SessionInboxInfo) {
  switch (item.type) {
    case "user":
      return "Prompt";
    case "synthetic":
      return "System input";
    case "compaction":
      return "Compaction";
    case "move":
      return "Move";
  }
}

function boundedPromptPreview(text: string) {
  const sanitized = sanitizeTranscriptText(text);
  return sanitized.length > 2_000 ? `${sanitized.slice(0, 2_000)}\n...` : sanitized;
}

const styles = StyleSheet.create({
  actionButton: {
    ...control,
    alignItems: "center",
    borderColor: palette.border,
    borderWidth: 1,
    justifyContent: "center",
  },
  actionButtonDanger: { borderColor: palette.danger },
  actionLabel: { ...typography.control, color: palette.ink },
  actionLabelDanger: { color: palette.danger },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  activeDot: { backgroundColor: palette.warm, borderRadius: 99, height: 6, width: 6 },
  admissionCard: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.sm,
    padding: space.md,
  },
  cardCopy: { color: palette.dim, fontSize: 13, lineHeight: 19 },
  cardEyebrow: { ...typography.label, color: palette.warm },
  disabled: { opacity: 0.5 },
  executionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "space-between",
    paddingHorizontal: space.sm,
    minHeight: 44,
  },
  executionTitle: { color: palette.dim, flexShrink: 1, fontSize: 12 },
  stopButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  stopLabel: { color: palette.ink, fontSize: 13 },
  headingRow: { alignItems: "center", flexDirection: "row", flexShrink: 1, gap: space.sm },
  inboxCard: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.sm,
    padding: space.md,
  },
  inboxHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.xs,
    justifyContent: "space-between",
  },
  inboxType: { color: palette.dim, fontSize: 11, fontWeight: "700" },
  pressed: { opacity: 0.62 },
  promptPreview: { color: palette.ink, fontSize: 14, lineHeight: 20 },
  content: { gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs },
  shell: { flexGrow: 0, flexShrink: 1, maxHeight: 280 },
});
