import {
  backgroundOpenCodeSession,
  cancelOpenCodeSessionInboxItem,
  classifyOpenCodeError,
  getDefaultOpenCodeModel,
  getOpenCodeSessionMessage,
  interruptOpenCodeSession,
  type LocationRef,
  listActiveOpenCodeSessions,
  listOpenCodeAgents,
  listOpenCodeModels,
  listOpenCodeSessionInbox,
  type ModelRef,
  type OpenCodeClient,
  promptOpenCodeSession,
  queueOpenCodeSessionInboxItem,
  type SessionInfo,
  type SessionMessageInfo,
  steerOpenCodeSessionInboxItem,
  switchOpenCodeSessionAgent,
  switchOpenCodeSessionModel,
  waitForOpenCodeSession,
} from "@opencode2-mobile/opencode-adapter";
import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useRef, useState } from "react";

import { openCodeQueryKeys } from "../state/open-code-query-keys";
import {
  deleteUnresolvedPromptAdmission,
  listUnresolvedPromptAdmissions,
  writeUnresolvedPromptAdmission,
} from "../storage/prompt-admission-repository";
import {
  createPromptAdmission,
  markPromptAdmitted,
  markPromptCancelled,
  markPromptConfirmationHandled,
  markPromptDeliveryUnknown,
  markPromptInterrupted,
  markPromptRetryOffered,
  type PromptAdmission,
  type PromptDelivery,
  reconcilePromptAdmission,
} from "./prompt-admission-model";

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
  const db = useSQLiteContext();
  const queryClient = useQueryClient();
  const enabled = Boolean(client && connectionId === routeConnectionId);
  const scopedConnectionId = routeConnectionId;
  const admissionKey = openCodeQueryKeys.promptAdmissions(scopedConnectionId, location, sessionID);
  const inboxKey = openCodeQueryKeys.inbox(scopedConnectionId, location, sessionID);
  const sessionKey = openCodeQueryKeys.session(scopedConnectionId, location, sessionID);
  const executionScope = `${routeConnectionId}\u0000${sessionID}`;
  const [delivery, setDelivery] = useState<PromptDelivery>();
  const [error, setError] = useState<string>();
  const [busyAction, setBusyAction] = useState<"background" | "interrupt" | "wait">();
  const controllersRef = useRef(new Set<AbortController>());
  const executionScopeRef = useRef(executionScope);
  executionScopeRef.current = executionScope;
  const submittingRef = useRef(false);
  const admissionsQuery = useQuery<PromptAdmission[]>({
    enabled,
    queryFn: () => listUnresolvedPromptAdmissions(db, scopedConnectionId, sessionID),
    queryKey: admissionKey,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const activeSessionsQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return listActiveOpenCodeSessions(client, { signal });
    },
    queryKey: openCodeQueryKeys.activeSessions(scopedConnectionId),
  });
  const inboxQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return listOpenCodeSessionInbox(client, sessionID, { signal });
    },
    queryKey: inboxKey,
  });
  const agentsQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return listOpenCodeAgents(client, location, { signal });
    },
    queryKey: openCodeQueryKeys.agents(scopedConnectionId, location),
  });
  const modelsQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return listOpenCodeModels(client, location, { signal });
    },
    queryKey: openCodeQueryKeys.models(scopedConnectionId, location),
  });
  const defaultModelQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getDefaultOpenCodeModel(client, location, { signal });
    },
    queryKey: [...openCodeQueryKeys.models(scopedConnectionId, location), "default"],
  });
  const active = Boolean(activeSessionsQuery.data?.[sessionID]);
  const executionStateReady = activeSessionsQuery.isSuccess && inboxQuery.isSuccess;
  const inbox = inboxQuery.data ?? [];
  const admissions = admissionsQuery.data ?? [];
  const projectedMessageIds = new Set(messages.map((message) => message.id));
  const unresolvedAdmission = admissions.some(
    (admission) => admission.status === "submitting" || admission.status === "unknown-delivery",
  );
  const agents = (agentsQuery.data?.data ?? []).filter(
    (candidate) => !candidate.hidden && candidate.mode !== "subagent",
  );
  const models = (modelsQuery.data?.data ?? []).filter(
    (candidate) => candidate.enabled && candidate.status !== "deprecated",
  );

  const updateAdmissions = useCallback(
    (update: (current: PromptAdmission[]) => PromptAdmission[]) => {
      updateAdmissionsAt(queryClient, admissionKey, update);
    },
    [admissionKey, queryClient],
  );

  useEffect(() => {
    if (!executionScope) return;
    const controllers = controllersRef.current;
    submittingRef.current = false;
    setBusyAction(undefined);
    setDelivery(undefined);
    setError(undefined);
    return () => {
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, [executionScope]);

  useEffect(() => {
    if (active) return;
    setDelivery(undefined);
  }, [active]);

  useEffect(() => {
    if (!draftReady || admissions.length === 0) return;
    const inboxById = new Map(inbox.map((item) => [item.id, item]));
    const projectedMessagesById = new Map(messages.map((message) => [message.id, message]));
    const confirmedAdmissions: PromptAdmission[] = [];
    updateAdmissions((current) =>
      current.map((admission) => {
        const inboxItem = inboxById.get(admission.id);
        const projectedMessage = projectedMessagesById.get(admission.id);
        const serverAdmittedAtMs = inboxItem?.timeCreated ?? projectedMessage?.time.created;
        let next = reconcilePromptAdmission(admission, {
          ...(inboxItem ? { inboxDelivery: inboxItem.delivery } : {}),
          messageProjected: projectedMessagesById.has(admission.id),
          ...(serverAdmittedAtMs === undefined ? {} : { serverAdmittedAtMs }),
          ...(session?.time.idle === undefined ? {} : { sessionIdleAtMs: session.time.idle }),
          ...(session?.outcome ? { sessionOutcome: session.outcome } : {}),
          sessionRunning: active,
        });
        if (
          next.durable &&
          !next.confirmationHandled &&
          (inboxById.has(next.id) || projectedMessagesById.has(next.id))
        ) {
          next = markPromptConfirmationHandled(next);
          confirmedAdmissions.push(next);
        }
        return next;
      }),
    );
    for (const admission of confirmedAdmissions) {
      void deleteUnresolvedPromptAdmission(db, scopedConnectionId, sessionID, admission.id).catch(
        () => undefined,
      );
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
    session?.outcome,
    session?.time.idle,
    scopedConnectionId,
    sessionID,
    updateAdmissions,
  ]);

  const promptMutation = useMutation({
    mutationFn: async ({
      admission,
      requestClient,
      requestConnectionID,
      persistSubmittedDraft,
      requestSessionID,
      text,
    }: {
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
    }) => {
      return withController(controllersRef.current, async (signal) => {
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
        if (signal.aborted) throw new Error("PROMPT_CANCELLED_BEFORE_SEND");
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
        return promptOpenCodeSession(
          requestClient,
          requestSessionID,
          {
            delivery: admission.delivery ?? "steer",
            id: admission.id,
            resume: true,
            text,
          },
          { signal },
        );
      });
    },
    networkMode: "always",
    onError: (
      caught,
      {
        admission,
        admissionKey: submittedAdmissionKey,
        reconcileSubmission,
        requestConnectionID,
        requestSessionID,
        requestScope,
      },
    ) => {
      const scopeIsCurrent = executionScopeRef.current === requestScope;
      if (
        caught instanceof Error &&
        (caught.message === "DRAFT_CHANGED_BEFORE_SEND" ||
          caught.message === "PROMPT_CANCELLED_BEFORE_SEND")
      ) {
        updateAdmissionAt(queryClient, submittedAdmissionKey, admission.id, markPromptCancelled);
        if (scopeIsCurrent && caught.message === "DRAFT_CHANGED_BEFORE_SEND") {
          setError("The draft changed before transmission. Review it and send again.");
        }
        return;
      }
      if (caught instanceof Error && caught.message === "PROMPT_ADMISSION_PERSISTENCE_FAILED") {
        updateAdmissionAt(queryClient, submittedAdmissionKey, admission.id, markPromptCancelled);
        if (scopeIsCurrent) setError("The prompt could not be saved safely and was not sent.");
        return;
      }
      const classification = classifyOpenCodeError(caught);
      if (
        classification === "INVALID_REQUEST" ||
        classification === "NOT_FOUND" ||
        classification === "UNAUTHORIZED"
      ) {
        updateAdmissionAt(queryClient, submittedAdmissionKey, admission.id, markPromptCancelled);
        void deleteUnresolvedPromptAdmission(
          db,
          requestConnectionID,
          requestSessionID,
          admission.id,
        ).catch(() => undefined);
        if (scopeIsCurrent) setError("The server rejected this prompt before admission.");
        return;
      }
      updateAdmissionAt(
        queryClient,
        submittedAdmissionKey,
        admission.id,
        markPromptDeliveryUnknown,
      );
      if (scopeIsCurrent) {
        setError(
          classification === "CONFLICT"
            ? "The server reported an admission conflict. Check delivery before sending again."
            : "The response was lost. The prompt may have been admitted; check delivery before sending again.",
        );
      }
      void reconcileSubmission();
    },
    onSettled: () => {
      submittingRef.current = false;
    },
    onSuccess: (
      item,
      {
        admission,
        admissionKey: submittedAdmissionKey,
        confirmAdmission,
        inboxKey: submittedInboxKey,
        requestConnectionID,
        requestSessionID,
        requestScope,
      },
    ) => {
      updateAdmissionAt(queryClient, submittedAdmissionKey, admission.id, (current) =>
        markPromptConfirmationHandled(markPromptAdmitted(current, item.delivery, item.timeCreated)),
      );
      queryClient.setQueryData<typeof inbox>(submittedInboxKey, (current = []) => [
        item,
        ...current.filter((candidate) => candidate.id !== item.id),
      ]);
      void deleteUnresolvedPromptAdmission(
        db,
        requestConnectionID,
        requestSessionID,
        admission.id,
      ).catch(() => undefined);
      if (executionScopeRef.current === requestScope) setError(undefined);
      confirmAdmission(admission.draftRevision ?? 0);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
    },
  });

  const switchAgentMutation = useMutation({
    mutationFn: async ({
      agent,
      requestClient,
      requestSessionID,
    }: {
      agent: string;
      requestClient: OpenCodeClient;
      requestScope: string;
      requestSessionID: string;
      requestSessionKey: QueryKey;
    }) => {
      await withController(controllersRef.current, (signal) =>
        switchOpenCodeSessionAgent(requestClient, requestSessionID, agent, { signal }),
      );
      return agent;
    },
    onError: (_caught, { requestScope }) => {
      if (executionScopeRef.current === requestScope) {
        setError("The session agent could not be changed.");
      }
    },
    onSuccess: (agent, { requestScope, requestSessionKey }) => {
      queryClient.setQueryData<SessionInfo>(requestSessionKey, (current) =>
        current ? { ...current, agent } : current,
      );
      if (executionScopeRef.current === requestScope) setError(undefined);
      void Haptics.selectionAsync().catch(() => undefined);
    },
  });

  const switchModelMutation = useMutation({
    mutationFn: async ({
      model,
      requestClient,
      requestSessionID,
    }: {
      model: ModelRef;
      requestClient: OpenCodeClient;
      requestScope: string;
      requestSessionID: string;
      requestSessionKey: QueryKey;
    }) => {
      await withController(controllersRef.current, (signal) =>
        switchOpenCodeSessionModel(requestClient, requestSessionID, model, { signal }),
      );
      return model;
    },
    onError: (_caught, { requestScope }) => {
      if (executionScopeRef.current === requestScope) {
        setError("The session model could not be changed.");
      }
    },
    onSuccess: (model, { requestScope, requestSessionKey }) => {
      queryClient.setQueryData<SessionInfo>(requestSessionKey, (current) =>
        current ? { ...current, model } : current,
      );
      if (executionScopeRef.current === requestScope) setError(undefined);
      void Haptics.selectionAsync().catch(() => undefined);
    },
  });

  const inboxMutation = useMutation({
    mutationFn: async ({
      action,
      inboxID,
      requestClient,
      requestSessionID,
    }: {
      action: "cancel" | "queue" | "steer";
      inboxID: string;
      requestAdmissionKey: QueryKey;
      requestClient: OpenCodeClient;
      requestInboxKey: QueryKey;
      requestScope: string;
      requestSessionID: string;
    }) => {
      return withController(controllersRef.current, (signal) => {
        if (action === "cancel") {
          return cancelOpenCodeSessionInboxItem(requestClient, requestSessionID, inboxID, {
            signal,
          });
        }
        if (action === "queue") {
          return queueOpenCodeSessionInboxItem(requestClient, requestSessionID, inboxID, {
            signal,
          });
        }
        return steerOpenCodeSessionInboxItem(requestClient, requestSessionID, inboxID, { signal });
      });
    },
    onError: (_caught, { requestScope }) => {
      if (executionScopeRef.current === requestScope) {
        setError("The inbox changed on the server. Its current state is being reloaded.");
        void inboxQuery.refetch();
      }
    },
    onSuccess: (_, { action, inboxID, requestAdmissionKey, requestInboxKey, requestScope }) => {
      queryClient.setQueryData<typeof inbox>(requestInboxKey, (current = []) =>
        action === "cancel"
          ? current.filter((item) => item.id !== inboxID)
          : current.map((item) =>
              item.id === inboxID
                ? { ...item, delivery: action === "queue" ? "queue" : "steer" }
                : item,
            ),
      );
      if (action === "cancel") {
        updateAdmissionAt(queryClient, requestAdmissionKey, inboxID, markPromptCancelled);
      }
      if (executionScopeRef.current === requestScope) setError(undefined);
      void Haptics.selectionAsync().catch(() => undefined);
    },
  });

  const controlMutation = useMutation({
    mutationFn: async ({
      action,
      requestClient,
      requestScope,
      requestSessionID,
    }: {
      action: "background" | "interrupt" | "wait";
      requestAdmissionKey: QueryKey;
      requestClient: OpenCodeClient;
      requestScope: string;
      requestSessionID: string;
    }) => {
      if (executionScopeRef.current === requestScope) setBusyAction(action);
      await withController(controllersRef.current, (signal) => {
        if (action === "interrupt") {
          return interruptOpenCodeSession(requestClient, requestSessionID, false, { signal });
        }
        if (action === "background") {
          return backgroundOpenCodeSession(requestClient, requestSessionID, { signal });
        }
        return waitForOpenCodeSession(requestClient, requestSessionID, { signal });
      });
      return action;
    },
    onError: (_caught, { requestScope }) => {
      if (executionScopeRef.current === requestScope) {
        setError("The execution control could not be applied.");
      }
    },
    onSettled: (_data, _error, { requestScope }) => {
      if (executionScopeRef.current === requestScope) {
        setBusyAction(undefined);
        void reconcile();
      }
    },
    onSuccess: (action, { requestAdmissionKey, requestScope }) => {
      if (action === "interrupt") {
        updateAdmissionsAt(queryClient, requestAdmissionKey, (current) =>
          current.map(markPromptInterrupted),
        );
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
          () => undefined,
        );
      } else {
        void Haptics.selectionAsync().catch(() => undefined);
      }
      if (executionScopeRef.current === requestScope) setError(undefined);
    },
  });

  function updateAdmission(
    admissionID: string,
    update: (admission: PromptAdmission) => PromptAdmission,
  ) {
    updateAdmissions((current) =>
      current.map((admission) => (admission.id === admissionID ? update(admission) : admission)),
    );
  }

  function submit(text: string) {
    if (
      !client ||
      !draftReady ||
      !executionStateReady ||
      (active && !delivery) ||
      submittingRef.current ||
      promptMutation.isPending ||
      unresolvedAdmission
    ) {
      return;
    }
    submittingRef.current = true;
    const admission = {
      ...createPromptAdmission(active ? delivery : "steer"),
      draftRevision,
    };
    updateAdmissions((current) => [...current, admission]);
    promptMutation.mutate({
      admission,
      admissionKey,
      confirmAdmission: onAdmissionConfirmed,
      inboxKey,
      persistSubmittedDraft: persistDraft,
      reconcileSubmission: reconcile,
      requestClient: client,
      requestConnectionID: scopedConnectionId,
      requestSessionID: sessionID,
      requestScope: executionScope,
      text,
    });
  }

  async function reconcile() {
    await Promise.all([
      activeSessionsQuery.refetch(),
      inboxQuery.refetch(),
      refetchMessages(),
    ]).catch(() => undefined);
  }

  async function reconcileAdmission(admissionID: string) {
    if (!client) return;
    const requestScope = executionScope;
    setError(undefined);
    const [inboxResult, messageResult] = await Promise.allSettled([
      withController(controllersRef.current, (signal) =>
        listOpenCodeSessionInbox(client, sessionID, { signal }),
      ),
      withController(controllersRef.current, (signal) =>
        getOpenCodeSessionMessage(client, sessionID, admissionID, { signal }),
      ),
    ]);
    if (inboxResult.status === "fulfilled") {
      queryClient.setQueryData(inboxKey, inboxResult.value);
      const item = inboxResult.value.find((candidate) => candidate.id === admissionID);
      if (item) {
        updateAdmission(admissionID, (current) =>
          markPromptConfirmationHandled(
            markPromptAdmitted(current, item.delivery, item.timeCreated),
          ),
        );
        void deleteUnresolvedPromptAdmission(db, scopedConnectionId, sessionID, admissionID).catch(
          () => undefined,
        );
        onAdmissionConfirmed(currentAdmissionRevision(admissions, admissionID));
        return;
      }
    }
    if (messageResult.status === "fulfilled") {
      updateAdmission(admissionID, (current) =>
        markPromptConfirmationHandled(
          reconcilePromptAdmission(current, {
            messageProjected: true,
            serverAdmittedAtMs: messageResult.value.time.created,
            ...(session?.time.idle === undefined ? {} : { sessionIdleAtMs: session.time.idle }),
            ...(session?.outcome ? { sessionOutcome: session.outcome } : {}),
            sessionRunning: active,
          }),
        ),
      );
      void deleteUnresolvedPromptAdmission(db, scopedConnectionId, sessionID, admissionID).catch(
        () => undefined,
      );
      onAdmissionConfirmed(currentAdmissionRevision(admissions, admissionID));
      await refetchMessages().catch(() => undefined);
      return;
    }
    if (executionScopeRef.current === requestScope) {
      setError(
        inboxResult.status === "fulfilled" &&
          classifyOpenCodeError(messageResult.reason) === "MESSAGE_NOT_FOUND"
          ? "No matching server state is visible yet. Do not resend; check again after the connection settles."
          : "Delivery is still unknown. Check again after the connection recovers.",
      );
    }
    if (
      inboxResult.status === "fulfilled" &&
      classifyOpenCodeError(messageResult.reason) === "MESSAGE_NOT_FOUND"
    ) {
      updateAdmission(admissionID, markPromptRetryOffered);
    }
  }

  async function allowRetry(admissionID: string) {
    const requestScope = executionScope;
    const admission = admissions.find((candidate) => candidate.id === admissionID);
    if (!admission?.retryOffered) return;
    try {
      await deleteUnresolvedPromptAdmission(db, scopedConnectionId, sessionID, admissionID);
      updateAdmissions((current) => current.filter((candidate) => candidate.id !== admissionID));
      if (executionScopeRef.current === requestScope) {
        setError(undefined);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
          () => undefined,
        );
      }
    } catch {
      if (executionScopeRef.current === requestScope) {
        setError("Retry cannot be enabled until local recovery state is saved.");
      }
    }
  }

  return {
    active,
    allowRetry: (admissionID: string) => void allowRetry(admissionID),
    admissions,
    agents,
    busyAction,
    defaultModel: defaultModelQuery.data?.data ?? undefined,
    delivery,
    error,
    inbox,
    models,
    projectedMessageIds,
    setDelivery,
    submit,
    submitDisabled:
      promptMutation.isPending ||
      switchAgentMutation.isPending ||
      switchModelMutation.isPending ||
      unresolvedAdmission ||
      (active && !delivery) ||
      !executionStateReady ||
      !admissionsQuery.isSuccess ||
      !draftReady ||
      !enabled,
    switchAgent: (agent: string) => {
      if (!client) return;
      switchAgentMutation.mutate({
        agent,
        requestClient: client,
        requestScope: executionScope,
        requestSessionID: sessionID,
        requestSessionKey: sessionKey,
      });
    },
    switchModel: (model: ModelRef) => {
      if (!client) return;
      switchModelMutation.mutate({
        model,
        requestClient: client,
        requestScope: executionScope,
        requestSessionID: sessionID,
        requestSessionKey: sessionKey,
      });
    },
    cancelInbox: (inboxID: string) => mutateInbox("cancel", inboxID),
    queueInbox: (inboxID: string) => mutateInbox("queue", inboxID),
    steerInbox: (inboxID: string) => mutateInbox("steer", inboxID),
    interrupt: () => mutateControl("interrupt"),
    background: () => mutateControl("background"),
    wait: () => mutateControl("wait"),
    reconcileAdmission: (admissionID: string) => void reconcileAdmission(admissionID),
    selectedAgent: session?.agent,
    selectedModel: session?.model ?? modelRef(defaultModelQuery.data?.data),
  };

  function mutateInbox(action: "cancel" | "queue" | "steer", inboxID: string) {
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

  function mutateControl(action: "background" | "interrupt" | "wait") {
    if (!client) return;
    controlMutation.mutate({
      action,
      requestAdmissionKey: admissionKey,
      requestClient: client,
      requestScope: executionScope,
      requestSessionID: sessionID,
    });
  }
}

function modelRef(model: { id: string; providerID: string } | null | undefined) {
  return model ? { id: model.id, providerID: model.providerID } : undefined;
}

async function withController<T>(
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

function updateAdmissionsAt(
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

function updateAdmissionAt(
  queryClient: QueryClient,
  queryKey: QueryKey,
  admissionID: string,
  update: (admission: PromptAdmission) => PromptAdmission,
) {
  updateAdmissionsAt(queryClient, queryKey, (current) =>
    current.map((admission) => (admission.id === admissionID ? update(admission) : admission)),
  );
}

function currentAdmissionRevision(admissions: PromptAdmission[], admissionID: string) {
  return admissions.find((admission) => admission.id === admissionID)?.draftRevision ?? 0;
}

function unresolvedPromptAdmission(admission: PromptAdmission) {
  if (admission.draftRevision === undefined) {
    throw new Error("PROMPT_ADMISSION_PERSISTENCE_FAILED");
  }
  return {
    ...(admission.delivery ? { delivery: admission.delivery } : {}),
    draftRevision: admission.draftRevision,
    durable: false as const,
    id: admission.id,
    status:
      admission.status === "submitting" ? ("submitting" as const) : ("unknown-delivery" as const),
    submittedAtMs: admission.submittedAtMs,
  };
}
