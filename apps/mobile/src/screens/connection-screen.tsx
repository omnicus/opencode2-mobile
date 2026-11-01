import Feather from "@expo/vector-icons/Feather";
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
import { type ReactNode, useEffect, useRef, useState } from "react";
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
import { Button } from "../components/button";
import { managementStyles, SettingsGroup } from "../components/management-layout";
import { MenuRow } from "../components/menu-row";
import { SegmentedControl, type SegmentedOption } from "../components/segmented-control";
import { connectionAuthorizationHeader } from "../connections/connection-authorization";
import type {
  ConnectionAuthMode,
  ConnectionCredential,
  ConnectionProfile,
} from "../connections/connection-profile";
import { useConnections } from "../connections/connections-context";
import { boundedOpenCodeFetch, expoOpenCodeFetch } from "../expo-open-code-fetch";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import {
  cardSurface,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  space,
  switchColors,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";
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
  const runtime = useConnectionRuntime();
  const { fontScale } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
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
  const [showAdvanced, setShowAdvanced] = useState(false);
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
      const [health, sessions] = await Promise.all([
        client.server.status(requestOptions),
        client.session.list({ limit: 1, order: "desc" }, requestOptions),
      ]);

      setOrigin(normalizedOrigin);
      setDiagnostic({
        advertisedUrls: health.urls.length,
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

  const editingProfile = connections.profiles.find((profile) => profile.id === editingProfileId);
  const actionsDisabled = saving || busy || streamBusy || ptyBusy || lifecycleBusy;
  const centeredTitle = Platform.OS === "ios";

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        {centeredTitle ? <View style={styles.headerSide} /> : null}
        <Text
          accessibilityRole="header"
          dynamicTypeRamp={typeRamp.navTitle}
          style={[styles.title, centeredTitle ? styles.titleCentered : styles.titleLeading]}
        >
          Connections
        </Text>
        <View style={[styles.headerTrailing, centeredTitle && styles.headerSide]}>
          {onDone ? (
            <Pressable
              accessibilityRole="button"
              android_ripple={Platform.OS === "android" ? borderlessRipple : undefined}
              onPress={onDone}
              style={({ pressed }) => [
                styles.doneButton,
                pressed && Platform.OS === "ios" && styles.pressed,
              ]}
            >
              <Text dynamicTypeRamp={typeRamp.navTitle} style={styles.doneLabel}>
                Done
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {connections.profiles.length === 0 ? (
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.intro}>
              Switch servers or add a direct OpenCode V2 connection.
            </Text>
          ) : null}
          {connections.error ? (
            <Text
              accessibilityRole="alert"
              dynamicTypeRamp={typeRamp.subheadline}
              style={[styles.message, styles.error]}
            >
              {connections.error}
            </Text>
          ) : null}

          <SettingsGroup title="Saved servers">
            {!connections.ready ? (
              <View style={[styles.messageRow, styles.separator]}>
                <ActivityIndicator color={palette.signal} />
              </View>
            ) : null}
            {connections.ready && connections.profiles.length === 0 ? (
              <View style={[styles.messageRow, styles.separator]}>
                <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.emptyCopy}>
                  No connections saved on this device.
                </Text>
              </View>
            ) : null}
            {connections.profiles.map((profile) => {
              const selected = connections.selectedProfileId === profile.id;
              return (
                <View
                  key={profile.id}
                  style={[
                    styles.profileRow,
                    styles.separator,
                    largeText && styles.profileRowLargeText,
                  ]}
                >
                  <Pressable
                    accessibilityLabel={`Select ${profile.name}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    android_ripple={Platform.OS === "android" ? ripple : undefined}
                    onPress={() => void selectProfile(profile)}
                    style={({ pressed }) => [
                      styles.profileMain,
                      pressed && Platform.OS === "ios" && styles.pressed,
                    ]}
                  >
                    <View style={styles.profileCopy}>
                      <Text
                        dynamicTypeRamp={typeRamp.body}
                        numberOfLines={largeText ? undefined : 1}
                        style={styles.profileName}
                      >
                        {profile.name}
                      </Text>
                      <Text
                        dynamicTypeRamp={typeRamp.footnote}
                        numberOfLines={largeText ? undefined : 1}
                        style={styles.profileOrigin}
                      >
                        {profile.baseUrl}
                      </Text>
                      {profile.allowDevelopmentHttp ? (
                        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.httpLabel}>
                          Cleartext HTTP approved
                        </Text>
                      ) : null}
                    </View>
                    {selected ? (
                      <Feather accessible={false} color={palette.signal} name="check" size={18} />
                    ) : null}
                  </Pressable>
                  <View style={[styles.profileAction, largeText && styles.profileActionLargeText]}>
                    <Button
                      accessibilityLabel={`Edit ${profile.name}`}
                      label="Edit"
                      onPress={() => void editProfile(profile)}
                      size="compact"
                      variant="text"
                    />
                  </View>
                </View>
              );
            })}
            <MenuRow
              disclosure={false}
              icon="plus"
              label="Add server"
              last={!onPair}
              onPress={newConnection}
            />
            {onPair ? (
              <MenuRow icon="camera" label="Pair with QR code" last onPress={onPair} />
            ) : null}
          </SettingsGroup>

          {notice && !showDetails ? (
            <Text
              accessibilityLiveRegion="polite"
              dynamicTypeRamp={typeRamp.subheadline}
              style={[styles.message, styles.notice]}
            >
              {notice}
            </Text>
          ) : null}
          {error && !showDetails ? (
            <Text
              accessibilityRole="alert"
              dynamicTypeRamp={typeRamp.subheadline}
              style={[styles.message, styles.error]}
            >
              {error}
            </Text>
          ) : null}

          {showDetails ? (
            <View style={styles.details}>
              <View style={styles.section}>
                <View style={styles.detailHeading}>
                  <Text
                    accessibilityRole="header"
                    dynamicTypeRamp={typeRamp.sectionLabel}
                    style={styles.sectionTitle}
                  >
                    {editingProfileId ? "Server details" : "New server"}
                  </Text>
                  {connections.profiles.length > 0 ? (
                    <Button
                      accessibilityLabel="Hide connection details"
                      label="Hide"
                      onPress={() => setShowDetails(false)}
                      size="compact"
                      variant="text"
                    />
                  ) : null}
                </View>
                <View style={managementStyles.group}>
                  <Field label="Name">
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

                  <Field label="Server address">
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

                  <View style={[styles.fieldRow, authMode !== "none" && styles.separator]}>
                    <Text
                      accessibilityElementsHidden
                      dynamicTypeRamp={typeRamp.footnote}
                      importantForAccessibility="no"
                      style={styles.fieldLabel}
                    >
                      Authentication
                    </Text>
                    <SegmentedControl
                      accessibilityLabel="Authentication"
                      onChange={(mode) => {
                        setAuthMode(mode);
                        setSecret("");
                      }}
                      options={authModeOptions}
                      surface="card"
                      value={authMode}
                    />
                  </View>

                  {authMode === "basic" ? (
                    <Field label="Username">
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
                    <Field label={authMode === "basic" ? "Password" : "Token"} last>
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
                </View>
                <Text dynamicTypeRamp={typeRamp.footnote} style={styles.helper}>
                  Physical devices need a LAN, Tailscale, tunnel, or remote address. iOS Simulator
                  can usually use the Mac's localhost. Android Emulator commonly uses 10.0.2.2 for
                  its host.
                </Text>
              </View>

              <View style={managementStyles.group}>
                <View style={[styles.switchRow, largeText && styles.switchRowLargeText]}>
                  <View style={styles.switchCopy}>
                    <Text dynamicTypeRamp={typeRamp.body} style={styles.rowTitle}>
                      Allow private-network HTTP
                    </Text>
                    <Text dynamicTypeRamp={typeRamp.footnote} style={styles.rowDescription}>
                      HTTP exposes credentials and session data to anyone who can observe the route.
                      Use it only on an approved Tailscale or private network.
                    </Text>
                  </View>
                  <Switch
                    {...switchColors}
                    accessibilityLabel="Allow private-network HTTP"
                    onValueChange={setAllowHttp}
                    value={allowHttp}
                  />
                </View>
              </View>

              {error ? (
                <Text
                  accessibilityRole="alert"
                  dynamicTypeRamp={typeRamp.subheadline}
                  style={[styles.message, styles.error]}
                >
                  {error}
                </Text>
              ) : null}
              {notice ? (
                <Text
                  accessibilityLiveRegion="polite"
                  dynamicTypeRamp={typeRamp.subheadline}
                  style={[styles.message, styles.notice]}
                >
                  {notice}
                </Text>
              ) : null}

              {diagnostic ? <DiagnosticCard diagnostic={diagnostic} /> : null}

              {diagnostic ? (
                <View style={styles.actions}>
                  <Button
                    busy={saving}
                    disabled={actionsDisabled}
                    fullWidth
                    label={
                      saving ? "Saving…" : editingProfileId ? "Save changes" : "Save connection"
                    }
                    onPress={() => void saveConnection()}
                    variant="primary"
                  />
                  <Button
                    busy={busy}
                    disabled={actionsDisabled}
                    fullWidth
                    label={busy ? "Testing…" : "Test again"}
                    onPress={() => void testConnection()}
                  />
                </View>
              ) : (
                <Button
                  busy={busy}
                  disabled={actionsDisabled}
                  fullWidth
                  label={busy ? "Testing…" : "Test connection"}
                  onPress={() => void testConnection()}
                  variant="primary"
                />
              )}

              <View style={managementStyles.group}>
                <Pressable
                  accessibilityHint="Diagnostics and transport probes"
                  accessibilityLabel="Advanced"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showAdvanced }}
                  android_ripple={Platform.OS === "android" ? ripple : undefined}
                  onPress={() => setShowAdvanced((visible) => !visible)}
                  style={({ pressed }) => [
                    styles.menuRow,
                    pressed && Platform.OS === "ios" && styles.pressed,
                  ]}
                >
                  <Feather accessible={false} color={palette.dim} name="activity" size={18} />
                  <View style={styles.menuCopy}>
                    <Text dynamicTypeRamp={typeRamp.body} style={styles.rowTitle}>
                      Advanced
                    </Text>
                    <Text dynamicTypeRamp={typeRamp.footnote} style={styles.rowDescription}>
                      Diagnostics and transport probes
                    </Text>
                  </View>
                  <Feather
                    accessible={false}
                    color={palette.dim}
                    name={showAdvanced ? "chevron-up" : "chevron-down"}
                    size={16}
                  />
                </Pressable>
              </View>

              {showAdvanced ? (
                <View style={styles.advanced}>
                  {runtime.status !== "idle" ? (
                    <View accessibilityLiveRegion="polite" style={styles.runtimeStatus}>
                      <View style={styles.resultHeading}>
                        <View
                          style={[
                            styles.runtimeDot,
                            runtime.status === "connected" && styles.runtimeDotConnected,
                          ]}
                        />
                        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.runtimeTitle}>
                          {runtimeStatusLabel(runtime.status)}
                        </Text>
                      </View>
                      {runtime.reconnectAttempt > 0 ? (
                        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.runtimeCopy}>
                          Reconnect attempt {runtime.reconnectAttempt}
                        </Text>
                      ) : null}
                      {runtime.cacheMetadata ? (
                        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.runtimeCopy}>
                          Cached shell: {runtime.cacheMetadata.projectCount} projects /{" "}
                          {runtime.cacheMetadata.activeSessionCount} active
                        </Text>
                      ) : null}
                      {runtime.serverVersion &&
                      runtime.serverVersion !== openCodeClientContractVersion ? (
                        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.runtimeCopy}>
                          Server {runtime.serverVersion} passed checks against client contract{" "}
                          {openCodeClientContractVersion}.
                        </Text>
                      ) : null}
                      <View style={styles.runtimeActions}>
                        <Button
                          label={showRuntimeDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
                          onPress={() => {
                            if (!showRuntimeDiagnostics) {
                              setRuntimeDiagnosticsText(runtime.getDiagnosticsText());
                            }
                            setShowRuntimeDiagnostics((visible) => !visible);
                          }}
                          size="compact"
                        />
                        <Button
                          label="Share redacted report"
                          onPress={() =>
                            void Share.share({ message: runtime.getDiagnosticsText() }).catch(() =>
                              setError("Diagnostics could not be shared."),
                            )
                          }
                          size="compact"
                        />
                      </View>
                      {showRuntimeDiagnostics ? (
                        <Text
                          dynamicTypeRamp={typeRamp.footnote}
                          selectable
                          style={styles.diagnosticsText}
                        >
                          {runtimeDiagnosticsText}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  {diagnostic ? (
                    <Button
                      busy={streamBusy}
                      disabled={actionsDisabled}
                      fullWidth
                      label={
                        streamBusy ? "Probing event stream…" : "Run event and cancellation probe"
                      }
                      onPress={() => void testEventStream()}
                    />
                  ) : (
                    <Text dynamicTypeRamp={typeRamp.footnote} style={styles.helper}>
                      Test the connection to run transport probes.
                    </Text>
                  )}

                  {streamDiagnostic ? <StreamDiagnosticCard diagnostic={streamDiagnostic} /> : null}

                  {streamDiagnostic ? (
                    <Button
                      busy={ptyBusy}
                      disabled={actionsDisabled}
                      fullWidth
                      label={ptyBusy ? "Probing PTY transport…" : "Run PTY WebSocket probe"}
                      onPress={() => void testPtyTransport()}
                    />
                  ) : null}

                  {ptyDiagnostic ? <PtyDiagnosticCard diagnostic={ptyDiagnostic} /> : null}

                  {ptyDiagnostic ? (
                    <Button
                      busy={lifecycleBusy}
                      disabled={actionsDisabled}
                      fullWidth
                      label={
                        lifecycleBusy
                          ? "Lifecycle probe running…"
                          : "Run background and reconnect probe"
                      }
                      onPress={() => void testLifecycleRecovery()}
                    />
                  ) : null}

                  {lifecycleBusy ? <LifecyclePrompt phase={lifecycleProbe.phase} /> : null}
                  {lifecycleProbe.result ? (
                    <LifecycleDiagnosticCard diagnostic={lifecycleProbe.result} />
                  ) : null}
                </View>
              ) : null}

              {editingProfile ? (
                <Button
                  accessibilityLabel={
                    pendingRemovalId === editingProfile.id
                      ? `Confirm remove ${editingProfile.name}`
                      : `Remove ${editingProfile.name}`
                  }
                  fullWidth
                  label={
                    pendingRemovalId === editingProfile.id ? "Confirm remove" : "Remove server"
                  }
                  onPress={() => void removeProfile(editingProfile)}
                  variant="danger"
                />
              ) : null}
            </View>
          ) : null}

          <Text dynamicTypeRamp={typeRamp.footnote} style={styles.footer}>
            Client contract {openCodeClientContractVersion} / Hermes native
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const ripple = { color: "rgba(255,255,255,0.12)" };
const borderlessRipple = { ...ripple, borderless: true };

const authModeOptions = [
  { label: "Basic", value: "basic" },
  { label: "Bearer", value: "bearer" },
  { label: "None", value: "none" },
] as const satisfies readonly SegmentedOption<ConnectionAuthMode>[];

function Field({
  children,
  label,
  last = false,
}: {
  children: ReactNode;
  label: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.fieldRow, !last && styles.separator]}>
      <Text
        accessibilityElementsHidden
        dynamicTypeRamp={typeRamp.footnote}
        importantForAccessibility="no"
        style={styles.fieldLabel}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

function ResultCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.resultCard}>
      <View style={styles.resultHeading}>
        <View style={styles.resultDot} />
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.resultTitle}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function DiagnosticCard({ diagnostic }: { diagnostic: Diagnostic }) {
  return (
    <ResultCard title="Server reachable">
      <View style={styles.metrics}>
        <Metric label="Version" value={diagnostic.version} />
        <Metric label="PID" value={String(diagnostic.pid)} />
        <Metric label="Sessions" value={String(diagnostic.sessions)} />
        <Metric label="URLs" value={String(diagnostic.advertisedUrls)} />
      </View>
    </ResultCard>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text dynamicTypeRamp={typeRamp.headline} numberOfLines={1} style={styles.metricValue}>
        {value}
      </Text>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.metricLabel}>
        {label}
      </Text>
    </View>
  );
}

function StreamDiagnosticCard({ diagnostic }: { diagnostic: StreamDiagnostic }) {
  return (
    <ResultCard title="Event transport passed">
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.resultCopy}>
        Received{" "}
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.resultCode}>
          {diagnostic.eventType}
        </Text>
        , then stopped the pending read with AbortSignal.
      </Text>
    </ResultCard>
  );
}

function PtyDiagnosticCard({ diagnostic }: { diagnostic: PtyDiagnostic }) {
  return (
    <ResultCard title="PTY transport passed">
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.resultCopy}>
        Minted a {diagnostic.ticketExpiresIn}s ticket, received the probe marker over WebSocket,
        then removed the temporary PTY.
      </Text>
    </ResultCard>
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
    <View accessibilityLiveRegion="polite" style={[styles.resultCard, styles.lifecyclePrompt]}>
      <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.lifecycleTitle}>
        Lifecycle action required
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.lifecycleCopy}>
        {copy}
      </Text>
    </View>
  );
}

function LifecycleDiagnosticCard({ diagnostic }: { diagnostic: LifecycleTransportResult }) {
  return (
    <ResultCard title="Lifecycle recovery passed">
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.resultCopy}>
        Cancelled{" "}
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.resultCode}>
          {diagnostic.initialEventType}
        </Text>{" "}
        on background, passed a foreground health check, then received{" "}
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.resultCode}>
          {diagnostic.reconnectEventType}
        </Text>{" "}
        on a fresh stream.
      </Text>
    </ResultCard>
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
    connected: "Connected",
    connecting: "Connecting",
    idle: "No connection selected",
    incompatible: "Incompatible server",
    offline: "Device offline",
    reconnecting: "Reconnecting",
    stale: "Connection paused",
    unauthorized: "Authorization required",
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
  actions: { gap: space.sm },
  advanced: { gap: space.md },
  content: {
    alignSelf: "center",
    gap: space.lg,
    maxWidth: 680,
    paddingBottom: space.xl,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    width: "100%",
  },
  details: { gap: space.md },
  detailHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: minTouchTarget,
  },
  diagnosticsText: {
    ...typography.code,
    color: palette.dim,
  },
  doneButton: {
    alignItems: "flex-end",
    justifyContent: "center",
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  doneLabel: { ...typography.navTitle, color: palette.signal },
  emptyCopy: { ...typography.subheadline, color: palette.dim },
  error: { borderColor: palette.danger, color: palette.danger },
  fieldLabel: { ...typography.footnote, color: palette.dim },
  fieldRow: {
    gap: 2,
    justifyContent: "center",
    minHeight: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  flex: { flex: 1 },
  footer: {
    ...typography.footnote,
    color: palette.dim,
    textAlign: "center",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: space.md,
  },
  headerSide: { flex: 1 },
  headerTrailing: { alignItems: "flex-end" },
  helper: {
    ...typography.footnote,
    color: palette.dim,
    paddingHorizontal: space.md,
  },
  httpLabel: { ...typography.footnote, color: palette.warm },
  input: {
    ...typography.body,
    color: palette.ink,
    minHeight: 32,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  intro: { ...typography.subheadline, color: palette.dim },
  lifecycleCopy: { ...typography.subheadline, color: palette.dim },
  lifecyclePrompt: { borderColor: palette.warm },
  lifecycleTitle: { ...typography.sectionLabel, color: palette.warm },
  menuCopy: { flex: 1, gap: 2, minWidth: 0 },
  menuRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  message: {
    ...typography.subheadline,
    backgroundColor: palette.background,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.md,
  },
  messageRow: {
    alignItems: "flex-start",
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  metric: { minWidth: "45%" },
  metricLabel: { ...typography.footnote, color: palette.dim },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
  },
  metricValue: { ...typography.headline, color: palette.ink },
  notice: { borderColor: palette.success, color: palette.success },
  pressed: { opacity: pressedOpacity },
  profileAction: { paddingRight: space.xs },
  profileActionLargeText: { paddingBottom: space.xs, paddingHorizontal: space.xs },
  profileCopy: { flex: 1, gap: 2, minWidth: 0 },
  profileMain: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: space.sm,
    minHeight: 52,
    paddingLeft: space.md,
    paddingRight: space.xs,
    paddingVertical: space.sm,
  },
  profileName: { ...typography.body, color: palette.ink },
  profileOrigin: {
    ...typography.footnote,
    color: palette.dim,
    fontFamily: typography.code.fontFamily,
  },
  profileRow: { alignItems: "center", flexDirection: "row" },
  profileRowLargeText: { alignItems: "stretch", flexDirection: "column" },
  resultCard: {
    ...cardSurface,
    borderColor: palette.success,
    gap: space.sm,
  },
  resultCode: {
    color: palette.signal,
    fontFamily: typography.code.fontFamily,
  },
  resultCopy: { ...typography.subheadline, color: palette.ink },
  resultDot: {
    backgroundColor: palette.success,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  resultHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
  },
  resultTitle: { ...typography.sectionLabel, color: palette.success },
  rowDescription: { ...typography.footnote, color: palette.dim },
  rowTitle: { ...typography.body, color: palette.ink },
  runtimeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.xs,
  },
  runtimeCopy: { ...typography.footnote, color: palette.dim },
  runtimeDot: {
    backgroundColor: palette.warm,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  runtimeDotConnected: { backgroundColor: palette.success },
  runtimeStatus: { ...cardSurface, gap: space.xs },
  runtimeTitle: { ...typography.sectionLabel, color: palette.ink },
  safeArea: {
    backgroundColor: palette.background,
    flex: 1,
  },
  section: { gap: space.xs },
  sectionTitle: {
    ...typography.sectionLabel,
    color: palette.dim,
    flexShrink: 1,
    paddingHorizontal: space.md,
  },
  separator: {
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  switchCopy: { flex: 1, gap: 2, minWidth: 0 },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  switchRowLargeText: { alignItems: "flex-start", flexDirection: "column" },
  title: { ...typography.navTitle, color: palette.ink },
  titleCentered: { flexShrink: 1, textAlign: "center" },
  titleLeading: { flex: 1 },
});
