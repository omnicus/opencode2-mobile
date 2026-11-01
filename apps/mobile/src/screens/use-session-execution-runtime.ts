import type { LocationRef, OpenCodeClient } from "@opencode2-mobile/opencode-adapter";
import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { type SQLiteDatabase, useSQLiteContext } from "expo-sqlite";
import { type Dispatch, type RefObject, type SetStateAction, useRef, useState } from "react";

import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { useTranscriptPreferences } from "../state/transcript-preferences";
import { deleteUnresolvedPromptAdmission } from "../storage/prompt-admission-repository";
import type { ExecutionControlAction } from "./session-execution-model";

export type SessionExecutionRuntime = {
  admissionKey: QueryKey;
  client: OpenCodeClient | undefined;
  controllersRef: RefObject<Set<AbortController>>;
  db: SQLiteDatabase;
  enabled: boolean;
  executionScope: string;
  executionScopeRef: RefObject<string>;
  inboxKey: QueryKey;
  queryClient: QueryClient;
  scopedConnectionId: string;
  sessionID: string;
  sessionKey: QueryKey;
  setBusyAction: Dispatch<SetStateAction<ExecutionControlAction | undefined>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  submittingRef: RefObject<boolean>;
};

export function useSessionExecutionRuntime({
  client,
  connectionId,
  location,
  routeConnectionId,
  sessionID,
}: {
  client: OpenCodeClient | undefined;
  connectionId: string | undefined;
  location: LocationRef;
  routeConnectionId: string;
  sessionID: string;
}) {
  const db = useSQLiteContext();
  const queryClient = useQueryClient();
  const enabled = Boolean(client && connectionId === routeConnectionId);
  const scopedConnectionId = routeConnectionId;
  const executionScope = `${routeConnectionId}\u0000${sessionID}`;
  const preferences = useTranscriptPreferences();
  const [error, setError] = useState<string>();
  const [busyAction, setBusyAction] = useState<ExecutionControlAction>();
  const controllersRef = useRef(new Set<AbortController>());
  const executionScopeRef = useRef(executionScope);
  executionScopeRef.current = executionScope;
  const submittingRef = useRef(false);
  const runtime: SessionExecutionRuntime = {
    admissionKey: openCodeQueryKeys.promptAdmissions(scopedConnectionId, location, sessionID),
    client,
    controllersRef,
    db,
    enabled,
    executionScope,
    executionScopeRef,
    inboxKey: openCodeQueryKeys.inbox(scopedConnectionId, location, sessionID),
    queryClient,
    scopedConnectionId,
    sessionID,
    sessionKey: openCodeQueryKeys.session(scopedConnectionId, location, sessionID),
    setBusyAction,
    setError,
    submittingRef,
  };
  return { busyAction, error, preferences, runtime };
}

export function isCurrentScope(runtime: SessionExecutionRuntime, requestScope: string) {
  return runtime.executionScopeRef.current === requestScope;
}

export function reportForScope(
  runtime: SessionExecutionRuntime,
  requestScope: string,
  error: string | undefined,
) {
  if (isCurrentScope(runtime, requestScope)) runtime.setError(error);
}

export function forgetUnresolvedAdmission(
  db: SQLiteDatabase,
  connectionID: string,
  sessionID: string,
  admissionID: string,
) {
  void deleteUnresolvedPromptAdmission(db, connectionID, sessionID, admissionID).catch(
    () => undefined,
  );
}

export function notifySelection() {
  void Haptics.selectionAsync().catch(() => undefined);
}

export function notifyFeedback(type: Haptics.NotificationFeedbackType) {
  void Haptics.notificationAsync(type).catch(() => undefined);
}
