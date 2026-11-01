import {
  classifyOpenCodeError,
  getOpenCodeSessionMessage,
  listOpenCodeSessionInbox,
  type SessionInboxInfo,
  type SessionMessageInfo,
} from "@opencode2-mobile/opencode-adapter";
import * as Haptics from "expo-haptics";
import type { SQLiteDatabase } from "expo-sqlite";
import { type Dispatch, type RefObject, type SetStateAction, useEffect } from "react";

import { deleteUnresolvedPromptAdmission } from "../storage/prompt-admission-repository";
import {
  markPromptAdmitted,
  markPromptConfirmationHandled,
  markPromptRetryOffered,
  type PromptAdmission,
  reconcilePromptAdmission,
} from "./prompt-admission-model";
import {
  currentAdmissionRevision,
  type ExecutionControlAction,
  reconcileRestoredAdmission,
  type SessionObservationInput,
  sessionObservation,
  withController,
} from "./session-execution-model";
import {
  forgetUnresolvedAdmission,
  isCurrentScope,
  notifyFeedback,
  reportForScope,
  type SessionExecutionRuntime,
} from "./use-session-execution-runtime";

type UpdateAdmissions = (update: (current: PromptAdmission[]) => PromptAdmission[]) => void;

export type AdmissionRecoveryInput = {
  admissions: PromptAdmission[];
  onAdmissionConfirmed: (draftRevision: number) => void;
  reconcile: () => Promise<void>;
  refetchMessages: () => Promise<unknown>;
  runtime: SessionExecutionRuntime;
  session: SessionObservationInput;
  updateAdmissions: UpdateAdmissions;
};

export function useExecutionScopeReset({
  controllersRef,
  executionScope,
  setBusyAction,
  setError,
  submittingRef,
}: {
  controllersRef: RefObject<Set<AbortController>>;
  executionScope: string;
  setBusyAction: Dispatch<SetStateAction<ExecutionControlAction | undefined>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  submittingRef: RefObject<boolean>;
}) {
  useEffect(() => {
    if (!executionScope) return;
    const controllers = controllersRef.current;
    submittingRef.current = false;
    setBusyAction(undefined);
    setError(undefined);
    return () => {
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, [controllersRef, executionScope, setBusyAction, setError, submittingRef]);
}

export function useRestoredAdmissionReconciliation({
  active,
  admissions,
  db,
  draftReady,
  inbox,
  messages,
  onAdmissionConfirmed,
  scopedConnectionId,
  sessionID,
  sessionIdleAtMs,
  sessionOutcome,
  updateAdmissions,
}: {
  active: boolean;
  admissions: PromptAdmission[];
  db: SQLiteDatabase;
  draftReady: boolean;
  inbox: SessionInboxInfo[];
  messages: SessionMessageInfo[];
  onAdmissionConfirmed: (draftRevision: number) => void;
  scopedConnectionId: string;
  sessionID: string;
  sessionIdleAtMs: SessionObservationInput["idleAtMs"];
  sessionOutcome: SessionObservationInput["outcome"];
  updateAdmissions: UpdateAdmissions;
}) {
  useEffect(() => {
    if (!draftReady || admissions.length === 0) return;
    const state = {
      inboxById: new Map(inbox.map((item) => [item.id, item])),
      messagesById: new Map(messages.map((message) => [message.id, message])),
      session: { active, idleAtMs: sessionIdleAtMs, outcome: sessionOutcome },
    };
    const confirmedAdmissions: PromptAdmission[] = [];
    updateAdmissions((current) =>
      current.map((admission) => {
        const result = reconcileRestoredAdmission(admission, state);
        if (result.confirmed) confirmedAdmissions.push(result.admission);
        return result.admission;
      }),
    );
    for (const admission of confirmedAdmissions) {
      forgetUnresolvedAdmission(db, scopedConnectionId, sessionID, admission.id);
      onAdmissionConfirmed(admission.draftRevision ?? 0);
    }
  }, [
    active,
    admissions,
    db,
    draftReady,
    inbox,
    messages,
    onAdmissionConfirmed,
    sessionOutcome,
    sessionIdleAtMs,
    scopedConnectionId,
    sessionID,
    updateAdmissions,
  ]);
}

export async function reconcileAdmission(input: AdmissionRecoveryInput, admissionID: string) {
  const { client, controllersRef, executionScope: requestScope, sessionID } = input.runtime;
  if (!client) return;
  input.runtime.setError(undefined);
  const admission = input.admissions.find((candidate) => candidate.id === admissionID);
  if (admission?.kind === "command") {
    await reconcileCommandAdmission(input, admissionID, requestScope);
    return;
  }
  const [inboxResult, messageResult] = await Promise.allSettled([
    withController(controllersRef.current, (signal) =>
      listOpenCodeSessionInbox(client, sessionID, { signal }),
    ),
    withController(controllersRef.current, (signal) =>
      getOpenCodeSessionMessage(client, sessionID, admissionID, { signal }),
    ),
  ]);
  if (inboxResult.status === "fulfilled" && confirmFromInbox(input, admissionID, inboxResult.value))
    return;
  if (messageResult.status === "fulfilled") {
    await confirmFromMessage(input, admissionID, messageResult.value);
    return;
  }
  reportUnresolvedAdmission(
    input,
    admissionID,
    requestScope,
    inboxResult.status === "fulfilled" &&
      classifyOpenCodeError(messageResult.reason) === "MESSAGE_NOT_FOUND",
  );
}

async function reconcileCommandAdmission(
  input: AdmissionRecoveryInput,
  admissionID: string,
  requestScope: string,
) {
  await input.reconcile();
  updateAdmission(input, admissionID, markPromptRetryOffered);
  reportForScope(
    input.runtime,
    requestScope,
    "Command delivery cannot be identified after a lost response. Check the transcript before allowing another attempt.",
  );
}

function confirmFromInbox(
  input: AdmissionRecoveryInput,
  admissionID: string,
  inbox: SessionInboxInfo[],
) {
  input.runtime.queryClient.setQueryData(input.runtime.inboxKey, inbox);
  const item = inbox.find((candidate) => candidate.id === admissionID);
  if (!item) return false;
  updateAdmission(input, admissionID, (current) =>
    markPromptConfirmationHandled(markPromptAdmitted(current, item.delivery, item.time.created)),
  );
  forgetConfirmedAdmission(input, admissionID);
  return true;
}

async function confirmFromMessage(
  input: AdmissionRecoveryInput,
  admissionID: string,
  message: SessionMessageInfo,
) {
  updateAdmission(input, admissionID, (current) =>
    markPromptConfirmationHandled(
      reconcilePromptAdmission(current, {
        messageProjected: true,
        serverAdmittedAtMs: message.time.created,
        ...sessionObservation(input.session),
      }),
    ),
  );
  forgetConfirmedAdmission(input, admissionID);
  await input.refetchMessages().catch(() => undefined);
}

function forgetConfirmedAdmission(input: AdmissionRecoveryInput, admissionID: string) {
  const { db, scopedConnectionId, sessionID } = input.runtime;
  forgetUnresolvedAdmission(db, scopedConnectionId, sessionID, admissionID);
  input.onAdmissionConfirmed(currentAdmissionRevision(input.admissions, admissionID));
}

function reportUnresolvedAdmission(
  input: AdmissionRecoveryInput,
  admissionID: string,
  requestScope: string,
  messageMissing: boolean,
) {
  reportForScope(
    input.runtime,
    requestScope,
    messageMissing
      ? "No matching server state is visible yet. Do not resend; check again after the connection settles."
      : "Delivery is still unknown. Check again after the connection recovers.",
  );
  if (messageMissing) updateAdmission(input, admissionID, markPromptRetryOffered);
}

function updateAdmission(
  input: AdmissionRecoveryInput,
  admissionID: string,
  update: (admission: PromptAdmission) => PromptAdmission,
) {
  input.updateAdmissions((current) =>
    current.map((admission) => (admission.id === admissionID ? update(admission) : admission)),
  );
}

export async function allowRetry(input: AdmissionRecoveryInput, admissionID: string) {
  const { db, executionScope: requestScope, scopedConnectionId, sessionID } = input.runtime;
  const admission = input.admissions.find((candidate) => candidate.id === admissionID);
  if (!admission?.retryOffered) return;
  try {
    await deleteUnresolvedPromptAdmission(db, scopedConnectionId, sessionID, admissionID);
    input.updateAdmissions((current) =>
      current.filter((candidate) => candidate.id !== admissionID),
    );
    if (isCurrentScope(input.runtime, requestScope)) {
      input.runtime.setError(undefined);
      notifyFeedback(Haptics.NotificationFeedbackType.Warning);
    }
  } catch {
    reportForScope(
      input.runtime,
      requestScope,
      "Retry cannot be enabled until local recovery state is saved.",
    );
  }
}
