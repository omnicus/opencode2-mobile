import type { SessionInboxInfo } from "@opencode2-mobile/opencode-adapter";

import { type PromptAdmission, promptAdmissionNeedsOverlay } from "./prompt-admission-model";
import { sanitizeTranscriptText } from "./session-transcript-model";

// Fast admissions normally reach the transcript before a card can be read.
export const promptCardDelayMs = 500;

export type ExecutionPanelInput = {
  admissions: PromptAdmission[];
  inbox: SessionInboxInfo[];
  inboxDeadlines: ReadonlyMap<string, number>;
  now: number;
  projectedMessageIds: Set<string>;
};

function isUnprojectedQueuedPrompt(item: SessionInboxInfo, projectedMessageIds: Set<string>) {
  return item.type === "user" && item.delivery === "queue" && !projectedMessageIds.has(item.id);
}

export function queuedInboxIds(inbox: SessionInboxInfo[], projectedMessageIds: Set<string>) {
  return inbox
    .filter((item) => isUnprojectedQueuedPrompt(item, projectedMessageIds))
    .map((item) => item.id);
}

export function nextInboxDeadlines(current: Map<string, number>, ids: string[]) {
  if (ids.length === current.size && ids.every((id) => current.has(id))) return current;
  return new Map(ids.map((id) => [id, current.get(id) ?? Date.now() + promptCardDelayMs]));
}

function awaitsPromptCard(admission: PromptAdmission, projectedMessageIds: Set<string>) {
  return (
    admission.status !== "unknown-delivery" &&
    admission.status !== "cancelled" &&
    admission.status !== "completed" &&
    !projectedMessageIds.has(admission.id)
  );
}

export function nextPromptCardDeadline({
  admissions,
  inboxDeadlines,
  now,
  projectedMessageIds,
}: Omit<ExecutionPanelInput, "inbox">) {
  const admissionDeadlines = admissions
    .filter((admission) => awaitsPromptCard(admission, projectedMessageIds))
    .map((admission) => admission.submittedAtMs + promptCardDelayMs);
  const deadlines = [...admissionDeadlines, ...inboxDeadlines.values()].filter(
    (deadline) => deadline > now,
  );
  return deadlines.length === 0 ? undefined : Math.min(...deadlines);
}

function settlingAdmissionIds(admissions: PromptAdmission[], now: number) {
  return new Set(
    admissions
      .filter(
        (admission) =>
          admission.status !== "unknown-delivery" &&
          now < admission.submittedAtMs + promptCardDelayMs,
      )
      .map((admission) => admission.id),
  );
}

export function executionPanelItems({
  admissions,
  inbox,
  inboxDeadlines,
  now,
  projectedMessageIds,
}: ExecutionPanelInput) {
  const settling = settlingAdmissionIds(admissions, now);
  // Steering is already selected by the delivery preference. Only queued prompts
  // need persistent controls while they wait for the current execution to finish.
  const promptInbox = inbox.filter(
    (item) =>
      isUnprojectedQueuedPrompt(item, projectedMessageIds) &&
      now >= (inboxDeadlines.get(item.id) ?? Infinity) &&
      !settling.has(item.id),
  );
  const inboxIds = new Set(inbox.map((item) => item.id));
  const needsOverlay = (admission: PromptAdmission) =>
    !inboxIds.has(admission.id) &&
    promptAdmissionNeedsOverlay(admission, projectedMessageIds.has(admission.id));
  const localOverlays = admissions.filter(
    (admission) => admission.status === "unknown-delivery" && needsOverlay(admission),
  );
  const sending = admissions.some(
    (admission) =>
      admission.status === "submitting" && !settling.has(admission.id) && needsOverlay(admission),
  );
  return { localOverlays, promptInbox, sending };
}

export function inboxTypeLabel(item: SessionInboxInfo) {
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

export function boundedPromptPreview(text: string) {
  const sanitized = sanitizeTranscriptText(text);
  return sanitized.length > 2_000 ? `${sanitized.slice(0, 2_000)}\n...` : sanitized;
}
