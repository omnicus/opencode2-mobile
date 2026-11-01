import type {
  PermissionReply,
  PermissionRequest,
  SessionInboxInfo,
} from "@opencode2-mobile/opencode-adapter";
import { type ReactNode, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Button } from "../components/button";
import { useAnnouncement } from "../components/use-announcement";
import { WorkingIndicator } from "../components/working-indicator";
import { minTouchTarget, palette, radius, space, typeRamp, typography } from "../theme";
import { PermissionRequestCard } from "./permission-request-card";
import { type PromptAdmission, promptAdmissionNeedsOverlay } from "./prompt-admission-model";
import { sanitizeTranscriptText } from "./session-transcript-model";

// Fast admissions normally reach the transcript before a card can be read.
const promptCardDelayMs = 500;

export function SessionExecutionPanel({
  active,
  admissions,
  busyAction,
  canBackground = false,
  formRequests,
  hideInterrupt = false,
  hideStatus = false,
  inbox,
  onAllowRetry,
  onCancelInbox,
  onCheckAdmission,
  onInterrupt,
  onBackground,
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
  canBackground?: boolean;
  formRequests?: ReactNode;
  hideInterrupt?: boolean;
  // The session screen pins the status row to the bottom of the transcript instead.
  hideStatus?: boolean;
  inbox: SessionInboxInfo[];
  onAllowRetry: (admissionID: string) => void;
  onCancelInbox: (inboxID: string) => void;
  onCheckAdmission: (admissionID: string) => void;
  onInterrupt: () => void;
  onBackground?: () => void;
  onReplyPermission: (requestID: string, sessionID: string, reply: PermissionReply) => void;
  onSteerInbox: (inboxID: string) => void;
  permissionReplyError: boolean;
  permissions: PermissionRequest[];
  projectedMessageIds: Set<string>;
  replyingPermissionId?: string | undefined;
}) {
  const { height } = useWindowDimensions();
  const [, refreshDisplay] = useState(0);
  const [inboxDeadlines, setInboxDeadlines] = useState<Map<string, number>>(() => new Map());
  // The reply error is shared across requests, so only the card that sent the reply shows it.
  const [lastReplyId, setLastReplyId] = useState<string>();
  const now = Date.now();

  useEffect(() => {
    const ids = inbox
      .filter(
        (item) =>
          item.type === "user" && item.delivery === "queue" && !projectedMessageIds.has(item.id),
      )
      .map((item) => item.id);
    setInboxDeadlines((current) => {
      if (ids.length === current.size && ids.every((id) => current.has(id))) return current;
      return new Map(ids.map((id) => [id, current.get(id) ?? Date.now() + promptCardDelayMs]));
    });
  }, [inbox, projectedMessageIds]);

  const settlingAdmissionIds = new Set(
    admissions
      .filter(
        (admission) =>
          admission.status !== "unknown-delivery" &&
          now < admission.submittedAtMs + promptCardDelayMs,
      )
      .map((admission) => admission.id),
  );

  useEffect(() => {
    const admissionDeadlines = admissions
      .filter(
        (admission) =>
          admission.status !== "unknown-delivery" &&
          admission.status !== "cancelled" &&
          admission.status !== "completed" &&
          !projectedMessageIds.has(admission.id),
      )
      .map((admission) => admission.submittedAtMs + promptCardDelayMs);
    const deadlines = [...admissionDeadlines, ...inboxDeadlines.values()].filter(
      (deadline) => deadline > now,
    );
    if (deadlines.length === 0) return;
    const timer = setTimeout(
      () => refreshDisplay((revision) => revision + 1),
      Math.max(0, Math.min(...deadlines) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [admissions, projectedMessageIds, inboxDeadlines, now]);

  // Steering is already selected by the delivery preference. Only queued prompts
  // need persistent controls while they wait for the current execution to finish.
  const promptInbox = inbox.filter(
    (item) =>
      item.type === "user" &&
      item.delivery === "queue" &&
      !projectedMessageIds.has(item.id) &&
      now >= (inboxDeadlines.get(item.id) ?? Infinity) &&
      !settlingAdmissionIds.has(item.id),
  );
  const inboxIds = new Set(inbox.map((item) => item.id));
  const localOverlays = admissions.filter(
    (admission) =>
      admission.status === "unknown-delivery" &&
      !inboxIds.has(admission.id) &&
      promptAdmissionNeedsOverlay(admission, projectedMessageIds.has(admission.id)),
  );
  const sending = admissions.some(
    (admission) =>
      admission.status === "submitting" &&
      !inboxIds.has(admission.id) &&
      !settlingAdmissionIds.has(admission.id) &&
      promptAdmissionNeedsOverlay(admission, projectedMessageIds.has(admission.id)),
  );
  if (
    (!active || hideStatus) &&
    !sending &&
    promptInbox.length === 0 &&
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
      {active && !hideStatus ? (
        <SessionWorkingStatus
          busyAction={busyAction}
          canBackground={canBackground}
          hideInterrupt={hideInterrupt}
          onBackground={onBackground}
          onInterrupt={onInterrupt}
          waitingFor={permissions.length > 0 ? "permission" : formRequests ? "input" : undefined}
        />
      ) : null}

      {permissions.map((request) => (
        <PermissionRequestCard
          key={request.id}
          request={request}
          replying={replyingPermissionId === request.id}
          error={permissionReplyError && lastReplyId === request.id}
          onReply={(requestID, sessionID, reply) => {
            setLastReplyId(requestID);
            onReplyPermission(requestID, sessionID, reply);
          }}
        />
      ))}

      {formRequests}

      {!active && sending ? (
        <Text
          accessibilityLiveRegion="polite"
          dynamicTypeRamp={typeRamp.caption}
          style={styles.sending}
        >
          Sending
        </Text>
      ) : null}

      {localOverlays.map((admission) => (
        <View key={admission.id} style={styles.admissionCard}>
          <Text dynamicTypeRamp={typeRamp.caption} style={styles.cardEyebrow}>
            Delivery unknown
          </Text>
          <Text dynamicTypeRamp={typeRamp.control} style={styles.cardCopy}>
            {admission.kind === "command"
              ? "The server may have run this command. Check the transcript before sending it again."
              : "The server may have admitted this prompt. Check inbox and transcript state before sending it again."}
          </Text>
          <View style={styles.actionRow}>
            <Button label="Check delivery" onPress={() => onCheckAdmission(admission.id)} />
            {admission.retryOffered ? (
              <Button
                variant="danger"
                label="Allow retry (may duplicate)"
                onPress={() => onAllowRetry(admission.id)}
              />
            ) : null}
          </View>
        </View>
      ))}

      {promptInbox.map((item) => (
        <View key={item.id} style={styles.inboxCard}>
          <View style={styles.inboxHeading}>
            <Text dynamicTypeRamp={typeRamp.caption} style={styles.cardEyebrow}>
              Queued
            </Text>
            <Text dynamicTypeRamp={typeRamp.caption} style={styles.inboxType}>
              {inboxTypeLabel(item)}
            </Text>
          </View>
          {item.type === "user" ? (
            <Text dynamicTypeRamp={typeRamp.subheadline} selectable style={styles.promptPreview}>
              {boundedPromptPreview(item.payload.text)}
            </Text>
          ) : null}
          <View style={styles.actionRow}>
            <Button label="Steer now" onPress={() => onSteerInbox(item.id)} />
            <Button
              variant="danger"
              label="Cancel"
              accessibilityHint="Asks before removing the queued prompt"
              onPress={() => confirmCancelInbox(() => onCancelInbox(item.id))}
            />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function confirmCancelInbox(onConfirm: () => void) {
  Alert.alert("Cancel queued prompt?", "The prompt leaves the queue and is not sent.", [
    { style: "cancel", text: "Keep" },
    { onPress: onConfirm, style: "destructive", text: "Cancel prompt" },
  ]);
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

export function SessionWorkingStatus({
  busyAction,
  canBackground = false,
  hideInterrupt = false,
  onBackground,
  onInterrupt,
  waitingFor,
}: {
  busyAction?: "background" | "interrupt" | "wait" | undefined;
  canBackground?: boolean;
  hideInterrupt?: boolean;
  onBackground?: (() => void) | undefined;
  onInterrupt: () => void;
  waitingFor?: "permission" | "input" | undefined;
}) {
  const status =
    waitingFor === "permission"
      ? "Waiting for permission"
      : waitingFor === "input"
        ? "Waiting for input"
        : "Working";
  useAnnouncement(waitingFor && status);
  return (
    <View style={styles.executionRow}>
      <View style={styles.headingRow}>
        {waitingFor ? <View style={styles.activeDot} /> : <WorkingIndicator />}
        <Text
          accessibilityLiveRegion="polite"
          dynamicTypeRamp={typeRamp.body}
          style={styles.executionTitle}
        >
          {status}
        </Text>
      </View>
      {canBackground && onBackground && !waitingFor ? (
        <Button
          variant="text"
          label={busyAction === "background" ? "Moving to background" : "Move to background"}
          disabled={Boolean(busyAction)}
          onPress={onBackground}
        />
      ) : null}
      {!hideInterrupt ? (
        <Button
          variant="text"
          label={busyAction === "interrupt" ? "Stopping" : "Stop"}
          accessibilityHint="Interrupts the current session"
          disabled={Boolean(busyAction)}
          onPress={onInterrupt}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  cardCopy: { ...typography.subheadline, color: palette.dim },
  sending: { ...typography.caption, color: palette.dim },
  cardEyebrow: { ...typography.label, color: palette.dim },
  executionRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    justifyContent: "space-between",
    minHeight: minTouchTarget,
  },
  executionTitle: { ...typography.chatActivity, color: palette.dim, flexShrink: 1 },
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
  inboxType: { ...typography.label, color: palette.dim },
  promptPreview: { ...typography.subheadline, color: palette.ink },
  content: { gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs },
  shell: { flexGrow: 0, flexShrink: 1, maxHeight: 280 },
});
