import {
  classifyOpenCodeError,
  connectOpenCodeMcpServer,
  disconnectOpenCodeMcpServer,
  type LocationRef,
  listOpenCodeMcpServers,
  type McpServer,
} from "@opencode2-mobile/opencode-adapter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";

import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { palette, space, switchColors, typography } from "../theme";
import { ActionButton } from "./app-shell";

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
  const runtime = useConnectionRuntime();
  const client = runtime.restClient;
  const queryClient = useQueryClient();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const requestRef = useRef<AbortController | null>(null);
  const available = Boolean(
    ready && client && runtime.connectionId === connectionId && runtime.status === "connected",
  );
  const queryKey = openCodeQueryKeys.mcpServers(connectionId, location);
  const query = useQuery({
    enabled: visible && available,
    queryKey,
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return listOpenCodeMcpServers(client, location, { signal });
    },
    retry: false,
    refetchOnMount: "always",
    refetchInterval: visible && available ? 10_000 : false,
  });
  useEffect(() => {
    if (!client || !available) requestRef.current?.abort();
    return () => requestRef.current?.abort();
  }, [client, available]);
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ server, connect }: { server: string; connect: boolean }) => {
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
          queryClient.invalidateQueries({ queryKey }),
          queryClient.invalidateQueries({
            queryKey: openCodeQueryKeys.commands(connectionId, location),
          }),
        ]);
      } finally {
        requestRef.current = null;
      }
    },
  });
  const matchingConnection = runtime.connectionId === connectionId;
  const servers = matchingConnection ? query.data?.data : undefined;
  const unsupported =
    (query.isError && classifyOpenCodeError(query.error) === "INCOMPATIBLE") ||
    (mutation.isError && classifyOpenCodeError(mutation.error) === "INCOMPATIBLE");
  const canChange =
    available &&
    query.isSuccess &&
    !query.isError &&
    !query.isFetching &&
    !mutation.isPending &&
    !unsupported;

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

  function changeServer(server: string, connect: boolean) {
    if (!canChange || requestRef.current) return;
    requestRef.current = new AbortController();
    mutation.mutate({ server, connect });
  }

  if (!visible) return null;
  return (
    <View style={styles.content}>
      <Text style={styles.note}>
        MCP changes affect all sessions at this location. They do not change saved configuration and
        may reset when the server restarts.
      </Text>
      <Text selectable style={styles.path}>
        {location.directory}
      </Text>
      <Text accessibilityRole="header" style={styles.heading}>
        Current branch
      </Text>
      <Text selectable style={styles.name}>
        {branch ?? "Branch unavailable"}
      </Text>
      {branchStale ? (
        <Text style={styles.note}>This branch may be outdated while the server reconnects.</Text>
      ) : null}
      {branch ? (
        <ActionButton
          secondary
          label={
            copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Try copying again"
                : "Copy branch name"
          }
          onPress={() => void copyBranch()}
        />
      ) : null}
      <Text accessibilityRole="header" style={styles.heading}>
        MCP servers for this location
      </Text>
      {!available ? (
        <Text accessibilityRole="alert" style={styles.note}>
          Reconnect to this session's server and wait for its location to load before changing MCP
          servers.
        </Text>
      ) : null}
      {unsupported ? (
        <Text accessibilityRole="alert" style={styles.note}>
          This server does not expose MCP management.
        </Text>
      ) : query.isError ? (
        <View>
          <Text accessibilityRole="alert" style={styles.note}>
            MCP servers could not be refreshed. Their status may be outdated.
          </Text>
          <ActionButton
            secondary
            disabled={!available || mutation.isPending}
            label="Try again"
            onPress={() => void query.refetch()}
          />
        </View>
      ) : available && query.isPending ? (
        <ActivityIndicator accessibilityLabel="Loading MCP servers" color={palette.signal} />
      ) : null}
      {mutation.isError && !unsupported ? (
        <Text accessibilityRole="alert" style={styles.note}>
          The MCP change could not be confirmed. Check the refreshed status before trying again.
        </Text>
      ) : null}
      {servers?.length === 0 && query.isSuccess ? (
        <Text style={styles.note}>No MCP servers configured for this location.</Text>
      ) : null}
      {servers?.map((server) => {
        const pending = mutation.isPending && mutation.variables?.server === server.name;
        // Enabled is distinct from connected. An enabled server can still be
        // connecting, require authentication, or have a connection failure.
        const enabled = server.status.status !== "disabled";
        const checked = pending ? Boolean(mutation.variables?.connect) : enabled;
        const needsAuth = server.status.status === "needs_auth";
        const status = pending
          ? mutation.variables?.connect
            ? "Connecting"
            : "Disconnecting"
          : mcpStatusLabel(server);
        return (
          <View key={server.name} style={styles.server}>
            <View style={styles.serverHeader}>
              <View style={styles.serverInfo}>
                <Text selectable style={styles.name}>
                  {server.name}
                </Text>
                <Text accessibilityLiveRegion="polite" style={styles.note}>
                  {status}
                </Text>
              </View>
              <View style={styles.switchTarget}>
                <Switch
                  accessibilityLabel={`MCP server ${server.name} for this location`}
                  accessibilityHint="Turns this server on or off for all sessions at this location"
                  accessibilityState={{
                    checked,
                    disabled: !canChange || server.status.status === "pending",
                    busy: pending || server.status.status === "pending",
                  }}
                  disabled={!canChange || server.status.status === "pending"}
                  value={checked}
                  {...switchColors}
                  onValueChange={(next) => {
                    if (next !== enabled) changeServer(server.name, next);
                  }}
                />
              </View>
            </View>
            {needsAuth ? (
              <Text style={styles.note}>
                Finish authentication in OpenCode on the server, then refresh this list.
              </Text>
            ) : server.status.status === "failed" ? (
              <ActionButton
                secondary
                disabled={!canChange}
                label="Retry connection"
                accessibilityLabel={`Retry connection to MCP server ${server.name}`}
                onPress={() => changeServer(server.name, true)}
              />
            ) : null}
          </View>
        );
      })}
      {query.isSuccess && !unsupported ? (
        <ActionButton
          secondary
          disabled={!available || mutation.isPending || query.isFetching}
          label={query.isFetching ? "Refreshing MCP servers" : "Refresh MCP servers"}
          onPress={() => void query.refetch()}
        />
      ) : null}
    </View>
  );
}

function mcpStatusLabel(server: McpServer) {
  switch (server.status.status) {
    case "connected":
      return "Connected";
    case "pending":
      return "Connecting";
    case "disabled":
      return "Disconnected";
    case "failed":
      return "Connection failed";
    case "needs_auth":
      return "Needs authentication";
  }
}

const styles = StyleSheet.create({
  content: { gap: space.md },
  heading: { ...typography.control, color: palette.ink },
  name: { ...typography.body, color: palette.ink },
  note: { ...typography.caption, color: palette.dim },
  path: { ...typography.code, color: palette.dim },
  serverHeader: { flexDirection: "row", alignItems: "center", gap: space.md },
  serverInfo: { flex: 1, minWidth: 0, gap: space.xs },
  switchTarget: {
    minWidth: 44,
    minHeight: 44,
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
