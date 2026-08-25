import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  deleteSessionDraft,
  readSessionDraft,
  writeSessionDraft,
} from "../storage/draft-repository";

const draftWriteDelayMs = 400;

export function useSessionDraft(connectionId: string, sessionId: string) {
  const db = useSQLiteContext();
  const scope = `${connectionId}\u0000${sessionId}`;
  const [draft, setDraftState] = useState("");
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const latestRef = useRef("");
  const revisionRef = useRef(0);
  const revisionsByScopeRef = useRef(new Map<string, number>());
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const dirtyRef = useRef(false);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());

  const enqueue = useCallback(
    (content: string, contentRevision: number) => {
      const operation = writeChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (content) {
            await writeSessionDraft(db, {
              connectionId,
              content,
              revision: contentRevision,
              sessionId,
            });
          } else {
            await deleteSessionDraft(db, connectionId, sessionId);
          }
        });
      writeChainRef.current = operation.then(
        () => {
          if (scopeRef.current === scope) setError(undefined);
        },
        () => {
          if (scopeRef.current === scope) {
            setError("The encrypted draft could not be saved.");
          }
        },
      );
      return operation;
    },
    [connectionId, db, scope, sessionId],
  );

  const flush = useCallback(() => {
    if (writeTimerRef.current !== null) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    void enqueue(latestRef.current, revisionsByScopeRef.current.get(scope) ?? 0).catch(
      () => undefined,
    );
  }, [enqueue, scope]);

  useEffect(() => {
    let active = true;
    latestRef.current = "";
    revisionRef.current = revisionsByScopeRef.current.get(scope) ?? 0;
    dirtyRef.current = false;
    setDraftState("");
    setError(undefined);
    setLoaded(false);
    setRevision(revisionRef.current);
    void readSessionDraft(db, connectionId, sessionId)
      .then((stored) => {
        if (!active || dirtyRef.current) return;
        const content = stored?.content ?? "";
        const storedRevision = stored?.revision ?? 0;
        latestRef.current = content;
        revisionRef.current = storedRevision;
        revisionsByScopeRef.current.set(scope, storedRevision);
        setDraftState(content);
        setRevision(storedRevision);
      })
      .catch(() => {
        if (active) setError("The saved draft could not be opened on this device.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => {
      active = false;
      appStateSubscription.remove();
      flush();
    };
  }, [connectionId, db, flush, scope, sessionId]);

  function setDraft(content: string) {
    latestRef.current = content;
    const nextRevision = (revisionsByScopeRef.current.get(scope) ?? 0) + 1;
    revisionRef.current = nextRevision;
    revisionsByScopeRef.current.set(scope, nextRevision);
    dirtyRef.current = true;
    setDraftState(content);
    setRevision(revisionRef.current);
    if (writeTimerRef.current !== null) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(flush, draftWriteDelayMs);
  }

  const clearDraft = useCallback(
    (expectedRevision?: number) => {
      const currentRevision = revisionsByScopeRef.current.get(scope) ?? 0;
      if (expectedRevision !== undefined && currentRevision !== expectedRevision) return;
      const nextRevision = currentRevision + 1;
      revisionsByScopeRef.current.set(scope, nextRevision);
      if (scopeRef.current === scope && writeTimerRef.current !== null) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
      if (scopeRef.current === scope) {
        latestRef.current = "";
        revisionRef.current = nextRevision;
        dirtyRef.current = false;
        setDraftState("");
        setRevision(nextRevision);
      }
      void enqueue("", nextRevision).catch(() => undefined);
    },
    [enqueue, scope],
  );

  const persistDraft = useCallback(
    async (content: string, expectedRevision: number) => {
      if (
        revisionsByScopeRef.current.get(scope) !== expectedRevision ||
        (scopeRef.current === scope && latestRef.current !== content)
      ) {
        throw new Error("DRAFT_CHANGED_BEFORE_SEND");
      }
      if (scopeRef.current === scope && writeTimerRef.current !== null) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
        dirtyRef.current = false;
      }
      await enqueue(content, expectedRevision);
    },
    [enqueue, scope],
  );

  return { clearDraft, draft, error, loaded, persistDraft, revision, setDraft };
}
