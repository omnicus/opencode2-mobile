import {
  type LocationRef,
  type OpenCodeClient,
  openCodeClientContractVersion,
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

import { applicationBuild, applicationName, applicationVersion } from "../application-name";
import type { ConnectionProfile } from "../connections/connection-profile";
import { useConnections } from "../connections/connections-context";
import {
  type ConnectionCacheMetadata,
  readConnectionCacheMetadata,
} from "./connection-cache-metadata";
import { appendEventLocation, startConnectionTransport } from "./connection-runtime-transport";
import type {
  ConnectionTransportCoordinator,
  ConnectionTransportStatus,
} from "./connection-transport-coordinator";
import { openCodeQueryKeys } from "./open-code-query-keys";
import {
  formatTranscriptPerformanceDiagnostics,
  getTranscriptPerformanceMetrics,
  resetTranscriptPerformanceMetrics,
} from "./transcript-performance";

type ConnectionRuntimeContextValue = {
  attentionLocations: LocationRef[];
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
  const selected = connections.profiles.find(
    (profile) => profile.id === connections.selectedProfileId,
  );
  const runtime = useConnectionTransport(selected, connections.readCredential);
  const { cacheMetadata, restClientState, serverVersion } = runtime;

  return (
    <ConnectionRuntimeContext
      value={{
        attentionLocations: runtime.attentionLocations,
        ...(cacheMetadata ? { cacheMetadata } : {}),
        ...(selected ? { connectionId: selected.id } : {}),
        ...(selected ? { connectionUpdatedAtMs: selected.updatedAtMs } : {}),
        eventLocations: runtime.eventLocations,
        getDiagnosticsText: () =>
          [
            formatDiagnostics(runtime.statusRef.current, runtime.diagnosticsRef.current, {
              appBuild: applicationBuild,
              appVersion: applicationVersion,
              clientContractVersion: openCodeClientContractVersion,
              metrics: runtime.transportMetricsRef.current,
              ...(serverVersion ? { serverVersion } : {}),
            }),
            formatTranscriptPerformanceDiagnostics(getTranscriptPerformanceMetrics()),
          ].join("\n\n"),
        includeAttentionLocation: runtime.includeAttentionLocation,
        reconnectAttempt: runtime.reconnectAttempt,
        reconciliationRevision: runtime.reconciliationRevision,
        ...(selected && restClientState?.connectionId === selected.id
          ? { restClient: restClientState.client }
          : {}),
        ...(serverVersion ? { serverVersion } : {}),
        status: runtime.status,
      }}
    >
      {children}
    </ConnectionRuntimeContext>
  );
}

function useConnectionTransport(
  selected: ConnectionProfile | undefined,
  readCredential: ReturnType<typeof useConnections>["readCredential"],
) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionTransportStatus>("idle");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [cacheMetadata, setCacheMetadata] = useState<ConnectionCacheMetadata>();
  const [serverVersion, setServerVersion] = useState<string>();
  const [eventLocations, setEventLocations] = useState<LocationRef[]>([]);
  const [attentionLocations, setAttentionLocations] = useState<LocationRef[]>([]);
  const [reconciliationRevision, setReconciliationRevision] = useState(0);
  const [restClientState, setRestClientState] = useState<{
    client: OpenCodeClient;
    connectionId: string;
  }>();
  const statusRef = useRef<ConnectionTransportStatus>("idle");
  const diagnosticsRef = useRef<RuntimeDiagnosticEntry[]>([]);
  const transportMetricsRef = useRef<TransportDiagnosticMetrics>(emptyTransportDiagnosticMetrics());
  const selectedRevisionRef = useRef<{ id: string; updatedAtMs: number } | undefined>(undefined);
  const includeAttentionLocation = useCallback((location: LocationRef) => {
    setAttentionLocations((current) => appendEventLocation(current, location));
    setEventLocations((current) => appendEventLocation(current, location));
  }, []);

  useEffect(() => {
    if (!selected) {
      resetTranscriptPerformanceMetrics();
      selectedRevisionRef.current = undefined;
      statusRef.current = "idle";
      diagnosticsRef.current = [];
      transportMetricsRef.current = emptyTransportDiagnosticMetrics();
      setStatus("idle");
      setReconnectAttempt(0);
      setCacheMetadata(undefined);
      setServerVersion(undefined);
      setEventLocations([]);
      setAttentionLocations([]);
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
    transportMetricsRef.current = emptyTransportDiagnosticMetrics();
    resetTranscriptPerformanceMetrics();
    setStatus("connecting");
    setReconnectAttempt(0);
    setCacheMetadata(undefined);
    setServerVersion(undefined);
    setEventLocations([]);
    setAttentionLocations([]);
    setReconciliationRevision(0);
    setRestClientState(undefined);
    void readConnectionCacheMetadata(selected.id, selected.updatedAtMs)
      .then((metadata) => {
        if (active) setCacheMetadata(metadata);
      })
      .catch(() => undefined);

    readCredential(selected)
      .then((credential) => {
        if (!active) return;
        coordinator = startConnectionTransport(selected, credential, queryClient, {
          isActive: () => active,
          metrics: () => transportMetricsRef.current,
          recordDiagnostic(entry) {
            diagnosticsRef.current = appendDiagnostic(diagnosticsRef.current, entry);
          },
          setCacheMetadata,
          setEventLocations,
          setReconciliationRevision,
          setRestClientState,
          setServerVersion,
          setStatus(nextStatus, attempt) {
            statusRef.current = nextStatus;
            setStatus(nextStatus);
            setReconnectAttempt(attempt);
          },
        });
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
  }, [readCredential, queryClient, selected]);

  return {
    attentionLocations,
    cacheMetadata,
    diagnosticsRef,
    eventLocations,
    includeAttentionLocation,
    reconciliationRevision,
    reconnectAttempt,
    restClientState,
    serverVersion,
    status,
    statusRef,
    transportMetricsRef,
  };
}

export function useConnectionRuntime() {
  const value = use(ConnectionRuntimeContext);
  if (!value) throw new Error("ConnectionRuntimeProvider is missing");
  return value;
}

export type RuntimeDiagnosticEntry = {
  atMs: number;
  attempt?: number;
  count?: number;
  kind: "event" | "generation" | "status";
  value: string;
};

export type TransportDiagnosticMetrics = {
  durableSequenceGaps: number;
  generationStarts: number;
  snapshotRequests: number;
  snapshotsInstalled: number;
};

type RuntimeDiagnosticMetadata = {
  appBuild: string;
  appVersion: string;
  clientContractVersion: string;
  metrics: TransportDiagnosticMetrics;
  serverVersion?: string;
};

const maxRuntimeDiagnosticsPerKind = 64;

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

  while (
    next.filter((currentEntry) => currentEntry.kind === entry.kind).length >
    maxRuntimeDiagnosticsPerKind
  ) {
    const oldestKindIndex = next.findIndex((currentEntry) => currentEntry.kind === entry.kind);
    next.splice(oldestKindIndex, 1);
  }
  return next;
}

export function formatDiagnostics(
  status: ConnectionTransportStatus,
  diagnostics: RuntimeDiagnosticEntry[],
  metadata?: RuntimeDiagnosticMetadata,
) {
  const lines = [`${applicationName} redacted transport diagnostics`, `current_status=${status}`];
  if (metadata) {
    lines.push(
      `app_version=${redactedDiagnosticValue(metadata.appVersion)}`,
      `app_build=${redactedDiagnosticValue(metadata.appBuild)}`,
      `client_contract=${redactedDiagnosticValue(metadata.clientContractVersion)}`,
      `server_version=${redactedDiagnosticValue(metadata.serverVersion ?? "unknown")}`,
      `generation_starts=${metadata.metrics.generationStarts}`,
      `durable_sequence_gaps=${metadata.metrics.durableSequenceGaps}`,
      `snapshot_requests=${metadata.metrics.snapshotRequests}`,
      `snapshots_installed=${metadata.metrics.snapshotsInstalled}`,
    );
  }
  for (const entry of diagnostics) {
    lines.push(
      `${formatDiagnosticTimestamp(entry.atMs)} ${entry.kind}=${entry.value}${
        entry.attempt ? ` attempt=${entry.attempt}` : ""
      }${entry.count && entry.count > 1 ? ` count=${entry.count}` : ""}`,
    );
  }
  return lines.join("\n");
}

function emptyTransportDiagnosticMetrics(): TransportDiagnosticMetrics {
  return {
    durableSequenceGaps: 0,
    generationStarts: 0,
    snapshotRequests: 0,
    snapshotsInstalled: 0,
  };
}

function redactedDiagnosticValue(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,127}$/.test(value) ? value : "unknown";
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
