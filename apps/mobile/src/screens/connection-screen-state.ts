import { useEffect, useRef, useState } from "react";
import { useAnnouncement } from "../components/use-announcement";
import type { ConnectionAuthMode, ConnectionProfile } from "../connections/connection-profile";
import type { useConnections } from "../connections/connections-context";
import { useLifecycleTransportProbe } from "../use-lifecycle-transport-probe";
import {
  type ConnectionFormValues,
  type Diagnostic,
  formSecret,
  type PtyDiagnostic,
  profileFormValues,
  type StreamDiagnostic,
} from "./connection-screen-model";

export type Connections = ReturnType<typeof useConnections>;
export type ConnectionScreenState = ReturnType<typeof useConnectionScreenState>;

export function useConnectionScreenState(connections: Connections) {
  const profileLoadGeneration = useRef(0);
  const [editingProfileId, setEditingProfileId] = useState<string>();
  const [loadedProfileId, setLoadedProfileId] = useState<string>();
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [authMode, setAuthMode] = useState<ConnectionAuthMode>("basic");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [allowHttp, setAllowHttp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [streamBusy, setStreamBusy] = useState(false);
  const [ptyBusy, setPtyBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [showDetails, setShowDetails] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRuntimeDiagnostics, setShowRuntimeDiagnostics] = useState(false);
  const [runtimeDiagnosticsText, setRuntimeDiagnosticsText] = useState("");
  const [diagnostic, setDiagnostic] = useState<Diagnostic>();
  const [streamDiagnostic, setStreamDiagnostic] = useState<StreamDiagnostic>();
  const [ptyDiagnostic, setPtyDiagnostic] = useState<PtyDiagnostic>();
  const lifecycleProbe = useLifecycleTransportProbe();
  const lifecycleBusy = lifecycleProbe.running;
  useAnnouncement(error);
  useAnnouncement(notice);

  useEffect(() => {
    const selected = connections.profiles.find(
      (profile) => profile.id === connections.selectedProfileId,
    );
    if (!selected || loadedProfileId !== undefined) return;
    let active = true;

    connections
      .readCredential(selected)
      .then((credential) => {
        if (!active) return;
        const loaded = profileFormValues(selected, credential);
        setEditingProfileId(selected.id);
        setLoadedProfileId(selected.id);
        setName(loaded.name);
        setOrigin(loaded.origin);
        setAuthMode(loaded.authMode);
        setAllowHttp(loaded.allowHttp);
        setUsername(loaded.username);
        setPassword(loaded.password);
        setToken(loaded.token);
        setError(undefined);
        setNotice(undefined);
        setDiagnostic(undefined);
        setStreamDiagnostic(undefined);
        setPtyDiagnostic(undefined);
      })
      .catch(() => {
        if (active) setError("Stored credentials could not be read. Enter them again.");
      });

    return () => {
      active = false;
    };
  }, [
    connections.profiles,
    connections.readCredential,
    connections.selectedProfileId,
    loadedProfileId,
  ]);

  const values: ConnectionFormValues = {
    allowHttp,
    authMode,
    name,
    origin,
    password,
    token,
    username,
  };

  function setValues(next: ConnectionFormValues) {
    setName(next.name);
    setOrigin(next.origin);
    setAuthMode(next.authMode);
    setAllowHttp(next.allowHttp);
    setUsername(next.username);
    setPassword(next.password);
    setToken(next.token);
  }

  function loadProfile(profile: ConnectionProfile, next: ConnectionFormValues) {
    setEditingProfileId(profile.id);
    setLoadedProfileId(profile.id);
    setValues(next);
  }

  function clearMessages() {
    setError(undefined);
    setNotice(undefined);
  }

  function resetResults() {
    clearMessages();
    setDiagnostic(undefined);
    setStreamDiagnostic(undefined);
    setPtyDiagnostic(undefined);
    lifecycleProbe.reset();
  }

  // Any edit makes earlier results describe a different connection.
  function edited<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      resetResults();
    };
  }

  return {
    actionsDisabled: saving || busy || streamBusy || ptyBusy || lifecycleBusy,
    busy,
    clearMessages,
    diagnostic,
    edited,
    editingProfileId,
    error,
    lifecycleBusy,
    lifecycleProbe,
    loadProfile,
    notice,
    profileLoadGeneration,
    ptyBusy,
    ptyDiagnostic,
    resetResults,
    runtimeDiagnosticsText,
    saving,
    secret: formSecret(values),
    setAllowHttp,
    setAuthMode,
    setBusy,
    setDiagnostic,
    setEditingProfileId,
    setError,
    setLoadedProfileId,
    setName,
    setNotice,
    setOrigin,
    setPassword,
    setPtyBusy,
    setPtyDiagnostic,
    setRuntimeDiagnosticsText,
    setSaving,
    setShowAdvanced,
    setShowDetails,
    setShowRuntimeDiagnostics,
    setShowSecret,
    setStreamBusy,
    setStreamDiagnostic,
    setToken,
    setUsername,
    setValues,
    showAdvanced,
    showDetails,
    showRuntimeDiagnostics,
    showSecret,
    streamBusy,
    streamDiagnostic,
    values,
  };
}
