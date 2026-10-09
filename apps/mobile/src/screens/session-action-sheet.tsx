import {
  removeOpenCodeSession,
  renameOpenCodeSession,
  type SessionInfo,
} from "@opencode2-mobile/opencode-adapter";
import { useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput } from "react-native";
import { ModalSheet } from "../components/modal-sheet";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { useSessionArchives } from "../state/use-session-archives";
import { deleteSessionLocalState } from "../storage/prompt-admission-repository";
import { palette, radius, space, typography } from "../theme";
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
  const archives = useSessionArchives(connectionId, runtime.connectionUpdatedAtMs);
  const archived = archives.ids.includes(session.id);
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

  async function perform(action: "rename" | "archive" | "delete") {
    if (controllerRef.current || runtime.connectionId !== connectionId) return;
    if (action !== "archive" && (!connected || !runtime.restClient)) return;
    if (action === "rename" && !title.trim()) return;
    if (action === "archive" && (!archives.loaded || archives.busy || archives.error)) return;
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
      if (action === "archive") await archives.setArchived(session.id, !archived);
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
      await queryClient.invalidateQueries({ queryKey: ["device-session-archives", connectionId] });
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
      size="page"
    >
      {page !== "menu" ? (
        <Action
          label="Back to session actions"
          disabled={busy}
          onPress={() => {
            setPage("menu");
            setError(undefined);
          }}
        />
      ) : null}
      {page === "menu" ? (
        <>
          <Action label="Rename" disabled={busy || !connected} onPress={() => setPage("rename")} />
          <Action
            label="Dev tools"
            disabled={busy || runtime.connectionId !== connectionId}
            onPress={() => setPage("devtools")}
          />
          <Action
            label={archived ? "Restore" : "Archive"}
            disabled={
              busy ||
              runtime.connectionId !== connectionId ||
              !archives.loaded ||
              archives.busy ||
              archives.error
            }
            onPress={() => void perform("archive")}
          />
          <Text style={styles.caption}>
            Archive is a preference on this device. Working sessions and requests remain visible.
          </Text>
          <Action
            label="Delete"
            danger
            disabled={busy || !connected}
            onPress={() => setPage("delete")}
          />
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
            maxLength={512}
            style={styles.input}
          />
          <Action
            label={busy ? "Saving" : "Save name"}
            disabled={busy || !connected || !title.trim() || title.trim() === session.title}
            onPress={() => void perform("rename")}
          />
        </>
      ) : null}
      {page === "delete" ? (
        <>
          <Text style={styles.copy}>
            This deletes the remote session and its child sessions. It cannot be undone.
          </Text>
          <Action
            label={busy ? "Deleting" : "Confirm delete"}
            danger
            disabled={busy || !connected}
            onPress={() => void perform("delete")}
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
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </ModalSheet>
  );
}

function Action({
  label,
  disabled,
  danger = false,
  onPress,
}: {
  label: string;
  disabled: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, (disabled || pressed) && styles.disabled]}
    >
      <Text style={[styles.label, danger && styles.error]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 48,
    justifyContent: "center",
    padding: space.sm,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
  },
  label: { ...typography.control, color: palette.ink },
  input: {
    ...typography.body,
    minHeight: 48,
    color: palette.ink,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
  },
  copy: { ...typography.body, color: palette.ink },
  caption: { ...typography.caption, color: palette.dim },
  error: { ...typography.body, color: palette.danger },
  disabled: { opacity: 0.5 },
});
