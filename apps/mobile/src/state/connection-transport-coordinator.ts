import {
  classifyOpenCodeError,
  type OpenCodeClient,
  type OpenCodeEvent,
  type ProjectListOutput,
  type ServiceHealth,
  type SessionActive,
} from "@opencode2-mobile/opencode-adapter";

export type ConnectionTransportStatus =
  | "connected"
  | "connecting"
  | "idle"
  | "incompatible"
  | "offline"
  | "reconnecting"
  | "stale"
  | "unauthorized";

export type ConnectionSnapshot = {
  activeSessions: Record<string, SessionActive>;
  health: ServiceHealth;
  projects: ProjectListOutput;
};

type SnapshotClient = Pick<OpenCodeClient, "health" | "project" | "session">;
type EventClient = Pick<OpenCodeClient, "event">;

export type ConnectionTransportCoordinatorOptions = {
  eventClient: EventClient;
  maxBufferedEvents?: number;
  maxSeenEventIds?: number;
  onEvent: (event: OpenCodeEvent) => void;
  onSnapshot: (snapshot: ConnectionSnapshot) => void;
  onStatus: (status: ConnectionTransportStatus, reconnectAttempt: number) => void;
  onUncertain: (event?: OpenCodeEvent) => void;
  random?: () => number;
  restClient: SnapshotClient;
  retryBaseMs?: number;
  retryMaxMs?: number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  shouldReconcileEvent?: (event: OpenCodeEvent) => boolean;
  snapshotTimeoutMs?: number;
  unschedule?: (handle: unknown) => void;
};

export class ConnectionTransportCoordinator {
  private activeGeneration:
    | {
        controller: AbortController;
        id: number;
        snapshotTimeout: ReturnType<typeof setTimeout> | undefined;
        uncertain: boolean;
      }
    | undefined;
  private readonly durableSequences = new Map<string, number>();
  private foreground = true;
  private generation = 0;
  private online = true;
  private reconnectAttempt = 0;
  private retryHandle: unknown | undefined;
  private readonly seenEventIds = new Set<string>();
  private readonly seenEventOrder: string[] = [];
  private started = false;

  constructor(private readonly options: ConnectionTransportCoordinatorOptions) {}

  start() {
    if (this.started) return;
    this.started = true;
    if (!this.online) this.setStatus("offline");
    else if (!this.foreground) this.setStatus("stale");
    else this.openGeneration();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.clearRetry();
    this.cancelGeneration();
    this.setStatus("idle");
  }

  setForeground(foreground: boolean) {
    if (this.foreground === foreground) return;
    this.foreground = foreground;
    if (!this.started) return;
    if (!foreground) {
      this.clearRetry();
      this.cancelGeneration();
      this.setStatus(this.online ? "stale" : "offline");
    } else if (this.online) {
      this.openGeneration();
    }
  }

  setOnline(online: boolean) {
    if (this.online === online) return;
    this.online = online;
    if (!this.started) return;
    if (!online) {
      this.clearRetry();
      this.cancelGeneration();
      this.setStatus("offline");
    } else if (this.foreground) {
      this.openGeneration();
    }
  }

  reconcile() {
    if (this.started && this.online && this.foreground) this.openGeneration();
  }

  private openGeneration() {
    this.clearRetry();
    this.cancelGeneration();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.activeGeneration = {
      controller,
      id: generation,
      snapshotTimeout: setTimeout(
        () => this.failGeneration(generation, new Error("SNAPSHOT_TIMEOUT")),
        Math.max(1, this.options.snapshotTimeoutMs ?? 10_000),
      ),
      uncertain: false,
    };
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    const buffer: OpenCodeEvent[] = [];
    let buffering = true;
    void this.consumeEvents(generation, controller, buffer, () => buffering);

    const requestOptions = { signal: controller.signal };
    void Promise.all([
      this.options.restClient.health.get(requestOptions),
      this.options.restClient.project.list(requestOptions),
      this.options.restClient.session.active(requestOptions),
    ])
      .then(([health, projects, activeSessions]) => {
        if (!this.isCurrent(generation)) return;
        this.clearSnapshotTimeout(generation);
        if (!isConnectionSnapshot(health, projects, activeSessions)) {
          this.cancelGeneration();
          this.options.onUncertain();
          this.setStatus("incompatible");
          return;
        }

        this.options.onSnapshot({ activeSessions, health, projects });
        for (const event of buffer) {
          if (!this.applyEvent(event)) return;
        }
        buffer.length = 0;
        buffering = false;
        if (this.activeGeneration?.uncertain) {
          this.openGeneration();
          return;
        }
        this.reconnectAttempt = 0;
        this.setStatus("connected");
      })
      .catch((error: unknown) => this.failGeneration(generation, error));
  }

  private async consumeEvents(
    generation: number,
    controller: AbortController,
    buffer: OpenCodeEvent[],
    isBuffering: () => boolean,
  ) {
    try {
      for await (const event of this.options.eventClient.event.subscribe({
        signal: controller.signal,
      })) {
        if (!this.isCurrent(generation)) return;
        if (isBuffering()) {
          if (buffer.length >= (this.options.maxBufferedEvents ?? 256)) {
            this.failGeneration(generation, new Error("EVENT_BUFFER_OVERFLOW"), true);
            return;
          }
          buffer.push(event);
        } else {
          if (!this.applyEvent(event)) return;
          if (this.activeGeneration?.uncertain) {
            this.openGeneration();
            return;
          }
        }
      }
      this.failGeneration(generation, new Error("EVENT_STREAM_ENDED"), true);
    } catch (error) {
      this.failGeneration(generation, error, true);
    }
  }

  private applyEvent(event: OpenCodeEvent) {
    if (!isOpenCodeEventEnvelope(event)) {
      const generation = this.activeGeneration?.id;
      if (generation !== undefined) {
        this.failGeneration(generation, new Error("MALFORMED_EVENT"), true);
      }
      return false;
    }
    if (this.seenEventIds.has(event.id)) return true;
    this.seenEventIds.add(event.id);
    this.seenEventOrder.push(event.id);
    const maxSeenEventIds = this.options.maxSeenEventIds ?? 1024;
    while (this.seenEventOrder.length > maxSeenEventIds) {
      const removed = this.seenEventOrder.shift();
      if (removed) this.seenEventIds.delete(removed);
    }

    if ("durable" in event) {
      const previous = this.durableSequences.get(event.durable.aggregateID);
      if (previous !== undefined && event.durable.seq > previous + 1) {
        if (this.activeGeneration) this.activeGeneration.uncertain = true;
        this.options.onUncertain(event);
      }
      if (previous !== undefined && event.durable.seq <= previous) return true;
      this.durableSequences.set(event.durable.aggregateID, event.durable.seq);
    }
    this.options.onEvent(event);
    if (this.options.shouldReconcileEvent?.(event) && this.activeGeneration) {
      this.activeGeneration.uncertain = true;
      this.options.onUncertain(event);
    }
    return true;
  }

  private failGeneration(generation: number, error: unknown, uncertain = false) {
    const active = this.activeGeneration;
    if (!active || active.id !== generation || active.controller.signal.aborted) return;
    this.cancelGeneration();
    if (uncertain) this.options.onUncertain();

    const kind = classifyOpenCodeError(error);
    if (kind === "UNAUTHORIZED") {
      this.setStatus("unauthorized");
      return;
    }
    if (kind === "INCOMPATIBLE") {
      this.setStatus("incompatible");
      return;
    }
    if (!this.online) {
      this.setStatus("offline");
      return;
    }
    if (!this.foreground) {
      this.setStatus("stale");
      return;
    }

    this.reconnectAttempt += 1;
    this.setStatus("reconnecting");
    const cap = Math.min(
      this.options.retryMaxMs ?? 30_000,
      (this.options.retryBaseMs ?? 500) * 2 ** (this.reconnectAttempt - 1),
    );
    const delay = Math.floor((this.options.random ?? Math.random)() * cap);
    this.retryHandle = (this.options.schedule ?? defaultSchedule)(() => {
      this.retryHandle = undefined;
      if (this.started && this.online && this.foreground) this.openGeneration();
    }, delay);
  }

  private isCurrent(generation: number) {
    return this.started && this.activeGeneration?.id === generation;
  }

  private cancelGeneration() {
    const active = this.activeGeneration;
    this.activeGeneration = undefined;
    if (active?.snapshotTimeout !== undefined) clearTimeout(active.snapshotTimeout);
    active?.controller.abort();
  }

  private clearSnapshotTimeout(generation: number) {
    const active = this.activeGeneration;
    if (!active || active.id !== generation || active.snapshotTimeout === undefined) return;
    clearTimeout(active.snapshotTimeout);
    active.snapshotTimeout = undefined;
  }

  private clearRetry() {
    if (this.retryHandle === undefined) return;
    (this.options.unschedule ?? defaultUnschedule)(this.retryHandle);
    this.retryHandle = undefined;
  }

  private setStatus(status: ConnectionTransportStatus) {
    this.options.onStatus(status, this.reconnectAttempt);
  }
}

function defaultSchedule(callback: () => void, delayMs: number) {
  return setTimeout(callback, delayMs);
}

function defaultUnschedule(handle: unknown) {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function isConnectionSnapshot(
  health: unknown,
  projects: unknown,
  activeSessions: unknown,
): health is ServiceHealth {
  if (
    !isRecord(health) ||
    health.healthy !== true ||
    typeof health.version !== "string" ||
    health.version.length === 0 ||
    health.version.length > 128 ||
    !Number.isSafeInteger(health.pid)
  ) {
    return false;
  }
  if (
    !Array.isArray(projects) ||
    !projects.every(
      (project) =>
        isRecord(project) &&
        typeof project.id === "string" &&
        typeof project.canonical === "string" &&
        Array.isArray(project.sandboxes) &&
        isRecord(project.time) &&
        typeof project.time.created === "number" &&
        typeof project.time.updated === "number",
    )
  ) {
    return false;
  }
  return (
    isRecord(activeSessions) &&
    Object.entries(activeSessions).every(
      ([sessionId, active]) =>
        sessionId.startsWith("ses") && isRecord(active) && active.type === "running",
    )
  );
}

function isOpenCodeEventEnvelope(event: unknown): event is OpenCodeEvent {
  if (
    !isRecord(event) ||
    typeof event.id !== "string" ||
    event.id.length === 0 ||
    event.id.length > 256 ||
    typeof event.type !== "string" ||
    !/^[a-z][a-z0-9.-]{0,127}$/.test(event.type) ||
    !isRecord(event.data)
  ) {
    return false;
  }
  if (
    "location" in event &&
    event.location !== undefined &&
    (!isRecord(event.location) ||
      typeof event.location.directory !== "string" ||
      event.location.directory.length === 0 ||
      event.location.directory.length > 4096 ||
      (event.location.workspaceID !== undefined && typeof event.location.workspaceID !== "string"))
  ) {
    return false;
  }
  if (event.type === "session.status") {
    if (
      typeof event.data.sessionID !== "string" ||
      !isRecord(event.data.status) ||
      (event.data.status.type !== "idle" &&
        event.data.status.type !== "busy" &&
        event.data.status.type !== "retry")
    ) {
      return false;
    }
  } else if (
    event.type === "session.execution.started" ||
    event.type === "session.execution.succeeded" ||
    event.type === "session.execution.failed" ||
    event.type === "session.execution.interrupted" ||
    event.type === "session.idle" ||
    event.type === "session.deleted"
  ) {
    if (typeof event.data.sessionID !== "string") return false;
  }
  if (!("durable" in event)) return true;
  const durable = event.durable;
  return (
    isRecord(durable) &&
    typeof durable.aggregateID === "string" &&
    durable.aggregateID.length > 0 &&
    durable.aggregateID.length <= 256 &&
    Number.isSafeInteger(durable.seq) &&
    typeof durable.version === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
