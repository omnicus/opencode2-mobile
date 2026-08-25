import {
  classifyOpenCodeError,
  createOpenCodeClient,
  EventProbeError,
  normalizeOpenCodeBaseUrl,
  openCodeClientContractVersion,
  PtyProbeError,
  probeEventStream,
  probePtyTransport,
} from "@opencode2-mobile/opencode-adapter";
import * as Device from "expo-device";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { connectionAuthorizationHeader } from "../connections/connection-authorization";
import type {
  ConnectionAuthMode,
  ConnectionCredential,
  ConnectionProfile,
} from "../connections/connection-profile";
import { useConnections } from "../connections/connections-context";
import { boundedOpenCodeFetch, expoOpenCodeFetch } from "../expo-open-code-fetch";
import { useAppLock } from "../security/app-lock-context";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { palette, radius, space } from "../theme";
import {
  type LifecycleTransportPhase,
  type LifecycleTransportResult,
  useLifecycleTransportProbe,
} from "../use-lifecycle-transport-probe";

type Diagnostic = {
  advertisedUrls: number;
  checkedAtMs: number;
  configurationKey: string;
  pid: number;
  sessions: number;
  version: string;
};

type StreamDiagnostic = {
  cancellation: true;
  eventType: string;
};

type PtyDiagnostic = {
  cleanup: true;
  output: true;
  ticketExpiresIn: number;
};

export function ConnectionScreen({ onDone, onPair }: { onDone?: () => void; onPair?: () => void }) {
  const connections = useConnections();
  const appLock = useAppLock();
  const runtime = useConnectionRuntime();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.3;
  const profileLoadGeneration = useRef(0);
  const [editingProfileId, setEditingProfileId] = useState<string>();
  const [loadedProfileId, setLoadedProfileId] = useState<string>();
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [authMode, setAuthMode] = useState<ConnectionAuthMode>("basic");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [allowHttp, setAllowHttp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [streamBusy, setStreamBusy] = useState(false);
  const [ptyBusy, setPtyBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pendingRemovalId, setPendingRemovalId] = useState<string>();
  const [showDetails, setShowDetails] = useState(connections.profiles.length === 0);
  const [showRuntimeDiagnostics, setShowRuntimeDiagnostics] = useState(false);
  const [runtimeDiagnosticsText, setRuntimeDiagnosticsText] = useState("");
  const [diagnostic, setDiagnostic] = useState<Diagnostic>();
  const [streamDiagnostic, setStreamDiagnostic] = useState<StreamDiagnostic>();
  const [ptyDiagnostic, setPtyDiagnostic] = useState<PtyDiagnostic>();
  const lifecycleProbe = useLifecycleTransportProbe();
  const lifecycleBusy = lifecycleProbe.running;

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
        setEditingProfileId(selected.id);
        setLoadedProfileId(selected.id);
        setName(selected.name);
        setOrigin(selected.baseUrl);
        setAuthMode(selected.authMode);
        setAllowHttp(selected.allowDevelopmentHttp);
        setUsername(credential?.mode === "basic" ? credential.username : "");
        setSecret(
          credential?.mode === "basic"
            ? credential.password
            : credential?.mode === "bearer"
              ? credential.token
              : "",
        );
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

  function populateProfile(profile: ConnectionProfile, credential?: ConnectionCredential) {
    setEditingProfileId(profile.id);
    setLoadedProfileId(profile.id);
    setName(profile.name);
    setOrigin(profile.baseUrl);
    setAuthMode(profile.authMode);
    setAllowHttp(profile.allowDevelopmentHttp);
    setUsername(credential?.mode === "basic" ? credential.username : "");
    setSecret(
      credential?.mode === "basic"
        ? credential.password
        : credential?.mode === "bearer"
          ? credential.token
          : "",
    );
    resetResults();
  }

  function newConnection() {
    profileLoadGeneration.current += 1;
    setEditingProfileId(undefined);
    setLoadedProfileId("new");
    setName("");
    setOrigin("");
    setAuthMode("basic");
    setUsername("");
    setSecret("");
    setAllowHttp(false);
    setPendingRemovalId(undefined);
    setShowDetails(true);
    resetResults();
  }

  async function editProfile(profile: ConnectionProfile) {
    const generation = profileLoadGeneration.current + 1;
    profileLoadGeneration.current = generation;
    setError(undefined);
    setNotice(undefined);
    try {
      const credential = await connections.readCredential(profile);
      if (profileLoadGeneration.current !== generation) return;
      populateProfile(profile, credential);
      setShowDetails(true);
    } catch {
      if (profileLoadGeneration.current === generation) {
        setError("This saved connection could not be opened.");
      }
    }
  }

  async function selectProfile(profile: ConnectionProfile) {
    setError(undefined);
    setNotice(undefined);
    try {
      await connections.select(profile.id);
      setNotice(`${profile.name} selected.`);
      onDone?.();
    } catch {
      setError("This saved connection could not be selected.");
    }
  }

  function resetResults() {
    setError(undefined);
    setNotice(undefined);
    setDiagnostic(undefined);
    setStreamDiagnostic(undefined);
    setPtyDiagnostic(undefined);
    lifecycleProbe.reset();
  }

  async function testConnection() {
    setError(undefined);
    setNotice(undefined);
    setDiagnostic(undefined);
    setStreamDiagnostic(undefined);
    setPtyDiagnostic(undefined);
    lifecycleProbe.reset();

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOpenCodeBaseUrl(origin);
    } catch (caught) {
      setError(urlErrorMessage(caught));
      return;
    }

    if (normalizedOrigin.startsWith("http:") && !allowHttp) {
      setError("Approve private-network HTTP before connecting without TLS.");
      return;
    }
    if (Device.isDevice && isLoopbackHost(normalizedOrigin)) {
      setError(
        "localhost points to this phone. Use your computer's LAN address, Tailscale address, or remote hostname.",
      );
      return;
    }

    const credential = credentialFromInput(authMode, username, secret);
    if (credential === "MISSING") {
      setError(authMode === "basic" ? "Enter a username and password." : "Enter a bearer token.");
      return;
    }

    setBusy(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const client = createOpenCodeClient({
        baseUrl: normalizedOrigin,
        fetch: boundedOpenCodeFetch,
        ...(credential ? { authorization: connectionAuthorizationHeader(credential) } : {}),
      });
      const requestOptions = { signal: controller.signal };
      const [health, server, sessions] = await Promise.all([
        client.health.get(requestOptions),
        client.server.get(requestOptions),
        client.session.list({ limit: 1, order: "desc" }, requestOptions),
      ]);

      setOrigin(normalizedOrigin);
      setDiagnostic({
        advertisedUrls: server.urls.length,
        checkedAtMs: Date.now(),
        configurationKey: connectionConfigurationKey(
          normalizedOrigin,
          authMode,
          username,
          secret,
          allowHttp,
        ),
        pid: health.pid,
        sessions: sessions.data.length,
        version: health.version,
      });
    } catch (caught) {
      setError(connectionErrorMessage(classifyOpenCodeError(caught)));
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  }

  async function saveConnection() {
    setError(undefined);
    setNotice(undefined);
    const credential = credentialFromInput(authMode, username, secret);
    if (credential === "MISSING") {
      setError(authMode === "basic" ? "Enter a username and password." : "Enter a bearer token.");
      return;
    }

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOpenCodeBaseUrl(origin);
    } catch (caught) {
      setError(urlErrorMessage(caught));
      return;
    }
    if (
      !diagnostic ||
      diagnostic.configurationKey !==
        connectionConfigurationKey(normalizedOrigin, authMode, username, secret, allowHttp)
    ) {
      setError("Test this exact connection before saving it.");
      return;
    }

    setSaving(true);
    let saved = false;
    try {
      const id = await connections.save({
        ...(credential ? { credential } : {}),
        draft: {
          allowDevelopmentHttp: allowHttp,
          authMode,
          baseUrl: normalizedOrigin,
          ...(editingProfileId ? { id: editingProfileId } : {}),
          name,
        },
        health: {
          checkedAtMs: diagnostic.checkedAtMs,
          pid: diagnostic.pid,
          version: diagnostic.version,
        },
      });
      setEditingProfileId(id);
      setLoadedProfileId(id);
      setNotice("Connection saved and selected.");
      saved = true;
    } catch (caught) {
      setError(profileErrorMessage(caught));
    } finally {
      setSaving(false);
    }
    if (saved) onDone?.();
  }

  async function removeProfile(profile: ConnectionProfile) {
    if (pendingRemovalId !== profile.id) {
      setPendingRemovalId(profile.id);
      return;
    }
    setError(undefined);
    setNotice(undefined);
    try {
      await connections.remove(profile.id);
      if (editingProfileId === profile.id) newConnection();
      else setPendingRemovalId(undefined);
      setNotice("Connection and credentials removed from this device.");
    } catch {
      setError("The connection could not be removed. Try again.");
    }
  }

  async function testEventStream() {
    setError(undefined);
    setStreamDiagnostic(undefined);

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOpenCodeBaseUrl(origin);
    } catch (caught) {
      setError(urlErrorMessage(caught));
      return;
    }

    if (normalizedOrigin.startsWith("http:") && !allowHttp) {
      setError("Approve private-network HTTP before connecting without TLS.");
      return;
    }

    const credential = credentialFromInput(authMode, username, secret);
    if (credential === "MISSING") {
      setError(authMode === "basic" ? "Enter a username and password." : "Enter a bearer token.");
      return;
    }

    setStreamBusy(true);
    try {
      const client = createOpenCodeClient({
        baseUrl: normalizedOrigin,
        fetch: expoOpenCodeFetch,
        ...(credential ? { authorization: connectionAuthorizationHeader(credential) } : {}),
      });
      const result = await probeEventStream(client);
      setStreamDiagnostic(result);
    } catch (caught) {
      setError(eventProbeErrorMessage(caught));
    } finally {
      setStreamBusy(false);
    }
  }

  async function testPtyTransport() {
    setError(undefined);
    setPtyDiagnostic(undefined);

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOpenCodeBaseUrl(origin);
    } catch (caught) {
      setError(urlErrorMessage(caught));
      return;
    }

    if (normalizedOrigin.startsWith("http:") && !allowHttp) {
      setError("Approve private-network HTTP before connecting without TLS.");
      return;
    }

    const credential = credentialFromInput(authMode, username, secret);
    if (credential === "MISSING") {
      setError(authMode === "basic" ? "Enter a username and password." : "Enter a bearer token.");
      return;
    }

    setPtyBusy(true);
    try {
      const client = createOpenCodeClient({
        baseUrl: normalizedOrigin,
        fetch: boundedOpenCodeFetch,
        ...(credential ? { authorization: connectionAuthorizationHeader(credential) } : {}),
      });
      setPtyDiagnostic(await probePtyTransport(client, normalizedOrigin));
    } catch (caught) {
      setError(ptyProbeErrorMessage(caught));
    } finally {
      setPtyBusy(false);
    }
  }

  async function testLifecycleRecovery() {
    setError(undefined);
    lifecycleProbe.reset();

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOpenCodeBaseUrl(origin);
    } catch (caught) {
      setError(urlErrorMessage(caught));
      return;
    }

    if (normalizedOrigin.startsWith("http:") && !allowHttp) {
      setError("Approve private-network HTTP before connecting without TLS.");
      return;
    }

    const credential = credentialFromInput(authMode, username, secret);
    if (credential === "MISSING") {
      setError(authMode === "basic" ? "Enter a username and password." : "Enter a bearer token.");
      return;
    }

    const authorization = credential ? connectionAuthorizationHeader(credential) : undefined;
    const streamClient = createOpenCodeClient({
      baseUrl: normalizedOrigin,
      fetch: expoOpenCodeFetch,
      ...(authorization ? { authorization } : {}),
    });
    const restClient = createOpenCodeClient({
      baseUrl: normalizedOrigin,
      fetch: boundedOpenCodeFetch,
      ...(authorization ? { authorization } : {}),
    });
    try {
      await lifecycleProbe.run(streamClient, restClient);
    } catch (caught) {
      setError(eventProbeErrorMessage(caught));
    }
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.headerIdentity}>
              <View style={styles.statusMark} />
              <Text style={styles.product}>OPENCODE MOBILE</Text>
            </View>
            {onDone ? (
              <Pressable accessibilityRole="button" onPress={onDone} style={styles.closeButton}>
                <Text style={styles.closeButtonLabel}>DONE</Text>
              </Pressable>
            ) : null}
          </View>

          <Text accessibilityRole="header" style={styles.title}>
            Connections
          </Text>
          <Text style={styles.intro}>Switch servers or add a direct OpenCode V2 connection.</Text>
          {onPair ? (
            <Pressable
              accessibilityRole="button"
              onPress={onPair}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.secondaryButtonPressed,
              ]}
            >
              <Text style={styles.secondaryLabel}>PAIR SERVER + NOTIFICATIONS</Text>
            </Pressable>
          ) : null}

          <View style={styles.profileSection}>
            <View style={styles.profileHeading}>
              <Text style={styles.sectionTitle}>SAVED SERVERS</Text>
              <Pressable
                accessibilityRole="button"
                onPress={newConnection}
                style={({ pressed }) => [
                  styles.smallButton,
                  pressed && styles.secondaryButtonPressed,
                ]}
              >
                <Text style={styles.smallButtonLabel}>ADD</Text>
              </Pressable>
            </View>
            {!connections.ready ? <ActivityIndicator color={palette.signal} /> : null}
            {connections.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {connections.error}
              </Text>
            ) : null}
            {connections.ready && connections.profiles.length === 0 ? (
              <Text style={styles.emptyCopy}>No connections saved on this device.</Text>
            ) : null}
            {connections.profiles.map((profile) => (
              <View
                key={profile.id}
                style={[styles.profileCard, largeText && styles.profileCardLargeText]}
              >
                <Pressable
                  accessibilityLabel={`Select ${profile.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: connections.selectedProfileId === profile.id }}
                  onPress={() => void selectProfile(profile)}
                  style={styles.profileMain}
                >
                  <View style={styles.profileNameRow}>
                    <Text numberOfLines={largeText ? undefined : 1} style={styles.profileName}>
                      {profile.name}
                    </Text>
                    {connections.selectedProfileId === profile.id ? (
                      <Text style={styles.selectedLabel}>SELECTED</Text>
                    ) : null}
                  </View>
                  <Text numberOfLines={largeText ? undefined : 1} style={styles.profileOrigin}>
                    {profile.baseUrl}
                  </Text>
                  {profile.allowDevelopmentHttp ? (
                    <Text style={styles.httpLabel}>CLEARTEXT HTTP APPROVED</Text>
                  ) : null}
                </Pressable>
                <View style={[styles.profileActions, largeText && styles.profileActionsLargeText]}>
                  <Pressable
                    accessibilityLabel={`Edit ${profile.name}`}
                    accessibilityRole="button"
                    onPress={() => void editProfile(profile)}
                    style={({ pressed }) => [
                      styles.editButton,
                      pressed && styles.secondaryButtonPressed,
                    ]}
                  >
                    <Text style={styles.editLabel}>EDIT</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={
                      pendingRemovalId === profile.id
                        ? `Confirm remove ${profile.name}`
                        : `Remove ${profile.name}`
                    }
                    accessibilityRole="button"
                    onPress={() => removeProfile(profile)}
                    style={({ pressed }) => [
                      styles.removeButton,
                      pressed && styles.removeButtonPressed,
                    ]}
                  >
                    <Text style={styles.removeLabel}>
                      {pendingRemovalId === profile.id ? "CONFIRM" : "REMOVE"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>

          {notice && !showDetails ? (
            <Text accessibilityLiveRegion="polite" style={styles.notice}>
              {notice}
            </Text>
          ) : null}
          {error && !showDetails ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          {showDetails ? (
            <>
              <View style={styles.detailHeading}>
                <Text style={styles.sectionTitle}>
                  {editingProfileId ? "CONNECTION DETAILS" : "NEW CONNECTION"}
                </Text>
                {connections.profiles.length > 0 ? (
                  <Pressable
                    accessibilityLabel="Hide connection details"
                    accessibilityRole="button"
                    onPress={() => setShowDetails(false)}
                    style={styles.smallButton}
                  >
                    <Text style={styles.smallButtonLabel}>HIDE</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.guidance}>
                <Text style={styles.guidanceTitle}>ADDRESSING FROM A DEVICE</Text>
                <Text style={styles.guidanceText}>
                  Physical devices need a LAN, Tailscale, tunnel, or remote address. iOS Simulator
                  can usually use the Mac's localhost. Android Emulator commonly uses 10.0.2.2 for
                  its host.
                </Text>
              </View>

              <View style={[styles.warningRow, styles.appLockRow]}>
                <View style={styles.warningCopy}>
                  <Text style={styles.warningTitle}>DEVICE AUTHENTICATION LOCK</Text>
                  <Text style={styles.warningText}>
                    Require Face ID, Touch ID, fingerprint, or the device passcode after launch and
                    each time this app leaves the foreground.
                  </Text>
                  {appLock.error ? (
                    <Text accessibilityRole="alert" style={styles.appLockError}>
                      {appLock.error}
                    </Text>
                  ) : null}
                </View>
                {appLock.busy ? <ActivityIndicator color={palette.signal} /> : null}
                <Switch
                  accessibilityLabel="Require device authentication"
                  disabled={appLock.busy}
                  onValueChange={appLock.setEnabled}
                  trackColor={{ false: palette.border, true: palette.signal }}
                  thumbColor={palette.ink}
                  value={appLock.enabled}
                />
              </View>

              {runtime.status !== "idle" ? (
                <View accessibilityLiveRegion="polite" style={styles.runtimeStatus}>
                  <View style={styles.resultHeading}>
                    <View
                      style={[
                        styles.runtimeDot,
                        runtime.status === "connected" && styles.runtimeDotConnected,
                      ]}
                    />
                    <Text style={styles.runtimeTitle}>{runtimeStatusLabel(runtime.status)}</Text>
                  </View>
                  {runtime.reconnectAttempt > 0 ? (
                    <Text style={styles.runtimeCopy}>
                      Reconnect attempt {runtime.reconnectAttempt}
                    </Text>
                  ) : null}
                  {runtime.cacheMetadata ? (
                    <Text style={styles.runtimeCopy}>
                      Cached shell: {runtime.cacheMetadata.projectCount} projects /{" "}
                      {runtime.cacheMetadata.activeSessionCount} active
                    </Text>
                  ) : null}
                  {runtime.serverVersion &&
                  runtime.serverVersion !== openCodeClientContractVersion ? (
                    <Text style={styles.runtimeCopy}>
                      Server {runtime.serverVersion} passed checks against client contract{" "}
                      {openCodeClientContractVersion}.
                    </Text>
                  ) : null}
                  <View style={styles.runtimeActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        if (!showRuntimeDiagnostics) {
                          setRuntimeDiagnosticsText(runtime.getDiagnosticsText());
                        }
                        setShowRuntimeDiagnostics((visible) => !visible);
                      }}
                      style={styles.runtimeButton}
                    >
                      <Text style={styles.smallButtonLabel}>
                        {showRuntimeDiagnostics ? "HIDE DIAGNOSTICS" : "SHOW DIAGNOSTICS"}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        Share.share({ message: runtime.getDiagnosticsText() }).catch(() =>
                          setError("Diagnostics could not be shared."),
                        )
                      }
                      style={styles.runtimeButton}
                    >
                      <Text style={styles.smallButtonLabel}>SHARE REDACTED</Text>
                    </Pressable>
                  </View>
                  {showRuntimeDiagnostics ? (
                    <Text selectable style={styles.diagnosticsText}>
                      {runtimeDiagnosticsText}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.panel}>
                <Field label="CONNECTION NAME">
                  <TextInput
                    accessibilityLabel="Connection name"
                    keyboardAppearance="dark"
                    maxLength={80}
                    onChangeText={setName}
                    placeholder="My OpenCode server"
                    placeholderTextColor={palette.dim}
                    style={styles.input}
                    value={name}
                  />
                </Field>

                <Field label="SERVER ORIGIN">
                  <TextInput
                    accessibilityLabel="Server origin"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    keyboardAppearance="dark"
                    onChangeText={setOrigin}
                    placeholder="http://100.64.0.10:4096"
                    placeholderTextColor={palette.dim}
                    style={styles.input}
                    value={origin}
                  />
                </Field>

                <Text style={styles.label}>AUTHENTICATION</Text>
                <View
                  accessibilityRole="radiogroup"
                  style={[styles.segmented, largeText && styles.segmentedLargeText]}
                >
                  {(["basic", "bearer", "none"] as const).map((mode) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: authMode === mode }}
                      key={mode}
                      onPress={() => {
                        setAuthMode(mode);
                        setSecret("");
                      }}
                      style={[styles.segment, authMode === mode && styles.segmentSelected]}
                    >
                      <Text
                        style={[
                          styles.segmentLabel,
                          authMode === mode && styles.segmentLabelSelected,
                        ]}
                      >
                        {mode.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {authMode === "basic" ? (
                  <Field label="USERNAME">
                    <TextInput
                      accessibilityLabel="Username"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardAppearance="dark"
                      onChangeText={setUsername}
                      style={styles.input}
                      value={username}
                    />
                  </Field>
                ) : null}

                {authMode !== "none" ? (
                  <Field label={authMode === "basic" ? "PASSWORD" : "TOKEN"}>
                    <TextInput
                      accessibilityLabel={authMode === "basic" ? "Password" : "Token"}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardAppearance="dark"
                      onChangeText={setSecret}
                      secureTextEntry
                      style={styles.input}
                      value={secret}
                    />
                  </Field>
                ) : null}

                <View style={styles.warningRow}>
                  <View style={styles.warningCopy}>
                    <Text style={styles.warningTitle}>ALLOW PRIVATE-NETWORK HTTP</Text>
                    <Text style={styles.warningText}>
                      HTTP exposes credentials and session data to anyone who can observe the route.
                      Use it only on an approved Tailscale or private network.
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel="Allow private-network HTTP"
                    onValueChange={setAllowHttp}
                    trackColor={{ false: palette.border, true: palette.signal }}
                    thumbColor={palette.ink}
                    value={allowHttp}
                  />
                </View>

                {error ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {error}
                  </Text>
                ) : null}
                {notice ? (
                  <Text accessibilityLiveRegion="polite" style={styles.notice}>
                    {notice}
                  </Text>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  disabled={saving || busy || streamBusy || ptyBusy || lifecycleBusy}
                  onPress={testConnection}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.primaryButtonPressed,
                    busy && styles.primaryButtonDisabled,
                  ]}
                >
                  {busy ? <ActivityIndicator color={palette.background} /> : null}
                  <Text style={styles.primaryLabel}>{busy ? "TESTING" : "TEST CONNECTION"}</Text>
                </Pressable>

                {diagnostic ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving || busy || streamBusy || ptyBusy || lifecycleBusy}
                    onPress={saveConnection}
                    style={({ pressed }) => [
                      styles.saveButton,
                      pressed && styles.secondaryButtonPressed,
                      saving && styles.primaryButtonDisabled,
                    ]}
                  >
                    {saving ? <ActivityIndicator color={palette.signal} /> : null}
                    <Text style={styles.secondaryLabel}>
                      {saving ? "SAVING" : editingProfileId ? "SAVE CHANGES" : "SAVE CONNECTION"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {diagnostic ? <DiagnosticCard diagnostic={diagnostic} /> : null}

              {diagnostic ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={saving || busy || streamBusy || ptyBusy || lifecycleBusy}
                  onPress={testEventStream}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.secondaryButtonPressed,
                    streamBusy && styles.primaryButtonDisabled,
                  ]}
                >
                  {streamBusy ? <ActivityIndicator color={palette.signal} /> : null}
                  <Text style={styles.secondaryLabel}>
                    {streamBusy ? "PROBING EVENT STREAM" : "RUN EVENT + CANCELLATION PROBE"}
                  </Text>
                </Pressable>
              ) : null}

              {streamDiagnostic ? <StreamDiagnosticCard diagnostic={streamDiagnostic} /> : null}

              {streamDiagnostic ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={saving || busy || streamBusy || ptyBusy || lifecycleBusy}
                  onPress={testPtyTransport}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.secondaryButtonPressed,
                    ptyBusy && styles.primaryButtonDisabled,
                  ]}
                >
                  {ptyBusy ? <ActivityIndicator color={palette.signal} /> : null}
                  <Text style={styles.secondaryLabel}>
                    {ptyBusy ? "PROBING PTY TRANSPORT" : "RUN PTY WEBSOCKET PROBE"}
                  </Text>
                </Pressable>
              ) : null}

              {ptyDiagnostic ? <PtyDiagnosticCard diagnostic={ptyDiagnostic} /> : null}

              {ptyDiagnostic ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={saving || busy || streamBusy || ptyBusy || lifecycleBusy}
                  onPress={testLifecycleRecovery}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.secondaryButtonPressed,
                    lifecycleBusy && styles.primaryButtonDisabled,
                  ]}
                >
                  {lifecycleBusy ? <ActivityIndicator color={palette.signal} /> : null}
                  <Text style={styles.secondaryLabel}>
                    {lifecycleBusy ? "LIFECYCLE PROBE RUNNING" : "RUN BACKGROUND + RECONNECT PROBE"}
                  </Text>
                </Pressable>
              ) : null}

              {lifecycleBusy ? <LifecyclePrompt phase={lifecycleProbe.phase} /> : null}
              {lifecycleProbe.result ? (
                <LifecycleDiagnosticCard diagnostic={lifecycleProbe.result} />
              ) : null}
            </>
          ) : null}

          <Text style={styles.footer}>
            CLIENT CONTRACT {openCodeClientContractVersion} / HERMES NATIVE
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function DiagnosticCard({ diagnostic }: { diagnostic: Diagnostic }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.result}>
      <View style={styles.resultHeading}>
        <View style={styles.resultDot} />
        <Text style={styles.resultTitle}>SERVER REACHABLE</Text>
      </View>
      <View style={styles.metrics}>
        <Metric label="VERSION" value={diagnostic.version} />
        <Metric label="PID" value={String(diagnostic.pid)} />
        <Metric label="SESSIONS" value={String(diagnostic.sessions)} />
        <Metric label="URLS" value={String(diagnostic.advertisedUrls)} />
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text numberOfLines={1} style={styles.metricValue}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function StreamDiagnosticCard({ diagnostic }: { diagnostic: StreamDiagnostic }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.streamResult}>
      <View style={styles.resultHeading}>
        <View style={styles.resultDot} />
        <Text style={styles.resultTitle}>EVENT TRANSPORT PASSED</Text>
      </View>
      <Text style={styles.streamCopy}>
        Received <Text style={styles.streamCode}>{diagnostic.eventType}</Text>, then stopped the
        pending read with AbortSignal.
      </Text>
    </View>
  );
}

function PtyDiagnosticCard({ diagnostic }: { diagnostic: PtyDiagnostic }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.streamResult}>
      <View style={styles.resultHeading}>
        <View style={styles.resultDot} />
        <Text style={styles.resultTitle}>PTY TRANSPORT PASSED</Text>
      </View>
      <Text style={styles.streamCopy}>
        Minted a {diagnostic.ticketExpiresIn}s ticket, received the probe marker over WebSocket,
        then removed the temporary PTY.
      </Text>
    </View>
  );
}

function LifecyclePrompt({ phase }: { phase: LifecycleTransportPhase }) {
  const copy = {
    "background-observed": "Background detected and the old stream stopped. Return to the app.",
    failed: "The lifecycle probe failed.",
    idle: "Preparing the lifecycle probe.",
    opening: "Opening an event stream before the app backgrounds.",
    passed: "The lifecycle probe passed.",
    "ready-to-background": "Send the app to the background, wait a moment, then return to it.",
    recovering: "Foreground detected. Checking health and opening a fresh event stream.",
  }[phase];

  return (
    <View accessibilityLiveRegion="polite" style={styles.lifecyclePrompt}>
      <Text style={styles.warningTitle}>LIFECYCLE ACTION REQUIRED</Text>
      <Text style={styles.warningText}>{copy}</Text>
    </View>
  );
}

function LifecycleDiagnosticCard({ diagnostic }: { diagnostic: LifecycleTransportResult }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.streamResult}>
      <View style={styles.resultHeading}>
        <View style={styles.resultDot} />
        <Text style={styles.resultTitle}>LIFECYCLE RECOVERY PASSED</Text>
      </View>
      <Text style={styles.streamCopy}>
        Cancelled <Text style={styles.streamCode}>{diagnostic.initialEventType}</Text> on
        background, passed a foreground health check, then received{" "}
        <Text style={styles.streamCode}>{diagnostic.reconnectEventType}</Text> on a fresh stream.
      </Text>
    </View>
  );
}

function credentialFromInput(
  mode: ConnectionAuthMode,
  username: string,
  secret: string,
): ConnectionCredential | "MISSING" | undefined {
  if (mode === "none") return undefined;
  if (mode === "bearer") return secret ? { mode, schemaVersion: 1, token: secret } : "MISSING";
  return username && secret ? { mode, password: secret, schemaVersion: 1, username } : "MISSING";
}

function connectionConfigurationKey(
  origin: string,
  mode: ConnectionAuthMode,
  username: string,
  secret: string,
  allowHttp: boolean,
) {
  return JSON.stringify([origin, mode, username, secret, allowHttp]);
}

function isLoopbackHost(origin: string) {
  const hostname = new URL(origin).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function profileErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "The connection could not be saved.";
  if (error.message === "INVALID_CONNECTION_NAME") {
    return "Enter a connection name between 1 and 80 characters.";
  }
  if (error.message === "CREDENTIAL_TOO_LARGE") return "The credential is too large to store.";
  if (error.message === "SECURE_STORE_UNAVAILABLE") {
    return "Secure credential storage is not available on this device.";
  }
  return "The connection could not be saved.";
}

function runtimeStatusLabel(status: ReturnType<typeof useConnectionRuntime>["status"]) {
  return {
    connected: "LIVE CONNECTION",
    connecting: "CONNECTING",
    idle: "NO CONNECTION SELECTED",
    incompatible: "INCOMPATIBLE SERVER",
    offline: "DEVICE OFFLINE",
    reconnecting: "RECONNECTING",
    stale: "CONNECTION PAUSED",
    unauthorized: "AUTHORIZATION REQUIRED",
  }[status];
}

function urlErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Enter a valid HTTP or HTTPS server origin.";
  if (error.message === "UNSUPPORTED_PROTOCOL") return "Use an HTTP or HTTPS URL.";
  if (error.message === "EMBEDDED_CREDENTIALS") return "Enter credentials in the fields below.";
  if (error.message === "BASE_URL_MUST_BE_ORIGIN") {
    return "Enter only the server origin, without a path, query, or fragment.";
  }
  return "Enter a valid HTTP or HTTPS server origin.";
}

function connectionErrorMessage(kind: ReturnType<typeof classifyOpenCodeError>) {
  if (kind === "UNAUTHORIZED") return "The server rejected these credentials.";
  if (kind === "TIMEOUT") return "The server did not respond within 10 seconds.";
  if (kind === "TLS") return "The server's TLS certificate could not be verified.";
  if (kind === "INCOMPATIBLE") return "The server does not expose the required OpenCode V2 API.";
  if (kind === "MALFORMED_RESPONSE") return "The server returned an undecodable response.";
  if (kind === "UNSUPPORTED_CONTENT") return "The server returned an unexpected content type.";
  if (kind === "SSE_TOO_LARGE") return "The server returned an event larger than the client limit.";
  if (kind === "RESPONSE_TOO_LARGE")
    return "The server returned JSON larger than the client limit.";
  if (kind === "UNSAFE_REDIRECT") {
    return "The server tried to redirect this request outside its approved origin.";
  }
  return "The server could not be reached. Check its address, network, and TLS settings.";
}

function eventProbeErrorMessage(error: unknown) {
  if (error instanceof EventProbeError) {
    if (error.reason === "NO_EVENT") return "No event arrived within 10 seconds.";
    if (error.reason === "STREAM_ENDED") return "The event stream ended before its first event.";
    return "AbortSignal did not stop the event stream within 3 seconds.";
  }

  const kind = classifyOpenCodeError(error);
  if (kind === "UNSUPPORTED_CONTENT") {
    return "The server or this Expo runtime does not expose a readable event stream.";
  }
  if (kind === "MALFORMED_RESPONSE") return "The event stream returned an undecodable frame.";
  return connectionErrorMessage(kind);
}

function ptyProbeErrorMessage(error: unknown) {
  if (error instanceof PtyProbeError) {
    if (error.reason === "WEBSOCKET_UNAVAILABLE") return "This runtime does not provide WebSocket.";
    if (error.reason === "SOCKET_TIMEOUT") {
      return "The PTY WebSocket did not return the probe marker within 5 seconds.";
    }
    if (error.reason === "SOCKET_CLOSED") {
      return "The PTY WebSocket closed before returning the probe marker.";
    }
    if (error.reason === "SOCKET_ERROR") return "The PTY WebSocket connection failed.";
    if (error.reason === "OUTPUT_TOO_LARGE") {
      return "The PTY returned more than 64 KiB before the probe marker.";
    }
    return "The temporary PTY worked but could not be removed.";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "ForbiddenError"
  ) {
    return "The server rejected the PTY connect-ticket request.";
  }
  return connectionErrorMessage(classifyOpenCodeError(error));
}

const styles = StyleSheet.create({
  appLockError: {
    color: palette.danger,
    fontSize: 12,
    lineHeight: 18,
    marginTop: space.sm,
  },
  appLockRow: { marginTop: space.lg },
  content: {
    alignSelf: "center",
    paddingBottom: space.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    width: "100%",
    maxWidth: 680,
  },
  error: {
    backgroundColor: "#281513",
    borderColor: "#5C2D27",
    borderRadius: radius.sm,
    borderWidth: 1,
    color: palette.danger,
    fontSize: 14,
    lineHeight: 20,
    padding: space.md,
  },
  emptyCopy: {
    color: palette.dim,
    fontSize: 14,
    lineHeight: 20,
  },
  diagnosticsText: {
    color: palette.dim,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 10,
    lineHeight: 16,
    marginTop: space.xs,
  },
  detailHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: space.xl,
  },
  editButton: {
    alignItems: "center",
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: space.sm,
  },
  editLabel: { color: palette.signal, fontSize: 10, fontWeight: "900", letterSpacing: 0.7 },
  field: {
    gap: space.xs,
  },
  flex: { flex: 1 },
  footer: {
    color: palette.dim,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 10,
    letterSpacing: 1.2,
    marginTop: space.lg,
    textAlign: "center",
  },
  guidance: {
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    gap: space.xs,
    marginTop: space.lg,
    paddingBottom: space.lg,
  },
  guidanceText: {
    color: palette.dim,
    fontSize: 13,
    lineHeight: 20,
  },
  guidanceTitle: {
    color: palette.warm,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerIdentity: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    minWidth: 0,
  },
  closeButton: {
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginLeft: space.sm,
    minHeight: 44,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  closeButtonLabel: {
    color: palette.ink,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  input: {
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: palette.ink,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  intro: {
    color: palette.dim,
    fontSize: 16,
    lineHeight: 24,
    marginTop: space.md,
    maxWidth: 560,
  },
  label: {
    color: palette.dim,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  lifecyclePrompt: {
    backgroundColor: "#21190F",
    borderColor: "#4B3820",
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: space.md,
    padding: space.md,
  },
  metric: {
    minWidth: "45%",
  },
  metricLabel: {
    color: palette.dim,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    marginTop: 3,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.lg,
  },
  metricValue: {
    color: palette.ink,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 17,
    fontWeight: "600",
  },
  notice: {
    backgroundColor: palette.signalDark,
    borderColor: "#425E26",
    borderRadius: radius.sm,
    borderWidth: 1,
    color: palette.signal,
    fontSize: 14,
    lineHeight: 20,
    padding: space.md,
  },
  panel: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.md,
    marginTop: space.xl,
    padding: space.md,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: palette.signal,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: space.md,
  },
  primaryButtonDisabled: { opacity: 0.65 },
  primaryButtonPressed: { backgroundColor: "#9BD955" },
  primaryLabel: {
    color: palette.background,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  profileCard: {
    alignItems: "stretch",
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  profileCardLargeText: {
    flexDirection: "column",
  },
  profileActions: { borderLeftColor: palette.border, borderLeftWidth: 1 },
  profileActionsLargeText: {
    borderLeftWidth: 0,
    borderTopColor: palette.border,
    borderTopWidth: 1,
    flexDirection: "row",
  },
  profileHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    justifyContent: "space-between",
  },
  profileMain: {
    flex: 1,
    gap: 4,
    padding: space.md,
  },
  profileName: {
    color: palette.ink,
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
  },
  profileNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
  },
  profileOrigin: {
    color: palette.dim,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 12,
  },
  profileSection: {
    gap: space.sm,
    marginTop: space.xl,
  },
  product: {
    color: palette.signal,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  result: {
    backgroundColor: palette.signalDark,
    borderColor: "#425E26",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.lg,
    marginTop: space.md,
    padding: space.lg,
  },
  resultDot: {
    backgroundColor: palette.signal,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  resultHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
  },
  resultTitle: {
    color: palette.signal,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  runtimeCopy: {
    color: palette.dim,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 11,
  },
  runtimeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.xs,
  },
  runtimeButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
  },
  runtimeDot: {
    backgroundColor: palette.warm,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  runtimeDotConnected: { backgroundColor: palette.signal },
  runtimeStatus: {
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    gap: space.xs,
    paddingBottom: space.md,
    paddingTop: space.md,
  },
  runtimeTitle: {
    color: palette.ink,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  removeButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: space.sm,
  },
  removeButtonPressed: { backgroundColor: "#281513" },
  removeLabel: {
    color: palette.danger,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
    textAlign: "center",
  },
  saveButton: {
    alignItems: "center",
    borderColor: palette.signal,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: space.md,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: palette.signal,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "center",
    marginTop: space.md,
    minHeight: 52,
    paddingHorizontal: space.md,
  },
  secondaryButtonPressed: { backgroundColor: palette.signalDark },
  secondaryLabel: {
    color: palette.signal,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
  },
  selectedLabel: {
    color: palette.signal,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  smallButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
  },
  smallButtonLabel: {
    color: palette.signal,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  safeArea: {
    backgroundColor: palette.background,
    flex: 1,
  },
  segment: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    minHeight: 44,
    paddingHorizontal: space.xs,
    paddingVertical: space.sm,
  },
  segmented: {
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    padding: 3,
  },
  segmentedLargeText: {
    flexDirection: "column",
  },
  segmentLabel: {
    color: palette.dim,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  segmentLabelSelected: { color: palette.background },
  segmentSelected: { backgroundColor: palette.signal },
  statusMark: {
    backgroundColor: palette.signal,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  streamCode: {
    color: palette.signal,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontWeight: "700",
  },
  streamCopy: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 21,
  },
  streamResult: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.md,
    marginTop: space.md,
    padding: space.lg,
  },
  title: {
    color: palette.ink,
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: -1.5,
    lineHeight: 44,
    marginTop: 42,
    maxWidth: 600,
  },
  httpLabel: {
    color: palette.warm,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
    marginTop: 3,
  },
  warningCopy: { flex: 1 },
  warningRow: {
    alignItems: "flex-start",
    backgroundColor: "#21190F",
    borderColor: "#4B3820",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.sm,
    padding: space.md,
  },
  warningText: {
    color: "#C8B79E",
    fontSize: 13,
    lineHeight: 19,
    marginTop: space.xs,
  },
  warningTitle: {
    color: palette.warm,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
});
