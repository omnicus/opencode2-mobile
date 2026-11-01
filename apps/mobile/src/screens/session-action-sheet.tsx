import {
  removeOpenCodeSession,
  renameOpenCodeSession,
  type SessionInfo,
} from "@opencode2-mobile/opencode-adapter";
import { useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput } from "react-native";
import { Button } from "../components/button";
import { MenuGroup, MenuRow } from "../components/menu-row";
import { ModalSheet } from "../components/modal-sheet";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { deleteSessionLocalState } from "../storage/prompt-admission-repository";
import { minTouchTarget, palette, radius, space, typeRamp, typography } from "../theme";
import { loadOpenCodeSessionTreeIds } from "./session-deletion";
import { SessionDevTools } from "./session-location-options";

export function SessionActionSheet({
  connectionId,
  session,
  onClose,
  onDeleted,
  branch,
  branchStale = false,
}: {
  connectionId: string;
  session: SessionInfo;
  onClose: () => void;
  onDeleted: () => void;
  branch?: string | undefined;
  branchStale?: boolean;
}) {
  const runtime = useConnectionRuntime();
  const queryClient = useQueryClient();
  const db = useSQLiteContext();
  const [page, setPage] = useState<"menu" | "rename" | "delete" | "devtools">("menu");
  const [title, setTitle] = useState(session.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (runtime.connectionId !== connectionId) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setBusy(false);
    }
    return () => {
      controllerRef.current?.abort();
    };
  }, [connectionId, runtime.connectionId]);
  const connected =
    runtime.connectionId === connectionId &&
    runtime.status === "connected" &&
    Boolean(runtime.restClient);

  const canSaveName = connected && Boolean(title.trim()) && title.trim() !== session.title;

  async function perform(action: "rename" | "delete") {
    if (controllerRef.current || runtime.connectionId !== connectionId) return;
    if (!connected || !runtime.restClient) return;
    if (action === "rename" && !title.trim()) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError(undefined);
    let cleanupIncomplete = false;
    try {
      if (action === "rename" && runtime.restClient)
        await renameOpenCodeSession(runtime.restClient, session.id, title.trim(), {
          signal: controller.signal,
        });
      if (action === "delete" && runtime.restClient) {
        const ids = await loadOpenCodeSessionTreeIds(
          runtime.restClient,
          session.location,
          session.id,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        await removeOpenCodeSession(runtime.restClient, session.id, { signal: controller.signal });
        await deleteSessionLocalState(db, connectionId, ids).catch(() => {
          cleanupIncomplete = true;
        });
        for (const id of ids) {
          queryClient.removeQueries({
            queryKey: openCodeQueryKeys.session(connectionId, session.location, id),
          });
          queryClient.removeQueries({
            queryKey: openCodeQueryKeys.messageRoot(connectionId, session.location, id),
          });
          queryClient.removeQueries({
            queryKey: openCodeQueryKeys.inbox(connectionId, session.location, id),
          });
          queryClient.removeQueries({
            queryKey: openCodeQueryKeys.promptAdmissions(connectionId, session.location, id),
          });
        }
      }
      if (controller.signal.aborted) return;
      await queryClient.invalidateQueries({ queryKey: openCodeQueryKeys.connection(connectionId) });
      if (controller.signal.aborted) return;
      if (action === "delete") onDeleted();
      else onClose();
      if (cleanupIncomplete)
        Alert.alert(
          "Local cleanup incomplete",
          "The server deleted the session, but encrypted local state could not be removed. Removing this connection profile will clear it.",
        );
    } catch {
      if (!controller.signal.aborted) {
        setError("Could not confirm the change. Refresh the session before trying again.");
        void queryClient.invalidateQueries({
          queryKey: openCodeQueryKeys.connection(connectionId),
        });
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        controllerRef.current = null;
      }
    }
  }

  return (
    <ModalSheet
      title={
        page === "rename"
          ? "Rename session"
          : page === "devtools"
            ? "Dev tools"
            : page === "delete"
              ? "Delete session?"
              : "Session actions"
      }
      subtitle={session.title || "Untitled session"}
      visible
      onClose={() => {
        if (!controllerRef.current) onClose();
      }}
      size={page === "menu" || page === "delete" ? "compact" : "page"}
      closeLabel={page === "delete" ? "Cancel" : "Close"}
    >
      {page !== "menu" ? (
        <Button
          accessibilityLabel="Back to session actions"
          disabled={busy}
          icon="chevron-left"
          label="Session actions"
          onPress={() => {
            setPage("menu");
            setError(undefined);
          }}
          variant="text"
        />
      ) : null}
      {page === "menu" ? (
        <>
          <MenuGroup>
            <MenuRow
              icon="edit-2"
              last
              label="Rename"
              disabled={busy || !connected}
              onPress={() => setPage("rename")}
            />
          </MenuGroup>
          <MenuGroup>
            <MenuRow
              icon="tool"
              last
              label="Dev tools"
              description="Branch and MCP servers for this location"
              disabled={busy || runtime.connectionId !== connectionId}
              onPress={() => setPage("devtools")}
            />
          </MenuGroup>
          <MenuGroup>
            <MenuRow
              icon="trash-2"
              last
              label="Delete"
              danger
              disabled={busy || !connected}
              onPress={() => setPage("delete")}
            />
          </MenuGroup>
        </>
      ) : null}
      {page === "rename" ? (
        <>
          <TextInput
            accessibilityLabel="Session name"
            autoFocus
            value={title}
            onChangeText={setTitle}
            editable={!busy}
            keyboardAppearance="dark"
            maxLength={512}
            onSubmitEditing={() => {
              if (canSaveName) void perform("rename");
            }}
            returnKeyType="done"
            style={styles.input}
          />
          <Button
            busy={busy}
            disabled={!canSaveName}
            fullWidth
            label={busy ? "Saving" : "Save name"}
            onPress={() => void perform("rename")}
            variant="primary"
          />
        </>
      ) : null}
      {page === "delete" ? (
        <>
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
            This deletes the remote session and its child sessions. It cannot be undone.
          </Text>
          <Button
            busy={busy}
            disabled={!connected}
            fullWidth
            label={busy ? "Deleting" : "Confirm delete"}
            onPress={() => void perform("delete")}
            variant="danger"
          />
        </>
      ) : null}
      <SessionDevTools
        connectionId={connectionId}
        location={session.location}
        ready={runtime.connectionId === connectionId}
        visible={page === "devtools"}
        branch={branch}
        branchStale={branchStale}
      />
      {error ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
          {error}
        </Text>
      ) : null}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  input: {
    ...typography.body,
    minHeight: minTouchTarget,
    color: palette.ink,
    backgroundColor: palette.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
  },
  copy: { ...typography.subheadline, color: palette.ink },
  error: { ...typography.subheadline, color: palette.danger },
});
