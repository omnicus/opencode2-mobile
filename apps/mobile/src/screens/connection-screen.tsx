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
  Alert,
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
import { MenuGroup, MenuRow } from "../components/menu-row";
import { SegmentedControl, type SegmentedOption } from "../components/segmented-control";
import { useAnnouncement } from "../components/use-announcement";
import { connectionAuthorizationHeader } from "../connections/connection-authorization";
import type {
  ConnectionAuthMode,
  ConnectionCredential,
  ConnectionProfile,
} from "../connections/connection-profile";
import { useConnections } from "../connections/connections-context";
import { addressHostname, withInferredScheme } from "../connections/server-address";
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
import { FormKeyboardAvoidingView } from "./form-keyboard-avoiding-view";

type Diagnostic = {
  advertisedUrls: number;
  checkedAtMs: number;
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

type ConnectionTarget = {
  credential: ConnectionCredential | undefined;
  origin: string;
};

const httpNotAllowedMessage = "This address uses HTTP. Turn on Allow HTTP below or use https://.";

export function ConnectionScreen({ onDone, onPair }: { onDone?: () => void; onPair?: () => void }) {
  const connections = useConnections();
  const runtime = useConnectionRuntime();
  const { fontScale } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
  const profileLoadGeneration = useRef(0);
  const nameInput = useRef<TextInput>(null);
  const usernameInput = useRef<TextInput>(null);
  const secretInput = useRef<TextInput>(null);
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
  const secret = authMode === "basic" ? password : authMode === "bearer" ? token : "";
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
        setEditingProfileId(selected.id);
        setLoadedProfileId(selected.id);
        setName(selected.name);
        setOrigin(selected.baseUrl);
        setAuthMode(selected.authMode);
        setAllowHttp(selected.allowDevelopmentHttp);
        setUsername(credential?.mode === "basic" ? credential.username : "");
        setPassword(credential?.mode === "basic" ? credential.password : "");
        setToken(credential?.mode === "bearer" ? credential.token : "");
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
    setPassword(credential?.mode === "basic" ? credential.password : "");
    setToken(credential?.mode === "bearer" ? credential.token : "");
    setShowSecret(false);
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
    setPassword("");
    setToken("");
    setShowSecret(false);
    setAllowHttp(false);
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

  // Any edit makes earlier results describe a different connection.
  function edited<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      resetResults();
    };
  }

  function resolveTarget(): ConnectionTarget | undefined {
    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeOpenCodeBaseUrl(withInferredScheme(origin));
    } catch (caught) {
      setError(urlErrorMessage(caught));
      return undefined;
    }
    if (normalizedOrigin.startsWith("http:") && !allowHttp) {
      setError(httpNotAllowedMessage);
      return undefined;
    }
    if (Device.isDevice && isLoopbackHost(normalizedOrigin)) {
      setError(
        "localhost points to this phone. Use your computer's network address, Tailscale address, or hostname.",
      );
      return undefined;
    }
    const credential = credentialFromInput(authMode, username, secret);
    if (credential === "MISSING") {
      setError(authMode === "basic" ? "Enter a username and password." : "Enter a bearer token.");
      return undefined;
    }
    return { credential, origin: normalizedOrigin };
  }

  async function checkServer(target: ConnectionTarget): Promise<Diagnostic | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const client = createOpenCodeClient({
        baseUrl: target.origin,
        fetch: boundedOpenCodeFetch,
        ...(target.credential
          ? { authorization: connectionAuthorizationHeader(target.credential) }
          : {}),
      });
      const requestOptions = { signal: controller.signal };
      const [health, sessions] = await Promise.all([
        client.server.status(requestOptions),
        client.session.list({ limit: 1, order: "desc" }, requestOptions),
      ]);
      setOrigin(target.origin);
      return {
        advertisedUrls: health.urls.length,
        checkedAtMs: Date.now(),
        pid: health.pid,
        sessions: sessions.data.length,
        version: health.version,
      };
    } catch (caught) {
      setError(connectionErrorMessage(classifyOpenCodeError(caught)));
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function testConnection() {
    resetResults();
    const target = resolveTarget();
    if (!target) return;
    setBusy(true);
    try {
      setDiagnostic(await checkServer(target));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (actionsDisabled) return;
    resetResults();
    const target = resolveTarget();
    if (!target) return;

    setBusy(true);
    const checked = await checkServer(target);
    setBusy(false);
    if (!checked) return;

    setSaving(true);
    let saved = false;
    try {
      const id = await connections.save({
        ...(target.credential ? { credential: target.credential } : {}),
        draft: {
          allowDevelopmentHttp: allowHttp,
          authMode,
          baseUrl: target.origin,
          ...(editingProfileId ? { id: editingProfileId } : {}),
          name: name.trim() || new URL(target.origin).hostname.slice(0, 80),
        },
        health: {
          checkedAtMs: checked.checkedAtMs,
          pid: checked.pid,
          version: checked.version,
        },
      });
      setEditingProfileId(id);
      setLoadedProfileId(id);
      setNotice("Connected and saved.");
      saved = true;
    } catch (caught) {
      setError(profileErrorMessage(caught));
    } finally {
      setSaving(false);
    }
    if (saved) onDone?.();
  }

  function confirmRemoval(profile: ConnectionProfile) {
    Alert.alert(
      `Remove ${profile.name}?`,
      `This removes ${new URL(profile.baseUrl).host} and its saved credentials from this device.`,
      [
        { style: "cancel", text: "Cancel" },
        { onPress: () => void removeProfile(profile), style: "destructive", text: "Remove" },
      ],
    );
  }

  async function removeProfile(profile: ConnectionProfile) {
    setError(undefined);
    setNotice(undefined);
    try {
      await connections.remove(profile.id);
      if (editingProfileId === profile.id) newConnection();
      setNotice("Connection and credentials removed from this device.");
    } catch {
      setError("The connection could not be removed. Try again.");
    }
  }

  async function testEventStream() {
    setError(undefined);
    setStreamDiagnostic(undefined);
    const target = resolveTarget();
    if (!target) return;

    setStreamBusy(true);
    try {
      const client = createOpenCodeClient({
        baseUrl: target.origin,
        fetch: expoOpenCodeFetch,
        ...(target.credential
          ? { authorization: connectionAuthorizationHeader(target.credential) }
          : {}),
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
    const target = resolveTarget();
    if (!target) return;

    setPtyBusy(true);
    try {
      const client = createOpenCodeClient({
        baseUrl: target.origin,
        fetch: boundedOpenCodeFetch,
        ...(target.credential
          ? { authorization: connectionAuthorizationHeader(target.credential) }
          : {}),
      });
      setPtyDiagnostic(await probePtyTransport(client, target.origin));
    } catch (caught) {
      setError(ptyProbeErrorMessage(caught));
    } finally {
      setPtyBusy(false);
    }
  }

  async function testLifecycleRecovery() {
    setError(undefined);
    lifecycleProbe.reset();
    const target = resolveTarget();
    if (!target) return;

    const authorization = target.credential
      ? connectionAuthorizationHeader(target.credential)
      : undefined;
    const streamClient = createOpenCodeClient({
      baseUrl: target.origin,
      fetch: expoOpenCodeFetch,
      ...(authorization ? { authorization } : {}),
    });
    const restClient = createOpenCodeClient({
      baseUrl: target.origin,
      fetch: boundedOpenCodeFetch,
      ...(authorization ? { authorization } : {}),
    });
    try {
      await lifecycleProbe.run(streamClient, restClient);
    } catch (caught) {
      setError(eventProbeErrorMessage(caught));
    }
  }

  function focusAfterName() {
    if (authMode === "basic") usernameInput.current?.focus();
    else if (authMode === "bearer") secretInput.current?.focus();
    else void connect();
  }

  const editingProfile = connections.profiles.find((profile) => profile.id === editingProfileId);
  const actionsDisabled = saving || busy || streamBusy || ptyBusy || lifecycleBusy;
  const centeredTitle = Platform.OS === "ios";
  const firstRun = connections.ready && connections.profiles.length === 0;
  const showHero = firstRun && !showDetails;
  const usesHttp = withInferredScheme(origin).toLowerCase().startsWith("http:");
  const secretLabel = authMode === "basic" ? "Password" : "Token";

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        {centeredTitle ? <View style={styles.headerSide} /> : null}
        {showHero ? (
          <View style={styles.flex} />
        ) : (
          <Text
            accessibilityRole="header"
            dynamicTypeRamp={typeRamp.navTitle}
            style={[styles.title, centeredTitle ? styles.titleCentered : styles.titleLeading]}
          >
            Connections
          </Text>
        )}
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
      <FormKeyboardAvoidingView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {connections.error ? (
            <Text
              accessibilityRole="alert"
              dynamicTypeRamp={typeRamp.subheadline}
              style={[styles.message, styles.error]}
            >
              {connections.error}
            </Text>
          ) : null}

          {showHero ? (
            <View style={styles.firstRun}>
              <View style={styles.hero}>
                <View style={styles.heroIcon}>
                  <Feather accessible={false} color={palette.ink} name="camera" size={40} />
                </View>
                <Text
                  accessibilityRole="header"
                  dynamicTypeRamp={typeRamp.largeTitle}
                  style={styles.heroTitle}
                >
                  Connect to OpenCode
                </Text>
                <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.heroCopy}>
                  Run{" "}
                  <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.inlineCode}>
                    /pair
                  </Text>{" "}
                  in OpenCode on your computer, then scan the code it shows to connect. Credentials
                  are stored in the device keychain.
                </Text>
              </View>
              {onPair ? (
                <Button
                  fullWidth
                  icon="camera"
                  label="Scan pairing code"
                  onPress={onPair}
                  variant="primary"
                />
              ) : null}
              <Button fullWidth label="Enter address manually" onPress={newConnection} />
              <Text dynamicTypeRamp={typeRamp.footnote} style={styles.footer}>
                You can add more servers later in Settings.
              </Text>
            </View>
          ) : null}

          {firstRun ? null : (
            <SettingsGroup title="Saved servers">
              {!connections.ready ? (
                <View style={[styles.messageRow, styles.separator]}>
                  <ActivityIndicator color={palette.signal} />
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
                            HTTP allowed, not encrypted
                          </Text>
                        ) : null}
                      </View>
                      {selected ? (
                        <Feather accessible={false} color={palette.signal} name="check" size={18} />
                      ) : null}
                    </Pressable>
                    <Button
                      accessibilityLabel={`Edit ${profile.name}`}
                      align={largeText ? "start" : "center"}
                      label="Edit"
                      onPress={() => void editProfile(profile)}
                      size="compact"
                      style={largeText ? styles.profileActionLargeText : styles.profileAction}
                      variant="text"
                    />
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
                <MenuRow icon="camera" label="Scan pairing code" last onPress={onPair} />
              ) : null}
            </SettingsGroup>
          )}

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
                  <Button
                    accessibilityLabel="Hide connection details"
                    label="Hide"
                    onPress={() => setShowDetails(false)}
                    size="compact"
                    variant="text"
                  />
                </View>
                <View style={managementStyles.group}>
                  <Field label="Server address">
                    <TextInput
                      accessibilityLabel="Server address"
                      autoCapitalize="none"
                      autoComplete="url"
                      autoCorrect={false}
                      keyboardType="url"
                      keyboardAppearance="dark"
                      onChangeText={edited(setOrigin)}
                      onSubmitEditing={() => nameInput.current?.focus()}
                      placeholder="192.168.1.20:4096"
                      placeholderTextColor={palette.dim}
                      returnKeyType="next"
                      style={styles.input}
                      submitBehavior="submit"
                      textContentType="URL"
                      value={origin}
                    />
                  </Field>

                  {usesHttp || allowHttp ? (
                    <View
                      style={[
                        styles.switchRow,
                        styles.separator,
                        largeText && styles.switchRowLargeText,
                      ]}
                    >
                      <View style={styles.switchCopy}>
                        <Text dynamicTypeRamp={typeRamp.body} style={styles.rowTitle}>
                          Allow HTTP
                        </Text>
                        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.rowDescription}>
                          HTTP is not encrypted. Anyone on the network path can read your password
                          and sessions. Use it only on your own network or Tailscale.
                        </Text>
                      </View>
                      <Switch
                        {...switchColors}
                        accessibilityLabel="Allow HTTP"
                        onValueChange={edited(setAllowHttp)}
                        value={allowHttp}
                      />
                    </View>
                  ) : null}

                  <Field label="Name">
                    <TextInput
                      accessibilityLabel="Connection name"
                      keyboardAppearance="dark"
                      maxLength={80}
                      onChangeText={edited(setName)}
                      onSubmitEditing={focusAfterName}
                      placeholder={addressHostname(origin) || "My OpenCode server"}
                      placeholderTextColor={palette.dim}
                      ref={nameInput}
                      returnKeyType={authMode === "none" ? "go" : "next"}
                      style={styles.input}
                      submitBehavior={authMode === "none" ? "blurAndSubmit" : "submit"}
                      value={name}
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
                      onChange={edited(setAuthMode)}
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
                        autoComplete="username"
                        autoCorrect={false}
                        keyboardAppearance="dark"
                        onChangeText={edited(setUsername)}
                        onSubmitEditing={() => secretInput.current?.focus()}
                        ref={usernameInput}
                        returnKeyType="next"
                        style={styles.input}
                        submitBehavior="submit"
                        textContentType="username"
                        value={username}
                      />
                    </Field>
                  ) : null}

                  {authMode !== "none" ? (
                    <Field label={secretLabel} last>
                      <View style={styles.secretRow}>
                        <TextInput
                          accessibilityLabel={secretLabel}
                          autoCapitalize="none"
                          autoComplete={authMode === "basic" ? "current-password" : "off"}
                          autoCorrect={false}
                          keyboardAppearance="dark"
                          onChangeText={edited(authMode === "basic" ? setPassword : setToken)}
                          onSubmitEditing={() => void connect()}
                          ref={secretInput}
                          returnKeyType="go"
                          secureTextEntry={!showSecret}
                          style={[styles.input, styles.secretInput]}
                          textContentType={authMode === "basic" ? "password" : "none"}
                          value={secret}
                        />
                        <Pressable
                          accessibilityLabel={`${showSecret ? "Hide" : "Show"} ${secretLabel.toLowerCase()}`}
                          accessibilityRole="button"
                          android_ripple={Platform.OS === "android" ? borderlessRipple : undefined}
                          hitSlop={secretToggleHitSlop}
                          onPress={() => setShowSecret((visible) => !visible)}
                          style={({ pressed }) => [
                            styles.secretToggle,
                            pressed && Platform.OS === "ios" && styles.pressed,
                          ]}
                        >
                          <Feather
                            accessible={false}
                            color={palette.dim}
                            name={showSecret ? "eye-off" : "eye"}
                            size={20}
                          />
                        </Pressable>
                      </View>
                    </Field>
                  ) : null}
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

              <Button
                busy={busy || saving}
                disabled={actionsDisabled}
                fullWidth
                label={
                  busy
                    ? "Connecting…"
                    : saving
                      ? "Saving…"
                      : editingProfileId
                        ? "Save changes"
                        : "Connect"
                }
                onPress={() => void connect()}
                variant="primary"
              />

              <MenuGroup>
                <MenuRow
                  description="Diagnostics and transport probes"
                  expanded={showAdvanced}
                  icon="activity"
                  label="Advanced"
                  last
                  onPress={() => setShowAdvanced((visible) => !visible)}
                />
              </MenuGroup>

              {showAdvanced ? (
                <View style={styles.advanced}>
                  <Text dynamicTypeRamp={typeRamp.footnote} style={styles.helper}>
                    Physical devices need a LAN, Tailscale, tunnel, or remote address. iOS Simulator
                    can usually use the Mac's localhost. Android Emulator commonly uses 10.0.2.2 for
                    its host.
                  </Text>
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
                          Cached list: {runtime.cacheMetadata.projectCount} projects,{" "}
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

                  <Button
                    busy={busy}
                    disabled={actionsDisabled}
                    fullWidth
                    label={busy ? "Testing…" : "Test without saving"}
                    onPress={() => void testConnection()}
                  />

                  {diagnostic ? <DiagnosticCard diagnostic={diagnostic} /> : null}

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
                  ) : null}

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

                  <Text dynamicTypeRamp={typeRamp.footnote} style={styles.footer}>
                    Client contract {openCodeClientContractVersion} / Hermes native
                  </Text>
                </View>
              ) : null}

              {editingProfile ? (
                <Button
                  accessibilityLabel={`Remove ${editingProfile.name}`}
                  fullWidth
                  label="Remove server"
                  onPress={() => confirmRemoval(editingProfile)}
                  variant="danger"
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </FormKeyboardAvoidingView>
    </SafeAreaView>
  );
}

const ripple = { color: "rgba(255,255,255,0.12)" };
const borderlessRipple = { ...ripple, borderless: true };
const secretToggleHitSlop = { bottom: space.sm, top: space.sm };

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
  useAnnouncement(title);
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
  useAnnouncement(copy);

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
  const code = error instanceof Error ? error.message : undefined;
  if (code === "UNSUPPORTED_PROTOCOL") {
    return "Use an address that starts with http:// or https://.";
  }
  if (code === "EMBEDDED_CREDENTIALS") {
    return "Enter the username and password in their own fields, not in the address.";
  }
  if (code === "BASE_URL_MUST_BE_ORIGIN") {
    return "Enter only the server address and port, with nothing after them.";
  }
  return "Enter a server address, like 192.168.1.20:4096 or https://opencode.example.com.";
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
  error: { borderColor: palette.danger, color: palette.danger },
  fieldLabel: { ...typography.footnote, color: palette.dim },
  fieldRow: {
    gap: 2,
    justifyContent: "center",
    minHeight: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  firstRun: { gap: space.md, paddingTop: space.xl },
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
  hero: { alignItems: "center", gap: space.sm, marginBottom: space.md },
  heroCopy: { ...typography.subheadline, color: palette.dim, textAlign: "center" },
  heroIcon: {
    alignItems: "center",
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 88,
    justifyContent: "center",
    marginBottom: space.sm,
    width: 88,
  },
  heroTitle: { ...typography.largeTitle, color: palette.ink, textAlign: "center" },
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
  inlineCode: { color: palette.ink, fontFamily: typography.code.fontFamily },
  lifecycleCopy: { ...typography.subheadline, color: palette.dim },
  lifecyclePrompt: { borderColor: palette.warm },
  lifecycleTitle: { ...typography.sectionLabel, color: palette.warm },
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
  profileAction: { marginRight: space.xs },
  profileActionLargeText: { marginBottom: space.xs, marginHorizontal: space.xs },
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
  secretInput: { flex: 1 },
  secretRow: { alignItems: "center", flexDirection: "row", gap: space.xs },
  secretToggle: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 32,
    minWidth: minTouchTarget,
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
