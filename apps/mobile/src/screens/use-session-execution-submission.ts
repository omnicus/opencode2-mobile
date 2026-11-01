import {
  type OpenCodeClient,
  promptOpenCodeSession,
  runOpenCodeSessionCommand,
  type SessionInboxInfo,
} from "@opencode2-mobile/opencode-adapter";
import { type QueryKey, type UseMutationResult, useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import type { SQLiteDatabase } from "expo-sqlite";

import { writeUnresolvedPromptAdmission } from "../storage/prompt-admission-repository";
import {
  createPromptAdmission,
  markPromptAdmitted,
  markPromptCancelled,
  markPromptConfirmationHandled,
  markPromptDeliveryUnknown,
  markPromptRetryOffered,
  type PromptAdmission,
  type PromptDelivery,
} from "./prompt-admission-model";
import type { ComposerSubmitIntent } from "./session-composer-model";
import {
  classifySubmissionFailure,
  commandSubmissionInput,
  promptSubmissionInput,
  unresolvedPromptAdmission,
  updateAdmissionAt,
  updateAdmissionsAt,
  withController,
} from "./session-execution-model";
import {
  forgetUnresolvedAdmission,
  isCurrentScope,
  notifyFeedback,
  reportForScope,
  type SessionExecutionRuntime,
} from "./use-session-execution-runtime";

type SubmissionVariables = {
  admission: PromptAdmission;
  admissionKey: QueryKey;
  confirmAdmission: (draftRevision: number) => void;
  inboxKey: QueryKey;
  reconcileSubmission: () => Promise<void>;
  requestClient: OpenCodeClient;
  requestConnectionID: string;
  persistSubmittedDraft: (content: string, revision: number) => Promise<void>;
  requestSessionID: string;
  requestScope: string;
  text: string;
  intent: ComposerSubmitIntent;
};

type SubmissionResult = { type: "command" } | { item: SessionInboxInfo; type: "inbox" };

export type SubmitInput = {
  active: boolean;
  delivery: PromptDelivery;
  draftReady: boolean;
  draftRevision: number;
  executionStateReady: boolean;
  onAdmissionConfirmed: (draftRevision: number) => void;
  persistDraft: (content: string, revision: number) => Promise<void>;
  preferences: { busy: boolean };
  reconcile: () => Promise<void>;
  runtime: SessionExecutionRuntime;
  submissionMutation: UseMutationResult<SubmissionResult, Error, SubmissionVariables>;
  unresolvedAdmission: boolean;
  updateAdmissions: (update: (current: PromptAdmission[]) => PromptAdmission[]) => void;
};

export function useSubmissionMutation(
  runtime: SessionExecutionRuntime,
  reconcile: () => Promise<void>,
) {
  return useMutation({
    mutationFn: (variables: SubmissionVariables) => transmitSubmission(runtime, variables),
    networkMode: "always",
    onError: (caught, variables) => handleSubmissionError(runtime, caught, variables),
    onSettled: () => {
      runtime.submittingRef.current = false;
    },
    onSuccess: (result, variables) =>
      handleSubmissionSuccess(runtime, reconcile, result, variables),
  });
}

export function submitIntent(
  input: SubmitInput,
  text: string,
  intent: ComposerSubmitIntent = { type: "prompt" },
) {
  const { runtime } = input;
  if (!runtime.client || submissionBlocked(input)) return;
  runtime.submittingRef.current = true;
  const admission = {
    ...createPromptAdmission(input.active ? input.delivery : "steer"),
    ...(intent.type === "prompt" ? { previewText: text } : {}),
    draftRevision: input.draftRevision,
    kind: intent.type,
  };
  input.updateAdmissions((current) => [...current, admission]);
  input.submissionMutation.mutate({
    admission,
    admissionKey: runtime.admissionKey,
    confirmAdmission: input.onAdmissionConfirmed,
    inboxKey: runtime.inboxKey,
    persistSubmittedDraft: input.persistDraft,
    reconcileSubmission: input.reconcile,
    requestClient: runtime.client,
    requestConnectionID: runtime.scopedConnectionId,
    requestSessionID: runtime.sessionID,
    requestScope: runtime.executionScope,
    text,
    intent,
  });
}

function submissionBlocked(input: SubmitInput) {
  return (
    !input.draftReady ||
    !input.executionStateReady ||
    input.preferences.busy ||
    input.runtime.submittingRef.current ||
    input.submissionMutation.isPending ||
    input.unresolvedAdmission
  );
}

async function transmitSubmission(
  runtime: SessionExecutionRuntime,
  variables: SubmissionVariables,
): Promise<SubmissionResult> {
  return withController(runtime.controllersRef.current, async (signal) => {
    await persistSubmittedDraft(variables);
    if (signal.aborted) throw new Error("PROMPT_CANCELLED_BEFORE_SEND");
    await persistUnresolvedSubmission(runtime.db, variables);
    return sendSubmission(variables, signal);
  });
}

async function persistSubmittedDraft({
  admission,
  persistSubmittedDraft,
  text,
}: SubmissionVariables) {
  if (admission.draftRevision === undefined) {
    throw new Error("PROMPT_ADMISSION_PERSISTENCE_FAILED");
  }
  try {
    await persistSubmittedDraft(text, admission.draftRevision);
  } catch (caught) {
    if (caught instanceof Error && caught.message === "DRAFT_CHANGED_BEFORE_SEND") {
      throw caught;
    }
    throw new Error("PROMPT_ADMISSION_PERSISTENCE_FAILED");
  }
}

async function persistUnresolvedSubmission(
  db: SQLiteDatabase,
  { admission, requestConnectionID, requestSessionID }: SubmissionVariables,
) {
  try {
    await writeUnresolvedPromptAdmission(
      db,
      requestConnectionID,
      requestSessionID,
      unresolvedPromptAdmission(admission),
    );
  } catch {
    throw new Error("PROMPT_ADMISSION_PERSISTENCE_FAILED");
  }
}

async function sendSubmission(
  { admission, intent, requestClient, requestSessionID, text }: SubmissionVariables,
  signal: AbortSignal,
): Promise<SubmissionResult> {
  if (intent.type === "command") {
    await runOpenCodeSessionCommand(
      requestClient,
      requestSessionID,
      commandSubmissionInput(intent, admission),
      { signal },
    );
    return { type: "command" };
  }
  const item = await promptOpenCodeSession(
    requestClient,
    requestSessionID,
    promptSubmissionInput(intent, admission, text),
    { signal },
  );
  return { item, type: "inbox" };
}

function handleSubmissionError(
  runtime: SessionExecutionRuntime,
  caught: unknown,
  {
    admission,
    admissionKey,
    reconcileSubmission,
    requestConnectionID,
    requestSessionID,
    requestScope,
    intent,
  }: SubmissionVariables,
) {
  const scopeIsCurrent = isCurrentScope(runtime, requestScope);
  const failure = classifySubmissionFailure(caught, intent);
  updateAdmissionAt(
    runtime.queryClient,
    admissionKey,
    admission.id,
    failure.type === "unknown"
      ? (current) => markSubmissionUnknown(current, intent)
      : markPromptCancelled,
  );
  if (failure.type === "rejected") {
    forgetUnresolvedAdmission(runtime.db, requestConnectionID, requestSessionID, admission.id);
  }
  if (scopeIsCurrent && failure.error !== undefined) runtime.setError(failure.error);
  if (failure.type === "unknown") void reconcileSubmission();
}

function markSubmissionUnknown(admission: PromptAdmission, intent: ComposerSubmitIntent) {
  const unknown = markPromptDeliveryUnknown(admission);
  return intent.type === "command" ? markPromptRetryOffered(unknown) : unknown;
}

function handleSubmissionSuccess(
  runtime: SessionExecutionRuntime,
  reconcile: () => Promise<void>,
  result: SubmissionResult,
  variables: SubmissionVariables,
) {
  if (result.type === "command") {
    confirmCommandSubmission(runtime, reconcile, variables);
    return;
  }
  confirmPromptSubmission(runtime, result.item, variables);
}

function confirmCommandSubmission(
  runtime: SessionExecutionRuntime,
  reconcile: () => Promise<void>,
  {
    admission,
    admissionKey,
    confirmAdmission,
    requestConnectionID,
    requestSessionID,
    requestScope,
  }: SubmissionVariables,
) {
  updateAdmissionsAt(runtime.queryClient, admissionKey, (current) =>
    current.filter((candidate) => candidate.id !== admission.id),
  );
  forgetUnresolvedAdmission(runtime.db, requestConnectionID, requestSessionID, admission.id);
  reportForScope(runtime, requestScope, undefined);
  confirmAdmission(admission.draftRevision ?? 0);
  void reconcile();
  notifyFeedback(Haptics.NotificationFeedbackType.Success);
}

function confirmPromptSubmission(
  runtime: SessionExecutionRuntime,
  item: SessionInboxInfo,
  {
    admission,
    admissionKey,
    confirmAdmission,
    inboxKey,
    requestConnectionID,
    requestSessionID,
    requestScope,
  }: SubmissionVariables,
) {
  updateAdmissionAt(runtime.queryClient, admissionKey, admission.id, (current) =>
    markPromptConfirmationHandled(markPromptAdmitted(current, item.delivery, item.time.created)),
  );
  runtime.queryClient.setQueryData<SessionInboxInfo[]>(inboxKey, (current = []) => [
    item,
    ...current.filter((candidate) => candidate.id !== item.id),
  ]);
  forgetUnresolvedAdmission(runtime.db, requestConnectionID, requestSessionID, admission.id);
  reportForScope(runtime, requestScope, undefined);
  confirmAdmission(admission.draftRevision ?? 0);
  notifyFeedback(Haptics.NotificationFeedbackType.Success);
}
