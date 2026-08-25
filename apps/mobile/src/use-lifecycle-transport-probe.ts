import { type OpenCodeClient, startEventStreamProbe } from "@opencode2-mobile/opencode-adapter";
import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

export type LifecycleTransportPhase =
  | "background-observed"
  | "failed"
  | "idle"
  | "opening"
  | "passed"
  | "ready-to-background"
  | "recovering";

export type LifecycleTransportResult = {
  backgroundCancellation: true;
  initialEventType: string;
  reconnectEventType: string;
  foregroundHealth: true;
};

type ProbeControl = {
  dispose: () => void;
};

export function useLifecycleTransportProbe() {
  const [phase, setPhase] = useState<LifecycleTransportPhase>("idle");
  const [result, setResult] = useState<LifecycleTransportResult>();
  const mounted = useRef(true);
  const active = useRef<ProbeControl | undefined>(undefined);

  useEffect(() => {
    return () => {
      mounted.current = false;
      active.current?.dispose();
    };
  }, []);

  function updatePhase(next: LifecycleTransportPhase) {
    if (mounted.current) setPhase(next);
  }

  async function run(
    streamClient: Pick<OpenCodeClient, "event">,
    restClient: Pick<OpenCodeClient, "health">,
  ) {
    if (active.current) throw new Error("LIFECYCLE_PROBE_ALREADY_RUNNING");

    setResult(undefined);
    updatePhase("opening");
    let disposed = false;
    let rejectTransition: ((error: Error) => void) | undefined;
    let subscription: ReturnType<typeof AppState.addEventListener> | undefined;
    let healthController: AbortController | undefined;
    let initialProbe: ReturnType<typeof startEventStreamProbe> | undefined;
    let recoveryProbe: ReturnType<typeof startEventStreamProbe> | undefined;
    const cancelled = new Error("LIFECYCLE_PROBE_CANCELLED");

    const control: ProbeControl = {
      dispose() {
        if (disposed) return;
        disposed = true;
        subscription?.remove();
        healthController?.abort();
        void initialProbe?.stop().catch(() => undefined);
        void recoveryProbe?.stop().catch(() => undefined);
        rejectTransition?.(cancelled);
      },
    };
    active.current = control;

    try {
      initialProbe = startEventStreamProbe(streamClient);
      const initial = await initialProbe.firstEvent;
      if (disposed) throw cancelled;
      updatePhase("ready-to-background");

      await new Promise<void>((resolve, reject) => {
        let backgroundSeen = false;
        let foregroundHandled = false;
        let cancellation: Promise<void> | undefined;
        rejectTransition = reject;
        subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
          if (!backgroundSeen && state === "background") {
            backgroundSeen = true;
            updatePhase("background-observed");
            cancellation = initialProbe?.stop() ?? Promise.resolve();
            cancellation.catch((error: unknown) => {
              subscription?.remove();
              reject(error);
            });
            return;
          }

          if (backgroundSeen && !foregroundHandled && state === "active") {
            foregroundHandled = true;
            subscription?.remove();
            (cancellation ?? Promise.resolve()).then(resolve, reject);
          }
        });
      });
      rejectTransition = undefined;
      initialProbe = undefined;
      if (disposed) throw cancelled;

      updatePhase("recovering");
      healthController = new AbortController();
      await withHealthDeadline(restClient, healthController, 10_000);
      if (disposed) throw cancelled;

      recoveryProbe = startEventStreamProbe(streamClient);
      const recovered = await recoveryProbe.firstEvent;
      await recoveryProbe.stop();
      recoveryProbe = undefined;
      const next = {
        backgroundCancellation: true,
        foregroundHealth: true,
        initialEventType: initial.eventType,
        reconnectEventType: recovered.eventType,
      } as const;
      if (mounted.current) setResult(next);
      updatePhase("passed");
      return next;
    } catch (error) {
      updatePhase("failed");
      throw error;
    } finally {
      subscription?.remove();
      await Promise.all([
        initialProbe?.stop().catch(() => undefined),
        recoveryProbe?.stop().catch(() => undefined),
      ]);
      if (active.current === control) active.current = undefined;
    }
  }

  function reset() {
    if (active.current) return;
    setResult(undefined);
    updatePhase("idle");
  }

  return {
    phase,
    reset,
    result,
    run,
    running: !["failed", "idle", "passed"].includes(phase),
  };
}

function withHealthDeadline(
  client: Pick<OpenCodeClient, "health">,
  controller: AbortController,
  timeoutMs: number,
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException("The operation timed out", "AbortError"));
    }, timeoutMs);

    client.health.get({ signal: controller.signal }).then(
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
