import type { SQLiteDatabase } from "expo-sqlite";
import { useSQLiteContext } from "expo-sqlite";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  deleteSessionDraft,
  readSessionDraft,
  type SessionDraft,
  type SessionDraftMention,
  writeSessionDraft,
} from "../storage/draft-repository";
import { registerReloadPreparation, trackReloadWrite } from "../updates/prepare-app-reload";

const draftWriteDelayMs = 400;

function draftScope(connectionId: string, sessionId: string) {
  return `${connectionId}\u0000${sessionId}`;
}

function scopeRevision(revisionsByScope: Map<string, number>, scope: string) {
  return revisionsByScope.get(scope) ?? 0;
}

function cancelWriteTimer(writeTimerRef: RefObject<ReturnType<typeof setTimeout> | null>) {
  if (writeTimerRef.current === null) return false;
  clearTimeout(writeTimerRef.current);
  writeTimerRef.current = null;
  return true;
}

function restoredDraft(stored: SessionDraft | undefined) {
  return {
    content: stored?.content ?? "",
    mentions: stored?.mentions ?? [],
    revision: stored?.revision ?? 0,
  };
}

function useDraftWriteQueue(
  db: SQLiteDatabase,
  connectionId: string,
  sessionId: string,
  scopeRef: RefObject<string>,
  setError: (error: string | undefined) => void,
) {
  const scope = draftScope(connectionId, sessionId);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  return useCallback(
    (content: string, contentMentions: SessionDraftMention[], contentRevision: number) => {
      const operation = writeChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (content) {
            await writeSessionDraft(db, {
              connectionId,
              content,
              mentions: contentMentions,
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
      return trackReloadWrite(operation);
    },
    [connectionId, db, scope, scopeRef, sessionId, setError],
  );
}

export function useSessionDraft(connectionId: string, sessionId: string) {
  const db = useSQLiteContext();
  const scope = draftScope(connectionId, sessionId);
  const [draft, setDraftState] = useState("");
  const [mentions, setMentions] = useState<SessionDraftMention[]>([]);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const latestRef = useRef("");
  const latestMentionsRef = useRef<SessionDraftMention[]>([]);
  const revisionRef = useRef(0);
  const revisionsByScopeRef = useRef(new Map<string, number>());
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const dirtyRef = useRef(false);
  const hasDraftStateRef = useRef(false);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const enqueue = useDraftWriteQueue(db, connectionId, sessionId, scopeRef, setError);

  const flush = useCallback(() => {
    cancelWriteTimer(writeTimerRef);
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    void enqueue(
      latestRef.current,
      latestMentionsRef.current,
      scopeRevision(revisionsByScopeRef.current, scope),
    ).catch(() => undefined);
  }, [enqueue, scope]);

  useEffect(() => {
    let active = true;
    latestRef.current = "";
    latestMentionsRef.current = [];
    revisionRef.current = scopeRevision(revisionsByScopeRef.current, scope);
    dirtyRef.current = false;
    hasDraftStateRef.current = false;
    setDraftState("");
    setMentions([]);
    setError(undefined);
    setLoaded(false);
    setRevision(revisionRef.current);
    void readSessionDraft(db, connectionId, sessionId)
      .then((stored) => {
        if (!active || dirtyRef.current) return;
        const restored = restoredDraft(stored);
        hasDraftStateRef.current = true;
        latestRef.current = restored.content;
        latestMentionsRef.current = restored.mentions;
        revisionRef.current = restored.revision;
        revisionsByScopeRef.current.set(scope, restored.revision);
        setDraftState(restored.content);
        setMentions(restored.mentions);
        setRevision(restored.revision);
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

  useEffect(() => {
    if (!loaded) return;
    return registerReloadPreparation(async () => {
      // A failed read must not replace an unreadable saved draft with empty text.
      if (!hasDraftStateRef.current) return;
      cancelWriteTimer(writeTimerRef);
      const currentRevision = scopeRevision(revisionsByScopeRef.current, scope);
      await enqueue(latestRef.current, latestMentionsRef.current, currentRevision);
      if (scopeRevision(revisionsByScopeRef.current, scope) !== currentRevision) {
        throw new Error("DRAFT_CHANGED_BEFORE_RELOAD");
      }
    });
  }, [enqueue, loaded, scope]);

  function setDraft(
    content: string,
    contentMentions: SessionDraftMention[] = latestMentionsRef.current,
  ) {
    hasDraftStateRef.current = true;
    latestRef.current = content;
    latestMentionsRef.current = contentMentions;
    const nextRevision = scopeRevision(revisionsByScopeRef.current, scope) + 1;
    revisionRef.current = nextRevision;
    revisionsByScopeRef.current.set(scope, nextRevision);
    dirtyRef.current = true;
    setDraftState(content);
    setMentions(contentMentions);
    setRevision(revisionRef.current);
    cancelWriteTimer(writeTimerRef);
    writeTimerRef.current = setTimeout(flush, draftWriteDelayMs);
  }

  const clearDraft = useCallback(
    (expectedRevision?: number) => {
      const currentRevision = scopeRevision(revisionsByScopeRef.current, scope);
      if (expectedRevision !== undefined && currentRevision !== expectedRevision) return;
      const nextRevision = currentRevision + 1;
      revisionsByScopeRef.current.set(scope, nextRevision);
      if (scopeRef.current === scope) {
        cancelWriteTimer(writeTimerRef);
        latestRef.current = "";
        latestMentionsRef.current = [];
        revisionRef.current = nextRevision;
        dirtyRef.current = false;
        setDraftState("");
        setMentions([]);
        setRevision(nextRevision);
      }
      void enqueue("", [], nextRevision).catch(() => undefined);
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
      if (scopeRef.current === scope && cancelWriteTimer(writeTimerRef)) dirtyRef.current = false;
      await enqueue(content, latestMentionsRef.current, expectedRevision);
    },
    [enqueue, scope],
  );

  return { clearDraft, draft, error, loaded, mentions, persistDraft, revision, setDraft };
}
