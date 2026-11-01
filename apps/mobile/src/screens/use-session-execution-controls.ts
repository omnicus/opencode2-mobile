import {
  backgroundOpenCodeSession,
  cancelOpenCodeSessionInboxItem,
  interruptOpenCodeSession,
  type ModelRef,
  type OpenCodeClient,
  queueOpenCodeSessionInboxItem,
  type SessionInboxInfo,
  type SessionInfo,
  steerOpenCodeSessionInboxItem,
  switchOpenCodeSessionAgent,
  switchOpenCodeSessionModel,
  waitForOpenCodeSession,
} from "@opencode2-mobile/opencode-adapter";
import { type QueryKey, type UseMutationResult, useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { markPromptCancelled, markPromptInterrupted } from "./prompt-admission-model";
import {
  applyInboxAction,
  type ExecutionControlAction,
  type InboxAction,
  updateAdmissionAt,
  updateAdmissionsAt,
  withController,
} from "./session-execution-model";
import {
  isCurrentScope,
  notifyFeedback,
  notifySelection,
  reportForScope,
  type SessionExecutionRuntime,
} from "./use-session-execution-runtime";

type RequestOptions = { signal: AbortSignal };

type SessionSettingVariables<T> = {
  requestClient: OpenCodeClient;
  requestScope: string;
  requestSessionID: string;
  requestSessionKey: QueryKey;
  value: T;
};

type InboxVariables = {
  action: InboxAction;
  inboxID: string;
  requestAdmissionKey: QueryKey;
  requestClient: OpenCodeClient;
  requestInboxKey: QueryKey;
  requestScope: string;
  requestSessionID: string;
};

type ControlVariables = {
  action: ExecutionControlAction;
  requestAdmissionKey: QueryKey;
  requestClient: OpenCodeClient;
  requestScope: string;
  requestSessionID: string;
};

const inboxRequests: Record<
  InboxAction,
  (
    client: OpenCodeClient,
    sessionID: string,
    inboxID: string,
    options: RequestOptions,
  ) => Promise<unknown>
> = {
  cancel: cancelOpenCodeSessionInboxItem,
  queue: queueOpenCodeSessionInboxItem,
  steer: steerOpenCodeSessionInboxItem,
};

const controlRequests: Record<
  ExecutionControlAction,
  (client: OpenCodeClient, sessionID: string, options: RequestOptions) => Promise<unknown>
> = {
  background: backgroundOpenCodeSession,
  interrupt: (client, sessionID, options) =>
    interruptOpenCodeSession(client, sessionID, false, options),
  wait: waitForOpenCodeSession,
};

export function useSwitchAgentMutation(runtime: SessionExecutionRuntime) {
  return useSessionSettingMutation(
    runtime,
    switchOpenCodeSessionAgent,
    (session, agent: string) => ({ ...session, agent }),
    "The session agent could not be changed.",
  );
}

export function useSwitchModelMutation(runtime: SessionExecutionRuntime) {
  return useSessionSettingMutation(
    runtime,
    switchOpenCodeSessionModel,
    (session, model: ModelRef) => ({ ...session, model }),
    "The session model could not be changed.",
  );
}

function useSessionSettingMutation<T>(
  runtime: SessionExecutionRuntime,
  request: (
    client: OpenCodeClient,
    sessionID: string,
    value: T,
    options: RequestOptions,
  ) => Promise<unknown>,
  apply: (session: SessionInfo, value: T) => SessionInfo,
  failure: string,
) {
  return useMutation({
    mutationFn: async ({ requestClient, requestSessionID, value }: SessionSettingVariables<T>) => {
      await withController(runtime.controllersRef.current, (signal) =>
        request(requestClient, requestSessionID, value, { signal }),
      );
      return value;
    },
    onError: (_caught, { requestScope }) => reportForScope(runtime, requestScope, failure),
    onSuccess: (value, { requestScope, requestSessionKey }) => {
      runtime.queryClient.setQueryData<SessionInfo>(requestSessionKey, (current) =>
        current ? apply(current, value) : current,
      );
      reportForScope(runtime, requestScope, undefined);
      notifySelection();
    },
  });
}

export function useInboxMutation(
  runtime: SessionExecutionRuntime,
  inboxQuery: { refetch: () => Promise<unknown> },
) {
  return useMutation({
    mutationFn: async ({ action, inboxID, requestClient, requestSessionID }: InboxVariables) =>
      withController(runtime.controllersRef.current, (signal) =>
        inboxRequests[action](requestClient, requestSessionID, inboxID, { signal }),
      ),
    onError: (_caught, { requestScope }) => {
      if (!isCurrentScope(runtime, requestScope)) return;
      runtime.setError("The inbox changed on the server. Its current state is being reloaded.");
      void inboxQuery.refetch();
    },
    onSuccess: (_, variables) => applyInboxSuccess(runtime, variables),
  });
}

function applyInboxSuccess(
  runtime: SessionExecutionRuntime,
  { action, inboxID, requestAdmissionKey, requestInboxKey, requestScope }: InboxVariables,
) {
  runtime.queryClient.setQueryData<SessionInboxInfo[]>(requestInboxKey, (current = []) =>
    applyInboxAction(current, action, inboxID),
  );
  if (action === "cancel") {
    updateAdmissionAt(runtime.queryClient, requestAdmissionKey, inboxID, markPromptCancelled);
  }
  reportForScope(runtime, requestScope, undefined);
  notifySelection();
}

export function useControlMutation(
  runtime: SessionExecutionRuntime,
  reconcile: () => Promise<void>,
) {
  return useMutation({
    mutationFn: async ({
      action,
      requestClient,
      requestScope,
      requestSessionID,
    }: ControlVariables) => {
      if (isCurrentScope(runtime, requestScope)) runtime.setBusyAction(action);
      await withController(runtime.controllersRef.current, async (signal) => {
        await controlRequests[action](requestClient, requestSessionID, { signal });
      });
      return action;
    },
    onError: (_caught, { requestScope }) =>
      reportForScope(runtime, requestScope, "The execution control could not be applied."),
    onSettled: (_data, _error, { requestScope }) => {
      if (!isCurrentScope(runtime, requestScope)) return;
      runtime.setBusyAction(undefined);
      void reconcile();
    },
    onSuccess: (action, variables) => applyControlSuccess(runtime, action, variables),
  });
}

function applyControlSuccess(
  runtime: SessionExecutionRuntime,
  action: ExecutionControlAction,
  { requestAdmissionKey, requestScope }: ControlVariables,
) {
  if (action === "interrupt") {
    updateAdmissionsAt(runtime.queryClient, requestAdmissionKey, (current) =>
      current.map(markPromptInterrupted),
    );
    notifyFeedback(Haptics.NotificationFeedbackType.Warning);
  } else {
    notifySelection();
  }
  reportForScope(runtime, requestScope, undefined);
}

export function executionCommands({
  busyAction,
  canBackground,
  controlMutation,
  inboxMutation,
  runtime,
  switchAgentMutation,
  switchModelMutation,
}: {
  busyAction: ExecutionControlAction | undefined;
  canBackground: boolean;
  controlMutation: UseMutationResult<ExecutionControlAction, Error, ControlVariables>;
  inboxMutation: UseMutationResult<unknown, Error, InboxVariables>;
  runtime: SessionExecutionRuntime;
  switchAgentMutation: UseMutationResult<string, Error, SessionSettingVariables<string>>;
  switchModelMutation: UseMutationResult<ModelRef, Error, SessionSettingVariables<ModelRef>>;
}) {
  const { admissionKey, client, executionScope, inboxKey, sessionID, sessionKey } = runtime;
  function switchSetting<T>(
    mutation: UseMutationResult<T, Error, SessionSettingVariables<T>>,
    value: T,
  ) {
    if (!client) return;
    mutation.mutate({
      requestClient: client,
      requestScope: executionScope,
      requestSessionID: sessionID,
      requestSessionKey: sessionKey,
      value,
    });
  }
  function mutateInbox(action: InboxAction, inboxID: string) {
    if (!client) return;
    inboxMutation.mutate({
      action,
      inboxID,
      requestAdmissionKey: admissionKey,
      requestClient: client,
      requestInboxKey: inboxKey,
      requestScope: executionScope,
      requestSessionID: sessionID,
    });
  }
  function mutateControl(action: ExecutionControlAction) {
    if (!client || (action === "background" && (!canBackground || busyAction))) return;
    controlMutation.mutate({
      action,
      requestAdmissionKey: admissionKey,
      requestClient: client,
      requestScope: executionScope,
      requestSessionID: sessionID,
    });
  }
  return {
    switchAgent: (agent: string) => switchSetting(switchAgentMutation, agent),
    switchModel: (model: ModelRef) => switchSetting(switchModelMutation, model),
    cancelInbox: (inboxID: string) => mutateInbox("cancel", inboxID),
    queueInbox: (inboxID: string) => mutateInbox("queue", inboxID),
    steerInbox: (inboxID: string) => mutateInbox("steer", inboxID),
    interrupt: () => mutateControl("interrupt"),
    background: () => mutateControl("background"),
    wait: () => mutateControl("wait"),
  };
}
