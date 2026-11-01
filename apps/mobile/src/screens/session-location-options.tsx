import {
  connectOpenCodeMcpServer,
  disconnectOpenCodeMcpServer,
  type LocationRef,
  listOpenCodeMcpServers,
  type McpServer,
  type OpenCodeClient,
} from "@opencode2-mobile/opencode-adapter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { type RefObject, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";

import { Button } from "../components/button";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { minTouchTarget, palette, space, switchColors, typeRamp, typography } from "../theme";
import { ActionButton } from "./app-shell";
import {
  type BranchCopyState,
  branchCopyLabels,
  type McpServerChange,
  mcpChangesAllowed,
  mcpManagementUnsupported,
  mcpServerRowState,
} from "./session-location-options-model";

export function SessionDevTools({
  connectionId,
  location,
  ready,
  branch,
  branchStale,
  visible,
}: {
  connectionId: string;
  location: LocationRef;
  ready: boolean;
  branch?: string | undefined;
  branchStale?: boolean;
  visible: boolean;
}) {
  const { available, canChange, changeServer, mutation, query, refresh, servers, unsupported } =
    useMcpServerControls(connectionId, location, ready, visible);
  const copy = useBranchCopy(branch);

  if (!visible) return null;
  return (
    <View style={styles.content}>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.note}>
        MCP changes affect all sessions at this location. They do not change saved configuration and
        may reset when the server restarts.
      </Text>
      <Text dynamicTypeRamp={typeRamp.footnote} selectable style={styles.path}>
        {location.directory}
      </Text>
      <BranchSection
        branch={branch}
        branchStale={branchStale}
        copyLabel={copy.label}
        onCopy={copy.copyBranch}
      />
      <Text accessibilityRole="header" dynamicTypeRamp={typeRamp.headline} style={styles.heading}>
        MCP servers for this location
      </Text>
      {!available ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.footnote} style={styles.note}>
          Reconnect to this session's server and wait for its location to load before changing MCP
          servers.
        </Text>
      ) : null}
      <McpListStatus
        available={available}
        mutationPending={mutation.isPending}
        onRefresh={refresh.run}
        query={query}
        refreshing={refresh.refreshing}
        unsupported={unsupported}
      />
      {mutation.isError && !unsupported ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.footnote} style={styles.note}>
          The MCP change could not be confirmed. Check the refreshed status before trying again.
        </Text>
      ) : null}
      {servers?.length === 0 && query.isSuccess ? (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.note}>
          No MCP servers configured for this location.
        </Text>
      ) : null}
      {servers?.map((server) => (
        <McpServerRow
          key={server.name}
          canChange={canChange}
          change={mutation.isPending ? mutation.variables : undefined}
          onChange={changeServer}
          server={server}
        />
      ))}
      {query.isSuccess && !unsupported ? (
        <ActionButton
          secondary
          disabled={!available || mutation.isPending || refresh.refreshing}
          label={refresh.refreshing ? "Refreshing MCP servers" : "Refresh MCP servers"}
          onPress={() => void refresh.run()}
        />
      ) : null}
    </View>
  );
}

function useBranchCopy(branch: string | undefined) {
  const [copyState, setCopyState] = useState<BranchCopyState>("idle");
  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = setTimeout(() => setCopyState("idle"), 2_000);
    return () => clearTimeout(timer);
  }, [copyState]);

  async function copyBranch() {
    if (!branch) return;
    try {
      await Clipboard.setStringAsync(branch);
      setCopyState("copied");
      AccessibilityInfo.announceForAccessibility("Branch name copied");
    } catch {
      setCopyState("error");
    }
  }

  return { label: branchCopyLabels[copyState], copyBranch };
}

function useMcpServerControls(
  connectionId: string,
  location: LocationRef,
  ready: boolean,
  visible: boolean,
) {
  const runtime = useConnectionRuntime();
  const client = runtime.restClient;
  const [userRefreshing, setUserRefreshing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const matchingConnection = runtime.connectionId === connectionId;
  const available = Boolean(
    ready && client && matchingConnection && runtime.status === "connected",
  );
  const query = useMcpServersQuery(client, connectionId, location, visible && available);
  useEffect(() => {
    if (!client || !available) requestRef.current?.abort();
    return () => requestRef.current?.abort();
  }, [client, available]);
  const mutation = useMcpServerMutation(client, available, requestRef, connectionId, location);
  const servers = matchingConnection ? query.data?.data : undefined;
  const unsupported = mcpManagementUnsupported(query, mutation);
  const canChange = mcpChangesAllowed(available, servers, mutation.isPending, unsupported);

  async function refresh() {
    setUserRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setUserRefreshing(false);
    }
  }

  function changeServer(server: string, connect: boolean) {
    if (!canChange || requestRef.current) return;
    requestRef.current = new AbortController();
    mutation.mutate({ server, connect });
  }

  return {
    available,
    canChange,
    changeServer,
    mutation,
    query,
    refresh: { refreshing: userRefreshing, run: refresh },
    servers,
    unsupported,
  };
}

function useMcpServersQuery(
  client: OpenCodeClient | undefined,
  connectionId: string,
  location: LocationRef,
  active: boolean,
) {
  return useQuery({
    enabled: active,
    queryKey: openCodeQueryKeys.mcpServers(connectionId, location),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return listOpenCodeMcpServers(client, location, { signal });
    },
    retry: false,
    refetchOnMount: "always",
    refetchInterval: active ? 10_000 : false,
  });
}

function useMcpServerMutation(
  client: OpenCodeClient | undefined,
  available: boolean,
  requestRef: RefObject<AbortController | null>,
  connectionId: string,
  location: LocationRef,
) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ server, connect }: McpServerChange) => {
      const controller = requestRef.current;
      if (!client || !available || !controller || controller.signal.aborted) {
        throw new Error("CONNECTION_NOT_READY");
      }
      const operation = connect ? connectOpenCodeMcpServer : disconnectOpenCodeMcpServer;
      await operation(client, location, server, { signal: controller.signal });
    },
    onSettled: async () => {
      // A lost response may still have changed the server. Never retry the action
      // automatically; reconcile the original location even on failure.
      try {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: openCodeQueryKeys.mcpServers(connectionId, location),
          }),
          queryClient.invalidateQueries({
            queryKey: openCodeQueryKeys.commands(connectionId, location),
          }),
        ]);
      } finally {
        requestRef.current = null;
      }
    },
  });
}

function BranchSection({
  branch,
  branchStale,
  copyLabel,
  onCopy,
}: {
  branch: string | undefined;
  branchStale: boolean | undefined;
  copyLabel: string;
  onCopy: () => Promise<void>;
}) {
  return (
    <>
      <Text accessibilityRole="header" dynamicTypeRamp={typeRamp.headline} style={styles.heading}>
        Current branch
      </Text>
      <Text dynamicTypeRamp={typeRamp.body} selectable style={styles.name}>
        {branch ?? "Branch unavailable"}
      </Text>
      {branchStale ? (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.note}>
          This branch may be outdated while the server reconnects.
        </Text>
      ) : null}
      {branch ? <ActionButton secondary label={copyLabel} onPress={() => void onCopy()} /> : null}
    </>
  );
}

function McpListStatus({
  available,
  mutationPending,
  onRefresh,
  query,
  refreshing,
  unsupported,
}: {
  available: boolean;
  mutationPending: boolean;
  onRefresh: () => Promise<void>;
  query: { isError: boolean; isPending: boolean };
  refreshing: boolean;
  unsupported: boolean;
}) {
  if (unsupported)
    return (
      <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.footnote} style={styles.note}>
        This server does not expose MCP management.
      </Text>
    );
  if (query.isError)
    return (
      <View style={styles.errorBlock}>
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.footnote} style={styles.note}>
          MCP servers could not be refreshed. Their status may be outdated.
        </Text>
        <Button
          busy={refreshing}
          disabled={!available || mutationPending}
          label="Try again"
          onPress={() => void onRefresh()}
        />
      </View>
    );
  if (available && query.isPending)
    return <ActivityIndicator accessibilityLabel="Loading MCP servers" color={palette.signal} />;
  return null;
}

function McpServerRow({
  canChange,
  change,
  onChange,
  server,
}: {
  canChange: boolean;
  change: McpServerChange | undefined;
  onChange: (server: string, connect: boolean) => void;
  server: McpServer;
}) {
  const { checked, enabled, pending, status } = mcpServerRowState(server, change);
  const serverPending = server.status.status === "pending";
  return (
    <View style={styles.server}>
      <View style={styles.serverHeader}>
        <View style={styles.serverInfo}>
          <Text dynamicTypeRamp={typeRamp.body} selectable style={styles.name}>
            {server.name}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            dynamicTypeRamp={typeRamp.footnote}
            style={styles.note}
          >
            {status}
          </Text>
        </View>
        <View style={styles.switchTarget}>
          <Switch
            accessibilityLabel={`MCP server ${server.name} for this location`}
            accessibilityHint="Turns this server on or off for all sessions at this location"
            accessibilityState={{
              checked,
              disabled: !canChange || serverPending,
              busy: pending || serverPending,
            }}
            disabled={!canChange || serverPending}
            value={checked}
            {...switchColors}
            onValueChange={(next) => {
              if (next !== enabled) onChange(server.name, next);
            }}
          />
        </View>
      </View>
      {server.status.status === "needs_auth" ? (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.note}>
          Finish authentication in OpenCode on the server, then refresh this list.
        </Text>
      ) : server.status.status === "failed" ? (
        <ActionButton
          secondary
          disabled={!canChange}
          label="Retry connection"
          accessibilityLabel={`Retry connection to MCP server ${server.name}`}
          onPress={() => onChange(server.name, true)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md },
  heading: { ...typography.headline, color: palette.ink },
  name: { ...typography.body, color: palette.ink },
  note: { ...typography.footnote, color: palette.dim },
  errorBlock: { alignItems: "flex-start", gap: space.sm },
  path: { ...typography.footnote, color: palette.dim, fontFamily: typography.code.fontFamily },
  serverHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: minTouchTarget,
  },
  serverInfo: { flex: 1, minWidth: 0, gap: space.xs },
  switchTarget: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  server: {
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
    gap: space.xs,
  },
});
