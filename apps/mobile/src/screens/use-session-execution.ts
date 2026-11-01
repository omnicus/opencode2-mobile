import type {
  LocationRef,
  OpenCodeClient,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode2-mobile/opencode-adapter";
import { useCallback } from "react";

import { type PromptAdmission, pendingPromptPreviews } from "./prompt-admission-model";
import type { ComposerSubmitIntent } from "./session-composer-model";
import { hasUnresolvedAdmission, updateAdmissionsAt } from "./session-execution-model";
import {
  executionCommands,
  useControlMutation,
  useInboxMutation,
  useSwitchAgentMutation,
  useSwitchModelMutation,
} from "./use-session-execution-controls";
import {
  executionActivity,
  executionAgents,
  executionCatalog,
  reconcileExecution,
  useSessionExecutionQueries,
} from "./use-session-execution-queries";
import {
  allowRetry,
  reconcileAdmission,
  useExecutionScopeReset,
  useRestoredAdmissionReconciliation,
} from "./use-session-execution-recovery";
import { useSessionExecutionRuntime } from "./use-session-execution-runtime";
import { submitIntent, useSubmissionMutation } from "./use-session-execution-submission";

export { resolveSessionAgent } from "./session-execution-model";

type SessionExecutionOptions = {
  client: OpenCodeClient | undefined;
  connectionId: string | undefined;
  draftReady: boolean;
  draftRevision: number;
  location: LocationRef;
  messages: SessionMessageInfo[];
  onAdmissionConfirmed: (draftRevision: number) => void;
  persistDraft: (content: string, revision: number) => Promise<void>;
  refetchMessages: () => Promise<unknown>;
  routeConnectionId: string;
  session: SessionInfo | undefined;
  sessionID: string;
};

export function useSessionExecution({
  client,
  connectionId,
  draftReady,
  draftRevision,
  location,
  messages,
  onAdmissionConfirmed,
  persistDraft,
  refetchMessages,
  routeConnectionId,
  session,
  sessionID,
}: SessionExecutionOptions) {
  const { busyAction, error, preferences, runtime } = useSessionExecutionRuntime({
    client,
    connectionId,
    location,
    routeConnectionId,
    sessionID,
  });
  const { admissionKey, enabled, queryClient } = runtime;
  const delivery = preferences.defaultDelivery ?? "steer";
  const queries = useSessionExecutionQueries(runtime, location);
  const { active, admissions, canBackground, executionStateReady, inbox } = executionActivity(
    queries,
    { enabled, messages, sessionID },
  );
  const projectedMessageIds = new Set(messages.map((message) => message.id));
  const unresolvedAdmission = hasUnresolvedAdmission(admissions);
  const { agents, models, selectedAgent, selectedModel } = executionAgents(queries, session);
  const catalog = executionCatalog(queries);
  const sessionState = { active, idleAtMs: session?.time.idle, outcome: session?.outcome };

  const updateAdmissions = useCallback(
    (update: (current: PromptAdmission[]) => PromptAdmission[]) => {
      updateAdmissionsAt(queryClient, admissionKey, update);
    },
    [admissionKey, queryClient],
  );

  useExecutionScopeReset(runtime);
  useRestoredAdmissionReconciliation({
    active,
    admissions,
    db: runtime.db,
    draftReady,
    inbox,
    messages,
    onAdmissionConfirmed,
    scopedConnectionId: runtime.scopedConnectionId,
    sessionID,
    sessionIdleAtMs: sessionState.idleAtMs,
    sessionOutcome: sessionState.outcome,
    updateAdmissions,
  });

  const reconcile = () => reconcileExecution(queries, refetchMessages);
  const submissionMutation = useSubmissionMutation(runtime, reconcile);
  const switchAgentMutation = useSwitchAgentMutation(runtime);
  const switchModelMutation = useSwitchModelMutation(runtime);
  const inboxMutation = useInboxMutation(runtime, queries.inboxQuery);
  const controlMutation = useControlMutation(runtime, reconcile);
  const recovery = {
    admissions,
    onAdmissionConfirmed,
    reconcile,
    refetchMessages,
    runtime,
    session: sessionState,
    updateAdmissions,
  };
  const commands = executionCommands({
    busyAction,
    canBackground,
    controlMutation,
    inboxMutation,
    runtime,
    switchAgentMutation,
    switchModelMutation,
  });

  return {
    pendingPrompts: enabled ? pendingPromptPreviews(admissions, inbox, projectedMessageIds) : [],
    active,
    activeSessions: activeSessions(enabled, queries.activeSessionsQuery),
    canBackground,
    allowRetry: (admissionID: string) => void allowRetry(recovery, admissionID),
    admissions,
    agents,
    busyAction,
    commands: catalog.commands,
    completionLoading: catalog.completionLoading,
    completionUnavailable: catalog.completionUnavailable,
    agentCatalog: catalog.agentCatalog,
    modelCatalog: catalog.modelCatalog,
    defaultModel: catalog.defaultModel,
    delivery,
    error,
    inbox,
    models,
    mentionAgents: catalog.mentionAgents,
    mentionLoading: catalog.mentionLoading,
    mentionUnavailable: catalog.mentionUnavailable,
    projectedMessageIds,
    submit: (text: string, intent?: ComposerSubmitIntent) =>
      submitIntent(
        {
          active,
          delivery,
          draftReady,
          draftRevision,
          executionStateReady,
          onAdmissionConfirmed,
          persistDraft,
          preferences,
          reconcile,
          runtime,
          submissionMutation,
          unresolvedAdmission,
          updateAdmissions,
        },
        text,
        intent,
      ),
    submitDisabled: isSubmitDisabled(
      [submissionMutation, switchAgentMutation, switchModelMutation],
      queries.admissionsQuery,
      { busy: preferences.busy, draftReady, enabled, executionStateReady, unresolvedAdmission },
    ),
    skills: catalog.skills,
    switchAgent: commands.switchAgent,
    switchModel: commands.switchModel,
    cancelInbox: commands.cancelInbox,
    queueInbox: commands.queueInbox,
    steerInbox: commands.steerInbox,
    interrupt: commands.interrupt,
    background: commands.background,
    wait: commands.wait,
    reconcileAdmission: (admissionID: string) => void reconcileAdmission(recovery, admissionID),
    selectedAgent,
    selectedModel,
  };
}

function activeSessions<T>(enabled: boolean, query: { data: T | undefined; isError: boolean }) {
  return enabled && !query.isError ? query.data : undefined;
}

function isSubmitDisabled(
  mutations: { isPending: boolean }[],
  admissionsQuery: { isSuccess: boolean },
  {
    busy,
    draftReady,
    enabled,
    executionStateReady,
    unresolvedAdmission,
  }: {
    busy: boolean;
    draftReady: boolean;
    enabled: boolean;
    executionStateReady: boolean;
    unresolvedAdmission: boolean;
  },
) {
  return (
    mutations.some((mutation) => mutation.isPending) ||
    unresolvedAdmission ||
    busy ||
    !executionStateReady ||
    !admissionsQuery.isSuccess ||
    !draftReady ||
    !enabled
  );
}
