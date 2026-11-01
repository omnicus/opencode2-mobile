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
import type { PromptAdmission } from "./prompt-admission-model";
import {
  boundedPromptPreview,
  executionPanelItems,
  inboxTypeLabel,
  nextInboxDeadlines,
  nextPromptCardDeadline,
  queuedInboxIds,
} from "./session-execution-panel-model";

function usePromptCardDeadlines(
  admissions: PromptAdmission[],
  inbox: SessionInboxInfo[],
  projectedMessageIds: Set<string>,
) {
  const [, refreshDisplay] = useState(0);
  const [inboxDeadlines, setInboxDeadlines] = useState<Map<string, number>>(() => new Map());
  const now = Date.now();

  useEffect(() => {
    const ids = queuedInboxIds(inbox, projectedMessageIds);
    setInboxDeadlines((current) => nextInboxDeadlines(current, ids));
  }, [inbox, projectedMessageIds]);

  useEffect(() => {
    const deadline = nextPromptCardDeadline({
      admissions,
      inboxDeadlines,
      now,
      projectedMessageIds,
    });
    if (deadline === undefined) return;
    const timer = setTimeout(
      () => refreshDisplay((revision) => revision + 1),
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [admissions, projectedMessageIds, inboxDeadlines, now]);

  return { inboxDeadlines, now };
}

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
  failedPermissionReplyId,
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
  failedPermissionReplyId?: string | undefined;
  permissions: PermissionRequest[];
  projectedMessageIds: Set<string>;
  replyingPermissionId?: string | undefined;
}) {
  const { height } = useWindowDimensions();
  const { inboxDeadlines, now } = usePromptCardDeadlines(admissions, inbox, projectedMessageIds);
  const { localOverlays, promptInbox, sending } = executionPanelItems({
    admissions,
    inbox,
    inboxDeadlines,
    now,
    projectedMessageIds,
  });
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
          error={failedPermissionReplyId === request.id}
          onReply={onReplyPermission}
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
        <UnknownDeliveryCard
          key={admission.id}
          admission={admission}
          onAllowRetry={onAllowRetry}
          onCheckAdmission={onCheckAdmission}
        />
      ))}

      {promptInbox.map((item) => (
        <QueuedInboxCard
          key={item.id}
          item={item}
          onCancelInbox={onCancelInbox}
          onSteerInbox={onSteerInbox}
        />
      ))}
    </ScrollView>
  );
}

function UnknownDeliveryCard({
  admission,
  onAllowRetry,
  onCheckAdmission,
}: {
  admission: PromptAdmission;
  onAllowRetry: (admissionID: string) => void;
  onCheckAdmission: (admissionID: string) => void;
}) {
  return (
    <View style={styles.admissionCard}>
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
  );
}

function QueuedInboxCard({
  item,
  onCancelInbox,
  onSteerInbox,
}: {
  item: SessionInboxInfo;
  onCancelInbox: (inboxID: string) => void;
  onSteerInbox: (inboxID: string) => void;
}) {
  return (
    <View style={styles.inboxCard}>
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
  );
}

function confirmCancelInbox(onConfirm: () => void) {
  Alert.alert("Cancel queued prompt?", "The prompt leaves the queue and is not sent.", [
    { style: "cancel", text: "Keep" },
    { onPress: onConfirm, style: "destructive", text: "Cancel prompt" },
  ]);
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
