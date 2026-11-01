import { type OpenCodeClient, startEventStreamProbe } from "@opencode2-mobile/opencode-adapter";
import { AppState, type AppStateStatus } from "react-native";

import type {
  LifecycleTransportPhase,
  LifecycleTransportResult,
} from "./use-lifecycle-transport-probe";

type EventStreamProbe = ReturnType<typeof startEventStreamProbe>;

export class LifecycleTransportProbeSession {
  private readonly cancelled = new Error("LIFECYCLE_PROBE_CANCELLED");
  private disposed = false;
  private healthController: AbortController | undefined;
  private initialProbe: EventStreamProbe | undefined;
  private recoveryProbe: EventStreamProbe | undefined;
  private rejectTransition: ((error: Error) => void) | undefined;
  private subscription: ReturnType<typeof AppState.addEventListener> | undefined;

  constructor(private readonly updatePhase: (next: LifecycleTransportPhase) => void) {}

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.subscription?.remove();
    this.healthController?.abort();
    void this.initialProbe?.stop().catch(() => undefined);
    void this.recoveryProbe?.stop().catch(() => undefined);
    this.rejectTransition?.(this.cancelled);
  }

  async run(
    streamClient: Pick<OpenCodeClient, "event">,
    restClient: Pick<OpenCodeClient, "server">,
  ): Promise<LifecycleTransportResult> {
    this.initialProbe = startEventStreamProbe(streamClient);
    const initial = await this.initialProbe.firstEvent;
    this.throwIfDisposed();
    this.updatePhase("ready-to-background");

    await this.waitForBackgroundRoundTrip();
    this.rejectTransition = undefined;
    this.initialProbe = undefined;
    this.throwIfDisposed();

    this.updatePhase("recovering");
    this.healthController = new AbortController();
    await withHealthDeadline(restClient, this.healthController, 10_000);
    this.throwIfDisposed();

    this.recoveryProbe = startEventStreamProbe(streamClient);
    const recovered = await this.recoveryProbe.firstEvent;
    await this.recoveryProbe.stop();
    this.recoveryProbe = undefined;
    return {
      backgroundCancellation: true,
      foregroundHealth: true,
      initialEventType: initial.eventType,
      reconnectEventType: recovered.eventType,
    } as const;
  }

  async cleanup() {
    this.subscription?.remove();
    await Promise.all([
      this.initialProbe?.stop().catch(() => undefined),
      this.recoveryProbe?.stop().catch(() => undefined),
    ]);
  }

  private throwIfDisposed() {
    if (this.disposed) throw this.cancelled;
  }

  private waitForBackgroundRoundTrip() {
    return new Promise<void>((resolve, reject) => {
      let backgroundSeen = false;
      let foregroundHandled = false;
      let cancellation: Promise<void> | undefined;
      this.rejectTransition = reject;
      this.subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
        if (!backgroundSeen && state === "background") {
          backgroundSeen = true;
          this.updatePhase("background-observed");
          cancellation = this.initialProbe?.stop() ?? Promise.resolve();
          cancellation.catch((error: unknown) => {
            this.subscription?.remove();
            reject(error);
          });
          return;
        }

        if (backgroundSeen && !foregroundHandled && state === "active") {
          foregroundHandled = true;
          this.subscription?.remove();
          (cancellation ?? Promise.resolve()).then(resolve, reject);
        }
      });
    });
  }
}

function withHealthDeadline(
  client: Pick<OpenCodeClient, "server">,
  controller: AbortController,
  timeoutMs: number,
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException("The operation timed out", "AbortError"));
    }, timeoutMs);

    client.server.status({ signal: controller.signal }).then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
