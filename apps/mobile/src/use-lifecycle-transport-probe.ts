import type { OpenCodeClient } from "@opencode2-mobile/opencode-adapter";
import { useEffect, useRef, useState } from "react";

import { LifecycleTransportProbeSession } from "./lifecycle-transport-probe-session";

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

export function useLifecycleTransportProbe() {
  const [phase, setPhase] = useState<LifecycleTransportPhase>("idle");
  const [result, setResult] = useState<LifecycleTransportResult>();
  const mounted = useRef(true);
  const active = useRef<LifecycleTransportProbeSession | undefined>(undefined);

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
    restClient: Pick<OpenCodeClient, "server">,
  ) {
    if (active.current) throw new Error("LIFECYCLE_PROBE_ALREADY_RUNNING");

    setResult(undefined);
    updatePhase("opening");
    const control = new LifecycleTransportProbeSession(updatePhase);
    active.current = control;

    try {
      const next = await control.run(streamClient, restClient);
      if (mounted.current) setResult(next);
      updatePhase("passed");
      return next;
    } catch (error) {
      updatePhase("failed");
      throw error;
    } finally {
      await control.cleanup();
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
