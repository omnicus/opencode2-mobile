import type {
  LocationRef,
  OpenCodeEvent,
  PermissionRequest,
  SessionActive,
  SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";
import type { InfiniteData, Query, QueryClient, QueryKey } from "@tanstack/react-query";

import { openCodeQueryKeys } from "./open-code-query-keys";
import {
  isTranscriptReductionEventType,
  reduceTranscriptEvents,
  transcriptEventSessionID,
} from "./transcript-event-reducer";
import type { TranscriptProjectionFrameSample } from "./transcript-performance";

type InvalidationRoot =
  | "connection"
  | "forms"
  | "health"
  | "inbox"
  | "messages"
  | "permissions"
  | "sessions"
  | "vcs";
type InvalidationTarget = { location?: LocationRef; root: InvalidationRoot; sessionId?: string };
type PendingTranscript = {
  eventIds: Set<string>;
  events: OpenCodeEvent[];
  location?: LocationRef;
  overflowed: boolean;
  sessionId: string;
};

const maxEventsPerTranscriptFrame = 4096;

export class ConnectionEventQueryBridge {
  private readonly pending = new Map<string, InvalidationTarget>();
  private readonly pendingTranscripts = new Map<string, PendingTranscript>();
  private scheduled = false;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly connectionId: string,
    private readonly schedule: (callback: () => void) => void = defaultSchedule,
    private readonly onTranscriptFrame?: (sample: TranscriptProjectionFrameSample) => void,
  ) {}

  apply(event: OpenCodeEvent) {
    const activeKey = openCodeQueryKeys.activeSessions(this.connectionId);
    const current = this.queryClient.getQueryData<Record<string, SessionActive>>(activeKey);
    const next = reduceActiveSessions(current, event);
    if (next !== current) this.queryClient.setQueryData(activeKey, next);
    reducePermissionQueries(this.queryClient, this.connectionId, event);

    const root = eventInvalidationRoot(event);
    if (root) {
      this.queue(
        root,
        event.location,
        root === "inbox" && "sessionID" in event.data && typeof event.data.sessionID === "string"
          ? event.data.sessionID
          : undefined,
      );
    }
    if (isTranscriptReductionEventType(event.type)) {
      const sessionId = transcriptEventSessionID(event);
      if (sessionId) this.queueTranscript(event, sessionId);
      else this.queue("connection");
    }
    if (
      messageReconciliationEventTypes.has(event.type) &&
      "sessionID" in event.data &&
      typeof event.data.sessionID === "string"
    ) {
      this.queue("messages", event.location, event.data.sessionID);
    }
  }

  uncertain(event?: OpenCodeEvent) {
    const root = event ? (eventInvalidationRoot(event) ?? "connection") : "connection";
    this.queue(root, root === "connection" ? undefined : event?.location);
    if (
      event &&
      messageReconciliationEventTypes.has(event.type) &&
      "sessionID" in event.data &&
      typeof event.data.sessionID === "string"
    ) {
      this.queue("messages", event.location, event.data.sessionID);
    }
  }

  flush() {
    this.scheduled = false;
    const targets = new Map(this.pending);
    const transcripts = [...this.pendingTranscripts.values()];
    this.pending.clear();
    this.pendingTranscripts.clear();

    const transcriptStartedAt = now();
    let transcriptCacheWrites = 0;
    let transcriptEventCount = 0;
    let transcriptReconciliations = 0;
    for (const transcript of transcripts) {
      transcriptEventCount += transcript.events.length;
      const result = this.reduceTranscript(transcript);
      transcriptCacheWrites += result.cacheWrites;
      if (result.needsReconciliation) {
        transcriptReconciliations += 1;
        setInvalidationTarget(targets, "messages", transcript.location, transcript.sessionId);
      }
    }
    if (transcripts.length > 0) {
      this.onTranscriptFrame?.({
        cacheWrites: transcriptCacheWrites,
        durationMs: now() - transcriptStartedAt,
        eventCount: transcriptEventCount,
        reconciliations: transcriptReconciliations,
      });
    }

    for (const { location, root, sessionId } of targets.values()) {
      if (root === "health") {
        void this.queryClient.invalidateQueries({
          exact: true,
          queryKey: openCodeQueryKeys.health(this.connectionId),
        });
      } else if (root === "connection") {
        void this.queryClient.invalidateQueries({
          queryKey: openCodeQueryKeys.connection(this.connectionId),
        });
      } else {
        void this.queryClient.invalidateQueries({
          predicate: (query) => matchesRoot(query, this.connectionId, root, location, sessionId),
        });
      }
    }
  }

  private queue(root: InvalidationRoot, location?: LocationRef, sessionId?: string) {
    setInvalidationTarget(this.pending, root, location, sessionId);
    this.ensureScheduled();
  }

  private queueTranscript(event: OpenCodeEvent, sessionId: string) {
    const key = targetKey("messages", event.location, sessionId);
    const pending = this.pendingTranscripts.get(key);
    if (pending) {
      if (pending.eventIds.has(event.id)) return;
      if (pending.events.length >= maxEventsPerTranscriptFrame) {
        pending.overflowed = true;
        return;
      }
      pending.eventIds.add(event.id);
      pending.events.push(event);
    } else {
      this.pendingTranscripts.set(key, {
        eventIds: new Set([event.id]),
        events: [event],
        ...(event.location ? { location: event.location } : {}),
        overflowed: false,
        sessionId,
      });
    }
    this.ensureScheduled();
  }

  private reduceTranscript(transcript: PendingTranscript) {
    let needsReconciliation = transcript.overflowed;
    let cacheWrites = 0;
    const queries = this.queryClient.getQueryCache().findAll({
      predicate: (query) =>
        matchesRoot(
          query,
          this.connectionId,
          "messages",
          transcript.location,
          transcript.sessionId,
        ),
    });
    for (const query of queries) {
      const current = query.state.data as
        | InfiniteData<SessionMessagesResponse, string | undefined>
        | undefined;
      if (current === undefined) continue;
      const result = reduceTranscriptEvents(
        current,
        transcript.events,
        isDescendingMessageQuery(query.queryKey),
      );
      needsReconciliation ||= result.needsReconciliation;
      if (result.data !== current) {
        cacheWrites += 1;
        this.queryClient.setQueryData(query.queryKey, result.data);
      }
    }
    return { cacheWrites, needsReconciliation };
  }

  private ensureScheduled() {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => this.flush());
  }
}

function reducePermissionQueries(
  queryClient: QueryClient,
  connectionId: string,
  event: OpenCodeEvent,
) {
  if (
    !event.location ||
    (event.type !== "permission.asked" && event.type !== "permission.replied")
  ) {
    return;
  }
  const queries = queryClient.getQueryCache().findAll({
    predicate: (query) => matchesRoot(query, connectionId, "permissions", event.location),
  });
  for (const query of queries) {
    const current = query.state.data as
      | { data: PermissionRequest[]; location: unknown }
      | undefined;
    if (!current) continue;
    const data =
      event.type === "permission.asked"
        ? current.data.some((request) => request.id === event.data.id)
          ? current.data
          : [...current.data, event.data]
        : current.data.filter((request) => request.id !== event.data.requestID);
    if (data !== current.data) queryClient.setQueryData(query.queryKey, { ...current, data });
  }
}

export function reduceActiveSessions(
  current: Record<string, SessionActive> | undefined,
  event: OpenCodeEvent,
) {
  const sessions = current ?? {};
  if (event.type === "session.status") {
    return event.data.status.type === "idle"
      ? removeActiveSession(sessions, event.data.sessionID)
      : addActiveSession(sessions, event.data.sessionID);
  }
  if (event.type === "session.execution.started") {
    return addActiveSession(sessions, event.data.sessionID);
  }
  if (
    event.type === "session.execution.succeeded" ||
    event.type === "session.execution.failed" ||
    event.type === "session.execution.interrupted" ||
    event.type === "session.idle" ||
    event.type === "session.deleted"
  ) {
    return removeActiveSession(sessions, event.data.sessionID);
  }
  return current;
}

export function eventRequiresConnectionSnapshot(event: OpenCodeEvent) {
  return event.type === "installation.updated";
}

function eventInvalidationRoot(event: OpenCodeEvent): InvalidationRoot | undefined {
  if (advisoryLocationEventTypes.has(event.type)) return undefined;
  if (event.type === "vcs.branch.updated") return "vcs";
  if (inboxEventTypes.has(event.type)) return "inbox";
  if (event.type === "session.status" || event.type === "session.execution.started") {
    return undefined;
  }
  if (sessionMetadataEventTypes.has(event.type)) return "sessions";
  if (
    event.type.startsWith("session.") &&
    (isTranscriptReductionEventType(event.type) ||
      messageReconciliationEventTypes.has(event.type) ||
      knownSessionAdvisoryEventTypes.has(event.type))
  ) {
    return undefined;
  }
  if (event.type.startsWith("session.")) return "connection";
  if (event.type.startsWith("permission.")) return "permissions";
  if (event.type.startsWith("form.")) return "forms";
  if (event.type.startsWith("installation.")) return "health";
  return "connection";
}

const advisoryLocationEventTypes = new Set<string>([
  "filesystem.changed",
  "server.connected",
  "shell.created",
  "shell.deleted",
  "shell.exited",
]);

const inboxEventTypes = new Set<string>([
  "session.inbox.enqueued",
  "session.inbox.delivered",
  "session.inbox.cancelled",
  "session.inbox.delivery.changed",
]);

const knownSessionAdvisoryEventTypes = new Set<string>([
  "session.instructions.updated",
  "session.shell.started",
  "session.usage.updated",
]);

const sessionMetadataEventTypes = new Set<string>([
  "session.created",
  "session.agent.selected",
  "session.model.selected",
  "session.moved",
  "session.deleted",
  "session.renamed",
  "session.viewed",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.idle",
  "session.usage.recorded",
  "session.forked",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
]);

const messageReconciliationEventTypes = new Set<string>([
  "session.agent.selected",
  "session.model.selected",
  "session.moved",
  "session.inbox.delivered",
  "session.synthetic",
  "session.skill.activated",
  "session.shell.ended",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.compaction.ended",
  "session.compaction.failed",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
]);

function addActiveSession(sessions: Record<string, SessionActive>, sessionId: string) {
  if (sessions[sessionId]?.type === "running") return sessions;
  return { ...sessions, [sessionId]: { type: "running" as const } };
}

function removeActiveSession(sessions: Record<string, SessionActive>, sessionId: string) {
  if (!(sessionId in sessions)) return sessions;
  const next = { ...sessions };
  delete next[sessionId];
  return next;
}

function matchesRoot(
  query: Query,
  connectionId: string,
  root: InvalidationRoot,
  location?: LocationRef,
  sessionId?: string,
) {
  const key: QueryKey = query.queryKey;
  if (key[0] !== "opencode" || key[1] !== connectionId) return false;
  if (root === "sessions" && key[2] === "project") return key[4] === "sessions";
  if (root === "sessions" && key[2] === "followed-project-sessions") return true;
  if (
    location &&
    (key[2] !== "location" ||
      key[3] !== location.directory ||
      key[4] !== (location.workspaceID ?? null))
  ) {
    return false;
  }
  if (root === "messages") {
    return key.includes("messages") && (sessionId === undefined || key.includes(sessionId));
  }
  if (root === "inbox") {
    return key.includes("inbox") && (sessionId === undefined || key.includes(sessionId));
  }
  if (root === "sessions") return key.includes("sessions");
  return key.includes(root);
}

function isDescendingMessageQuery(key: QueryKey) {
  return key[5] === "messages" && key[8] === "desc";
}

function setInvalidationTarget(
  targets: Map<string, InvalidationTarget>,
  root: InvalidationRoot,
  location?: LocationRef,
  sessionId?: string,
) {
  targets.set(targetKey(root, location, sessionId), {
    ...(location ? { location } : {}),
    root,
    ...(sessionId ? { sessionId } : {}),
  });
}

function targetKey(root: InvalidationRoot, location?: LocationRef, sessionId?: string) {
  return `${root}\u0000${location?.directory ?? ""}\u0000${location?.workspaceID ?? ""}\u0000${sessionId ?? ""}`;
}

function defaultSchedule(callback: () => void) {
  requestAnimationFrame(callback);
}

function now() {
  return globalThis.performance?.now() ?? Date.now();
}
