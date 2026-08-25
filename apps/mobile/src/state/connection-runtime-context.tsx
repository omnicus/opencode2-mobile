import {
  createOpenCodeClient,
  type LocationRef,
  type OpenCodeClient,
  type OpenCodeEvent,
} from "@opencode2-mobile/opencode-adapter";
import { focusManager, onlineManager, useQueryClient } from "@tanstack/react-query";
import * as Network from "expo-network";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { applicationName } from "../application-name";
import { connectionAuthorizationHeader } from "../connections/connection-authorization";
import { useConnections } from "../connections/connections-context";
import { boundedOpenCodeFetch, expoOpenCodeFetch } from "../expo-open-code-fetch";
import {
  type ConnectionCacheMetadata,
  readConnectionCacheMetadata,
  writeConnectionCacheMetadata,
} from "./connection-cache-metadata";
import {
  ConnectionEventQueryBridge,
  eventRequiresConnectionSnapshot,
} from "./connection-event-query-bridge";
import {
  ConnectionTransportCoordinator,
  type ConnectionTransportStatus,
} from "./connection-transport-coordinator";
import { openCodeQueryKeys } from "./open-code-query-keys";
import {
  formatTranscriptPerformanceDiagnostics,
  getTranscriptPerformanceMetrics,
  recordTranscriptProjectionFrame,
  resetTranscriptPerformanceMetrics,
} from "./transcript-performance";

type ConnectionRuntimeContextValue = {
  cacheMetadata?: ConnectionCacheMetadata;
  connectionId?: string;
  connectionUpdatedAtMs?: number;
  eventLocations: LocationRef[];
  getDiagnosticsText: () => string;
  includeAttentionLocation: (location: LocationRef) => void;
  reconciliationRevision: number;
  reconnectAttempt: number;
  restClient?: OpenCodeClient;
  serverVersion?: string;
  status: ConnectionTransportStatus;
};

const ConnectionRuntimeContext = createContext<ConnectionRuntimeContextValue | undefined>(
  undefined,
);

export function ConnectionRuntimeProvider({ children }: { children: ReactNode }) {
  const connections = useConnections();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionTransportStatus>("idle");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [cacheMetadata, setCacheMetadata] = useState<ConnectionCacheMetadata>();
  const [serverVersion, setServerVersion] = useState<string>();
  const [eventLocations, setEventLocations] = useState<LocationRef[]>([]);
  const [reconciliationRevision, setReconciliationRevision] = useState(0);
  const [restClientState, setRestClientState] = useState<{
    client: OpenCodeClient;
    connectionId: string;
  }>();
  const statusRef = useRef<ConnectionTransportStatus>("idle");
  const diagnosticsRef = useRef<RuntimeDiagnosticEntry[]>([]);
  const selectedRevisionRef = useRef<{ id: string; updatedAtMs: number } | undefined>(undefined);
  const selected = connections.profiles.find(
    (profile) => profile.id === connections.selectedProfileId,
  );
  const includeAttentionLocation = useCallback((location: LocationRef) => {
    setEventLocations((current) => appendEventLocation(current, location));
  }, []);

  useEffect(() => {
    if (!selected) {
      resetTranscriptPerformanceMetrics();
      selectedRevisionRef.current = undefined;
      statusRef.current = "idle";
      diagnosticsRef.current = [];
      setStatus("idle");
      setReconnectAttempt(0);
      setCacheMetadata(undefined);
      setServerVersion(undefined);
      setEventLocations([]);
      setReconciliationRevision(0);
      setRestClientState(undefined);
      return;
    }

    let active = true;
    let coordinator: ConnectionTransportCoordinator | undefined;
    const previousRevision = selectedRevisionRef.current;
    selectedRevisionRef.current = { id: selected.id, updatedAtMs: selected.updatedAtMs };
    if (
      previousRevision?.id === selected.id &&
      previousRevision.updatedAtMs !== selected.updatedAtMs
    ) {
      queryClient.removeQueries({ queryKey: openCodeQueryKeys.connection(selected.id) });
    }
    statusRef.current = "connecting";
    diagnosticsRef.current = [];
    resetTranscriptPerformanceMetrics();
    setStatus("connecting");
    setReconnectAttempt(0);
    setCacheMetadata(undefined);
    setServerVersion(undefined);
    setEventLocations([]);
    setReconciliationRevision(0);
    setRestClientState(undefined);
    void readConnectionCacheMetadata(selected.id, selected.updatedAtMs)
      .then((metadata) => {
        if (active) setCacheMetadata(metadata);
      })
      .catch(() => undefined);

    connections
      .readCredential(selected)
      .then((credential) => {
        if (!active) return;
        const authorization = credential ? connectionAuthorizationHeader(credential) : undefined;
        const restClient = createOpenCodeClient({
          ...(authorization ? { authorization } : {}),
          baseUrl: selected.baseUrl,
          fetch: boundedOpenCodeFetch,
        });
        const eventClient = createOpenCodeClient({
          ...(authorization ? { authorization } : {}),
          baseUrl: selected.baseUrl,
          fetch: expoOpenCodeFetch,
        });
        setRestClientState({ client: restClient, connectionId: selected.id });
        const bridge = new ConnectionEventQueryBridge(
          queryClient,
          selected.id,
          undefined,
          recordTranscriptProjectionFrame,
        );
        coordinator = new ConnectionTransportCoordinator({
          eventClient,
          onEvent(event) {
            bridge.apply(event);
            const eventLocation = event.location;
            if (eventLocation) {
              setEventLocations((current) => appendEventLocation(current, eventLocation));
            }
            diagnosticsRef.current = appendDiagnostic(diagnosticsRef.current, {
              atMs: Date.now(),
              kind: "event",
              value: redactedEventType(event),
            });
          },
          onSnapshot(snapshot) {
            setServerVersion(snapshot.health.version);
            queryClient.setQueryData(openCodeQueryKeys.health(selected.id), snapshot.health);
            queryClient.setQueryData(openCodeQueryKeys.projects(selected.id), snapshot.projects);
            queryClient.setQueryData(
              openCodeQueryKeys.activeSessions(selected.id),
              snapshot.activeSessions,
            );
            setReconciliationRevision((current) => current + 1);
            void queryClient.invalidateQueries({
              predicate: (query) =>
                query.queryKey[0] === "opencode" &&
                query.queryKey[1] === selected.id &&
                (query.queryKey[2] === "location" || query.queryKey[2] === "location-default"),
              refetchType: "active",
            });
            void writeConnectionCacheMetadata(selected.id, selected.updatedAtMs, snapshot)
              .then((metadata) => {
                if (active) setCacheMetadata(metadata);
              })
              .catch(() => undefined);
          },
          onStatus(nextStatus, attempt) {
            statusRef.current = nextStatus;
            setStatus(nextStatus);
            setReconnectAttempt(attempt);
            diagnosticsRef.current = appendDiagnostic(diagnosticsRef.current, {
              atMs: Date.now(),
              attempt,
              kind: "status",
              value: nextStatus,
            });
          },
          onUncertain(event) {
            bridge.uncertain(event);
          },
          restClient,
          shouldReconcileEvent: eventRequiresConnectionSnapshot,
        });

        const foreground = AppState.currentState === "active";
        coordinator.setForeground(foreground);
        focusManager.setFocused(foreground);
        void Network.getNetworkStateAsync()
          .then((network) => {
            if (!active || !coordinator) return;
            const online = network.isConnected !== false;
            onlineManager.setOnline(online);
            coordinator.setOnline(online);
            coordinator.start();
          })
          .catch(() => coordinator?.start());
      })
      .catch(() => {
        if (active) {
          statusRef.current = "unauthorized";
          setStatus("unauthorized");
        }
      });

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      const foreground = nextState === "active";
      focusManager.setFocused(foreground);
      coordinator?.setForeground(foreground);
    });
    const networkSubscription = Network.addNetworkStateListener((network) => {
      const online = network.isConnected !== false;
      onlineManager.setOnline(online);
      coordinator?.setOnline(online);
    });

    return () => {
      active = false;
      appStateSubscription.remove();
      networkSubscription.remove();
      coordinator?.stop();
    };
  }, [connections.readCredential, queryClient, selected]);

  return (
    <ConnectionRuntimeContext
      value={{
        ...(cacheMetadata ? { cacheMetadata } : {}),
        ...(selected ? { connectionId: selected.id } : {}),
        ...(selected ? { connectionUpdatedAtMs: selected.updatedAtMs } : {}),
        eventLocations,
        getDiagnosticsText: () =>
          [
            formatDiagnostics(statusRef.current, diagnosticsRef.current),
            formatTranscriptPerformanceDiagnostics(getTranscriptPerformanceMetrics()),
          ].join("\n\n"),
        includeAttentionLocation,
        reconnectAttempt,
        reconciliationRevision,
        ...(selected && restClientState?.connectionId === selected.id
          ? { restClient: restClientState.client }
          : {}),
        ...(serverVersion ? { serverVersion } : {}),
        status,
      }}
    >
      {children}
    </ConnectionRuntimeContext>
  );
}

export function useConnectionRuntime() {
  const value = use(ConnectionRuntimeContext);
  if (!value) throw new Error("ConnectionRuntimeProvider is missing");
  return value;
}

function redactedEventType(event: OpenCodeEvent) {
  return /^[a-z][a-z0-9.-]{0,127}$/.test(event.type) ? event.type : "unknown";
}

export type RuntimeDiagnosticEntry = {
  atMs: number;
  attempt?: number;
  count?: number;
  kind: "event" | "status";
  value: string;
};

export function appendDiagnostic(current: RuntimeDiagnosticEntry[], entry: RuntimeDiagnosticEntry) {
  const next = [...current];
  if (entry.kind === "event") {
    const existingIndex = next.findLastIndex(
      (currentEntry) =>
        currentEntry.kind === "event" &&
        currentEntry.value === entry.value &&
        entry.atMs - currentEntry.atMs <= 1_000,
    );
    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      if (existing) {
        next.splice(existingIndex, 1);
        next.push({ ...entry, count: (existing.count ?? 1) + 1 });
      }
    } else {
      next.push(entry);
    }
  } else {
    next.push(entry);
  }

  while (next.length > 64) {
    const oldestEventIndex = next.findIndex((currentEntry) => currentEntry.kind === "event");
    next.splice(oldestEventIndex >= 0 ? oldestEventIndex : 0, 1);
  }
  return next;
}

export function formatDiagnostics(
  status: ConnectionTransportStatus,
  diagnostics: RuntimeDiagnosticEntry[],
) {
  const lines = [`${applicationName} redacted transport diagnostics`, `current_status=${status}`];
  for (const entry of diagnostics) {
    lines.push(
      `${formatDiagnosticTimestamp(entry.atMs)} ${entry.kind}=${entry.value}${
        entry.attempt ? ` attempt=${entry.attempt}` : ""
      }${entry.count && entry.count > 1 ? ` count=${entry.count}` : ""}`,
    );
  }
  return lines.join("\n");
}

export function formatDiagnosticTimestamp(atMs: number) {
  const date = new Date(atMs);
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${padTimestamp(date.getMonth() + 1)}-${padTimestamp(
    date.getDate(),
  )}T${padTimestamp(date.getHours())}:${padTimestamp(date.getMinutes())}:${padTimestamp(
    date.getSeconds(),
  )}.${String(date.getMilliseconds()).padStart(3, "0")}${offsetSign}${padTimestamp(
    Math.floor(absoluteOffset / 60),
  )}:${padTimestamp(absoluteOffset % 60)}`;
}

function padTimestamp(value: number) {
  return String(value).padStart(2, "0");
}

function appendEventLocation(current: LocationRef[], location: LocationRef) {
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
