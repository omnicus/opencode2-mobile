import type {
  PermissionReply,
  PermissionRequest,
  SessionInboxInfo,
} from "@opencode2-mobile/opencode-adapter";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { palette, radius, space, typeRamp } from "../theme";
import { permissionActionExplanation } from "./permission-presentation";
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
      style={styles.shell}
    >
      {active ? (
        <View style={styles.executionCard}>
          <View style={styles.headingRow}>
            <View style={styles.activeDot} />
            <Text dynamicTypeRamp={typeRamp.control} style={styles.executionTitle}>
              {permissions.length > 0 ? "Waiting for permission" : "OpenCode is working"}
            </Text>
          </View>
          <View style={styles.actionRow}>
            <PanelButton
              danger
              disabled={Boolean(busyAction)}
              label={busyAction === "interrupt" ? "Stopping" : "Stop"}
              onPress={onInterrupt}
            />
          </View>
        </View>
      ) : null}

      {permissions.map((request) => {
        const replying = replyingPermissionId === request.id;
        const explanation = permissionActionExplanation(request.action);
        return (
          <View key={request.id} style={styles.permissionCard}>
            <Text dynamicTypeRamp={typeRamp.caption} style={styles.cardEyebrow}>
              PERMISSION REQUIRED
            </Text>
            <Text dynamicTypeRamp={typeRamp.subheading} style={styles.permissionAction}>
              {sanitizeTranscriptText(request.action, 256)}
            </Text>
            {request.resources.map((resource) => (
              <Text
                dynamicTypeRamp={typeRamp.control}
                key={resource}
                selectable
                style={styles.permissionResource}
              >
                {sanitizeTranscriptText(resource, 1_024)}
              </Text>
            ))}
            {request.save?.map((pattern) => (
              <Text
                dynamicTypeRamp={typeRamp.control}
                key={pattern}
                selectable
                style={styles.permissionResource}
              >
                Save pattern: {sanitizeTranscriptText(pattern, 1_024)}
              </Text>
            ))}
            {explanation ? (
              <View style={styles.permissionExplanation}>
                <Text dynamicTypeRamp={typeRamp.caption} style={styles.permissionExplanationLabel}>
                  OPENCODE MOBILE EXPLANATION
                </Text>
                <Text dynamicTypeRamp={typeRamp.control} style={styles.cardCopy}>
                  {explanation}
                </Text>
              </View>
            ) : null}
            {request.save && request.save.length > 0 ? (
              <Text dynamicTypeRamp={typeRamp.caption} style={styles.permissionWarning}>
                Always allow may save {request.save.length} broader permission
                {request.save.length === 1 ? "" : "s"}. Reject may also reject other pending
                permission requests in this session.
              </Text>
            ) : (
              <Text dynamicTypeRamp={typeRamp.caption} style={styles.permissionWarning}>
                Reject may also reject other pending permission requests in this session.
              </Text>
            )}
            {permissionReplyError ? (
              <Text accessibilityRole="alert" style={styles.permissionError}>
                The permission reply was not accepted. The request has been reloaded.
              </Text>
            ) : null}
            <View style={styles.actionRow}>
              <PanelButton
                disabled={replying}
                label={replying ? "Replying" : "Allow once"}
                onPress={() => onReplyPermission(request.id, request.sessionID, "once")}
              />
              <PanelButton
                disabled={replying}
                label="Always allow"
                onPress={() => onReplyPermission(request.id, request.sessionID, "always")}
              />
              <PanelButton
                danger
                disabled={replying}
                label="Reject"
                onPress={() => onReplyPermission(request.id, request.sessionID, "reject")}
              />
            </View>
          </View>
        );
      })}

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
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: space.sm,
  },
  actionButtonDanger: { borderColor: palette.danger },
  actionLabel: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  actionLabelDanger: { color: palette.danger },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  activeDot: { backgroundColor: palette.signal, borderRadius: 99, height: 8, width: 8 },
  admissionCard: {
    backgroundColor: "#211B11",
    borderColor: palette.warm,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.sm,
    padding: space.md,
  },
  cardCopy: { color: palette.dim, fontSize: 13, lineHeight: 19 },
  cardEyebrow: { color: palette.warm, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  disabled: { opacity: 0.5 },
  executionCard: {
    alignItems: "center",
    backgroundColor: palette.signalDark,
    borderColor: palette.signal,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "space-between",
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  executionTitle: { color: palette.signal, fontSize: 14, fontWeight: "800" },
  headingRow: { alignItems: "center", flexDirection: "row", flexShrink: 1, gap: space.sm },
  inboxCard: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.sm,
    padding: space.md,
  },
  inboxHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  inboxType: { color: palette.dim, fontSize: 11, fontWeight: "700" },
  pressed: { opacity: 0.62 },
  permissionAction: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  permissionCard: {
    backgroundColor: "#211B11",
    borderColor: palette.warm,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.sm,
    padding: space.md,
  },
  permissionError: { color: palette.danger, fontSize: 13, lineHeight: 18 },
  permissionExplanation: { gap: 2 },
  permissionExplanationLabel: {
    color: palette.dim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  permissionResource: {
    backgroundColor: palette.background,
    borderRadius: radius.sm,
    color: palette.ink,
    fontSize: 13,
    padding: space.sm,
  },
  permissionWarning: { color: palette.warm, fontSize: 12, lineHeight: 17 },
  promptPreview: { color: palette.ink, fontSize: 14, lineHeight: 20 },
  content: { gap: space.sm, padding: space.md },
  shell: { flexGrow: 0, flexShrink: 1, maxHeight: 280 },
});
