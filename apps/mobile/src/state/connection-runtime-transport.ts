import {
  createOpenCodeClient,
  type LocationRef,
  type OpenCodeClient,
  type OpenCodeEvent,
} from "@opencode2-mobile/opencode-adapter";
import { focusManager, onlineManager, type QueryClient } from "@tanstack/react-query";
import * as Network from "expo-network";
import type { Dispatch, SetStateAction } from "react";
import { AppState } from "react-native";

import { connectionAuthorizationHeader } from "../connections/connection-authorization";
import type { ConnectionCredential, ConnectionProfile } from "../connections/connection-profile";
import { boundedOpenCodeFetch, expoOpenCodeFetch } from "../expo-open-code-fetch";
import {
  type ConnectionCacheMetadata,
  writeConnectionCacheMetadata,
} from "./connection-cache-metadata";
import {
  ConnectionEventQueryBridge,
  eventRequiresConnectionSnapshot,
} from "./connection-event-query-bridge";
import type {
  RuntimeDiagnosticEntry,
  TransportDiagnosticMetrics,
} from "./connection-runtime-context";
import {
  ConnectionTransportCoordinator,
  type ConnectionTransportCoordinatorOptions,
  type ConnectionTransportStatus,
} from "./connection-transport-coordinator";
import { openCodeQueryKeys } from "./open-code-query-keys";
import { recordTranscriptProjectionFrame } from "./transcript-performance";

export type ConnectionRuntimeTransportSink = {
  isActive: () => boolean;
  metrics: () => TransportDiagnosticMetrics;
  recordDiagnostic: (entry: RuntimeDiagnosticEntry) => void;
  setCacheMetadata: (metadata: ConnectionCacheMetadata | undefined) => void;
  setEventLocations: Dispatch<SetStateAction<LocationRef[]>>;
  setReconciliationRevision: Dispatch<SetStateAction<number>>;
  setRestClientState: (state: { client: OpenCodeClient; connectionId: string }) => void;
  setServerVersion: (version: string | undefined) => void;
  setStatus: (status: ConnectionTransportStatus, attempt: number) => void;
};

type ConnectionTransportProfile = Pick<ConnectionProfile, "baseUrl" | "id" | "updatedAtMs">;

export function startConnectionTransport(
  profile: ConnectionTransportProfile,
  credential: ConnectionCredential | undefined,
  queryClient: QueryClient,
  sink: ConnectionRuntimeTransportSink,
) {
  const authorization = credential ? connectionAuthorizationHeader(credential) : undefined;
  const restClient = createOpenCodeClient({
    ...(authorization ? { authorization } : {}),
    baseUrl: profile.baseUrl,
    fetch: boundedOpenCodeFetch,
  });
  const eventClient = createOpenCodeClient({
    ...(authorization ? { authorization } : {}),
    baseUrl: profile.baseUrl,
    fetch: expoOpenCodeFetch,
  });
  sink.setRestClientState({ client: restClient, connectionId: profile.id });
  const bridge = new ConnectionEventQueryBridge(
    queryClient,
    profile.id,
    undefined,
    recordTranscriptProjectionFrame,
  );
  const coordinator = new ConnectionTransportCoordinator({
    eventClient,
    ...connectionTransportCallbacks(profile, queryClient, bridge, sink),
    restClient,
    shouldReconcileEvent: eventRequiresConnectionSnapshot,
  });

  const foreground = AppState.currentState === "active";
  coordinator.setForeground(foreground);
  focusManager.setFocused(foreground);
  void Network.getNetworkStateAsync()
    .then((network) => {
      if (!sink.isActive()) return;
      const online = network.isConnected !== false;
      onlineManager.setOnline(online);
      coordinator.setOnline(online);
      coordinator.start();
    })
    .catch(() => coordinator.start());
  return coordinator;
}

export function connectionTransportCallbacks(
  profile: ConnectionTransportProfile,
  queryClient: QueryClient,
  bridge: Pick<ConnectionEventQueryBridge, "apply" | "streamRestarted" | "uncertain">,
  sink: ConnectionRuntimeTransportSink,
): Pick<
  ConnectionTransportCoordinatorOptions,
  "onDurableGap" | "onEvent" | "onGeneration" | "onSnapshot" | "onStatus" | "onUncertain"
> {
  return {
    onEvent(event) {
      bridge.apply(event);
      const eventLocation = event.location;
      if (eventLocation) {
        sink.setEventLocations((current) => nextEventLocations(current, event, eventLocation));
      }
      sink.recordDiagnostic({ atMs: Date.now(), kind: "event", value: redactedEventType(event) });
    },
    onDurableGap() {
      sink.metrics().durableSequenceGaps += 1;
    },
    onGeneration(reason) {
      bridge.streamRestarted();
      sink.metrics().generationStarts += 1;
      sink.metrics().snapshotRequests += 1;
      sink.recordDiagnostic({ atMs: Date.now(), kind: "generation", value: reason });
    },
    onSnapshot(snapshot) {
      sink.metrics().snapshotsInstalled += 1;
      sink.setServerVersion(snapshot.health.version);
      queryClient.setQueryData(openCodeQueryKeys.health(profile.id), snapshot.health);
      queryClient.setQueryData(openCodeQueryKeys.projects(profile.id), snapshot.projects);
      queryClient.setQueryData(
        openCodeQueryKeys.activeSessions(profile.id),
        snapshot.activeSessions,
      );
      sink.setReconciliationRevision((current) => current + 1);
      void queryClient.invalidateQueries({
        predicate: (query) => isConnectionLocationQuery(query.queryKey, profile.id),
        refetchType: "active",
      });
      void writeConnectionCacheMetadata(profile.id, profile.updatedAtMs, snapshot)
        .then((metadata) => {
          if (sink.isActive()) sink.setCacheMetadata(metadata);
        })
        .catch(() => undefined);
    },
    onStatus(nextStatus, attempt) {
      sink.setStatus(nextStatus, attempt);
      sink.recordDiagnostic({ atMs: Date.now(), attempt, kind: "status", value: nextStatus });
    },
    onUncertain(event) {
      bridge.uncertain(event);
    },
  };
}

function nextEventLocations(current: LocationRef[], event: OpenCodeEvent, location: LocationRef) {
  const next = appendEventLocation(current, location);
  // Reconsider retired locations when actual attention arrives,
  // even if a generic event already introduced the location.
  return event.type === "permission.asked" || event.type === "form.created" ? [...next] : next;
}

function isConnectionLocationQuery(queryKey: readonly unknown[], connectionId: string) {
  return (
    queryKey[0] === "opencode" &&
    queryKey[1] === connectionId &&
    (queryKey[2] === "location" || queryKey[2] === "location-default")
  );
}

function redactedEventType(event: OpenCodeEvent) {
  return /^[a-z][a-z0-9.-]{0,127}$/.test(event.type) ? event.type : "unknown";
}

export function appendEventLocation(current: LocationRef[], location: LocationRef) {
  if (
    current.some(
      (candidate) =>
        candidate.directory === location.directory &&
        candidate.workspaceID === location.workspaceID,
    )
  ) {
    return current;
  }
  return [...current, location].slice(-256);
}
