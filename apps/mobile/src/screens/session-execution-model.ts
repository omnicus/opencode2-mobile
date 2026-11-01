import {
  classifyOpenCodeError,
  type SessionInboxInfo,
  type SessionInfo,
  type SessionMessageInfo,
} from "@opencode2-mobile/opencode-adapter";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import {
  markPromptConfirmationHandled,
  type PromptAdmission,
  reconcilePromptAdmission,
} from "./prompt-admission-model";
import type { ComposerSubmitIntent } from "./session-composer-model";

export type ExecutionControlAction = "background" | "interrupt" | "wait";
export type InboxAction = "cancel" | "queue" | "steer";

export type SessionObservationInput = {
  active: boolean;
  idleAtMs: number | undefined;
  outcome: SessionInfo["outcome"];
};

export type RestoredAdmissionState = {
  inboxById: ReadonlyMap<string, SessionInboxInfo>;
  messagesById: ReadonlyMap<string, SessionMessageInfo>;
  session: SessionObservationInput;
};

export type SubmissionFailure = {
  error: string | undefined;
  type: "cancelled" | "rejected" | "unknown";
};

const localSubmissionErrors = new Map<string, string | undefined>([
  ["DRAFT_CHANGED_BEFORE_SEND", "The draft changed before transmission. Review it and send again."],
  ["PROMPT_CANCELLED_BEFORE_SEND", undefined],
  [
    "PROMPT_ADMISSION_PERSISTENCE_FAILED",
    "The submission could not be saved safely and was not sent.",
  ],
]);

const rejectedClassifications = new Set<string>(["INVALID_REQUEST", "NOT_FOUND", "UNAUTHORIZED"]);

const rejectedSubmissionErrors: Record<ComposerSubmitIntent["type"], string> = {
  command: "The server rejected this command.",
  prompt: "The server rejected this prompt before admission.",
};

const lostSubmissionErrors: Record<ComposerSubmitIntent["type"], string> = {
  command:
    "The response was lost. The command may have run; check the transcript before sending again.",
  prompt:
    "The response was lost. The prompt may have been admitted; check delivery before sending again.",
};

export function resolveSessionAgent(
  sessionAgent: string | undefined,
  configuredDefault: string | null | undefined,
  availableAgentIDs: readonly string[],
) {
  if (sessionAgent) return sessionAgent;
  if (configuredDefault && availableAgentIDs.includes(configuredDefault)) return configuredDefault;
  if (availableAgentIDs.includes("build")) return "build";
  return availableAgentIDs[0];
}

export function primaryAgents<T extends { hidden?: boolean; mode?: string }>(agents: T[]) {
  return agents.filter((candidate) => !candidate.hidden && candidate.mode !== "subagent");
}

export function mentionableAgents<T extends { hidden?: boolean; mode?: string }>(agents: T[]) {
  return agents.filter((candidate) => !candidate.hidden && candidate.mode !== "primary");
}

export function selectableModels<T extends { enabled: boolean; status?: string }>(models: T[]) {
  return models.filter((candidate) => candidate.enabled && candidate.status !== "deprecated");
}

export function modelRef(model: { id: string; providerID: string } | null | undefined) {
  return model ? { id: model.id, providerID: model.providerID } : undefined;
}

export async function withController<T>(
  controllers: Set<AbortController>,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  controllers.add(controller);
  try {
    return await operation(controller.signal);
  } finally {
    controllers.delete(controller);
  }
}

export function updateAdmissionsAt(
  queryClient: QueryClient,
  queryKey: QueryKey,
  update: (current: PromptAdmission[]) => PromptAdmission[],
) {
  queryClient.setQueryData<PromptAdmission[]>(queryKey, (current = []) => {
    const next = update(current);
    if (
      next.length === current.length &&
      next.every((admission, index) => admission === current[index])
    ) {
      return current;
    }
    return next.slice(-20);
  });
}

export function updateAdmissionAt(
  queryClient: QueryClient,
  queryKey: QueryKey,
  admissionID: string,
  update: (admission: PromptAdmission) => PromptAdmission,
) {
  updateAdmissionsAt(queryClient, queryKey, (current) =>
    current.map((admission) => (admission.id === admissionID ? update(admission) : admission)),
  );
}

export function currentAdmissionRevision(admissions: PromptAdmission[], admissionID: string) {
  return admissions.find((admission) => admission.id === admissionID)?.draftRevision ?? 0;
}

export function hasUnresolvedAdmission(admissions: readonly PromptAdmission[]) {
  return admissions.some(
    (admission) => admission.status === "submitting" || admission.status === "unknown-delivery",
  );
}

export function unresolvedPromptAdmission(admission: PromptAdmission) {
  if (admission.draftRevision === undefined) {
    throw new Error("PROMPT_ADMISSION_PERSISTENCE_FAILED");
  }
  return {
    ...(admission.delivery ? { delivery: admission.delivery } : {}),
    draftRevision: admission.draftRevision,
    durable: false as const,
    id: admission.id,
    kind: admission.kind,
    status:
      admission.status === "submitting" ? ("submitting" as const) : ("unknown-delivery" as const),
    submittedAtMs: admission.submittedAtMs,
  };
}

export function sessionObservation({ active, idleAtMs, outcome }: SessionObservationInput) {
  return {
    ...(idleAtMs === undefined ? {} : { sessionIdleAtMs: idleAtMs }),
    ...(outcome ? { sessionOutcome: outcome } : {}),
    sessionRunning: active,
  };
}

export function reconcileRestoredAdmission(
  admission: PromptAdmission,
  state: RestoredAdmissionState,
) {
  if (admission.kind === "command") return { admission, confirmed: false };
  const inboxItem = state.inboxById.get(admission.id);
  const projectedMessage = state.messagesById.get(admission.id);
  const serverAdmittedAtMs = inboxItem?.time.created ?? projectedMessage?.time.created;
  let next = reconcilePromptAdmission(admission, {
    ...(inboxItem ? { inboxDelivery: inboxItem.delivery } : {}),
    messageProjected: state.messagesById.has(admission.id),
    ...(serverAdmittedAtMs === undefined ? {} : { serverAdmittedAtMs }),
    ...sessionObservation(state.session),
  });
  if (projectedMessage && next.previewText !== undefined) {
    next = { ...next };
    delete next.previewText;
  }
  if (!needsRestoredConfirmation(next, state)) return { admission: next, confirmed: false };
  return { admission: markPromptConfirmationHandled(next), confirmed: true };
}

function needsRestoredConfirmation(admission: PromptAdmission, state: RestoredAdmissionState) {
  return (
    admission.durable &&
    !admission.confirmationHandled &&
    (state.inboxById.has(admission.id) || state.messagesById.has(admission.id))
  );
}

export function classifySubmissionFailure(
  caught: unknown,
  intent: ComposerSubmitIntent,
): SubmissionFailure {
  if (caught instanceof Error && localSubmissionErrors.has(caught.message)) {
    return { error: localSubmissionErrors.get(caught.message), type: "cancelled" };
  }
  const classification = classifyOpenCodeError(caught);
  if (rejectedClassifications.has(classification)) {
    return { error: rejectedSubmissionErrors[intent.type], type: "rejected" };
  }
  return {
    error:
      classification === "CONFLICT"
        ? `The server reported a ${intent.type} conflict. Check delivery before sending again.`
        : lostSubmissionErrors[intent.type],
    type: "unknown",
  };
}

export function commandSubmissionInput(
  intent: Extract<ComposerSubmitIntent, { type: "command" }>,
  admission: PromptAdmission,
) {
  return {
    ...(intent.agents ? { agents: intent.agents } : {}),
    command: intent.command,
    delivery: admission.delivery ?? "steer",
    ...(intent.files ? { files: intent.files } : {}),
    ...(intent.skills ? { skills: intent.skills } : {}),
    text: intent.arguments ?? "",
  };
}

export function promptSubmissionInput(
  intent: ComposerSubmitIntent,
  admission: PromptAdmission,
  text: string,
) {
  return {
    delivery: admission.delivery ?? "steer",
    ...(intent.agents ? { agents: intent.agents } : {}),
    ...(intent.files ? { files: intent.files } : {}),
    id: admission.id,
    resume: true,
    ...(intent.skills ? { skills: intent.skills } : {}),
    text,
  };
}

export function applyInboxAction(
  current: SessionInboxInfo[],
  action: InboxAction,
  inboxID: string,
): SessionInboxInfo[] {
  if (action === "cancel") return current.filter((item) => item.id !== inboxID);
  return current.map((item) => (item.id === inboxID ? { ...item, delivery: action } : item));
}
