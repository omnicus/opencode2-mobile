import Feather from "@expo/vector-icons/Feather";
import { openCodeClientContractVersion } from "@opencode2-mobile/opencode-adapter";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, type RefObject, useRef } from "react";
import {
  ActivityIndicator,
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
import type { ConnectionAuthMode, ConnectionProfile } from "../connections/connection-profile";
import { useConnections } from "../connections/connections-context";
import { addressHostname, withInferredScheme } from "../connections/server-address";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import {
  cardSurface,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  rippleColor,
  space,
  switchColors,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";
import type {
  LifecycleTransportPhase,
  LifecycleTransportResult,
} from "../use-lifecycle-transport-probe";
import {
  type ConnectionProbeActions,
  type ConnectionProfileActions,
  connectionProbeActions,
  connectionProfileActions,
} from "./connection-screen-actions";
import {
  connectButtonLabel,
  type Diagnostic,
  type PtyDiagnostic,
  runtimeStatusLabel,
  type StreamDiagnostic,
} from "./connection-screen-model";
import {
  type ConnectionScreenState,
  type Connections,
  useConnectionScreenState,
} from "./connection-screen-state";
import { FormKeyboardAvoidingView } from "./form-keyboard-avoiding-view";

type ConnectionRuntime = ReturnType<typeof useConnectionRuntime>;

export function ConnectionScreen({ onDone, onPair }: { onDone?: () => void; onPair?: () => void }) {
  const connections = useConnections();
  const runtime = useConnectionRuntime();
  const { fontScale } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
  const state = useConnectionScreenState(connections);
  const profileActions = connectionProfileActions(state, connections, onDone);
  const probeActions = connectionProbeActions(state);
  const firstRun = connections.ready && connections.profiles.length === 0;
  const showHero = firstRun && !state.showDetails;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <StatusBar style="light" />
      <ScreenHeader onDone={onDone} showHero={showHero} />
      <FormKeyboardAvoidingView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {connections.error ? <ErrorMessage>{connections.error}</ErrorMessage> : null}

          {showHero ? (
            <FirstRunHero onManual={profileActions.newConnection} onPair={onPair} />
          ) : null}

          {firstRun ? null : (
            <SavedServers
              connections={connections}
              largeText={largeText}
              onAdd={profileActions.newConnection}
              onEdit={(profile) => void profileActions.editProfile(profile)}
              onPair={onPair}
              onSelect={(profile) => void profileActions.selectProfile(profile)}
            />
          )}

          {state.notice && !state.showDetails ? (
            <NoticeMessage>{state.notice}</NoticeMessage>
          ) : null}
          {state.error && !state.showDetails ? <ErrorMessage>{state.error}</ErrorMessage> : null}

          {state.showDetails ? (
            <ConnectionDetails
              connections={connections}
              largeText={largeText}
              probeActions={probeActions}
              profileActions={profileActions}
              runtime={runtime}
              state={state}
            />
          ) : null}
        </ScrollView>
      </FormKeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ScreenHeader({
  onDone,
  showHero,
}: {
  onDone: (() => void) | undefined;
  showHero: boolean;
}) {
  const centeredTitle = Platform.OS === "ios";

  return (
    <View style={[styles.header, !showHero && styles.headerDivider]}>
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
  );
}

function FirstRunHero({
  onManual,
  onPair,
}: {
  onManual: () => void;
  onPair: (() => void) | undefined;
}) {
  return (
    <View style={styles.firstRun}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Feather accessible={false} color={palette.ink} name="monitor" size={40} />
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
          in OpenCode on your computer, then scan the code it shows to connect. Credentials stay in
          this device's secure storage.
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
      <Button fullWidth label="Enter address manually" onPress={onManual} />
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.footer}>
        You can add more servers later in Settings.
      </Text>
    </View>
  );
}

function SavedServers({
  connections,
  largeText,
  onAdd,
  onEdit,
  onPair,
  onSelect,
}: {
  connections: Connections;
  largeText: boolean;
  onAdd: () => void;
  onEdit: (profile: ConnectionProfile) => void;
  onPair: (() => void) | undefined;
  onSelect: (profile: ConnectionProfile) => void;
}) {
  return (
    <SettingsGroup title="Saved servers">
      {!connections.ready ? (
        <View style={[styles.messageRow, styles.separator]}>
          <ActivityIndicator color={palette.signal} />
        </View>
      ) : null}
      {connections.profiles.map((profile) => (
        <ProfileRow
          key={profile.id}
          largeText={largeText}
          onEdit={onEdit}
          onSelect={onSelect}
          profile={profile}
          selected={connections.selectedProfileId === profile.id}
        />
      ))}
      <MenuRow disclosure={false} icon="plus" label="Add server" last={!onPair} onPress={onAdd} />
      {onPair ? <MenuRow icon="camera" label="Scan pairing code" last onPress={onPair} /> : null}
    </SettingsGroup>
  );
}

function ProfileRow({
  largeText,
  onEdit,
  onSelect,
  profile,
  selected,
}: {
  largeText: boolean;
  onEdit: (profile: ConnectionProfile) => void;
  onSelect: (profile: ConnectionProfile) => void;
  profile: ConnectionProfile;
  selected: boolean;
}) {
  return (
    <View style={[styles.profileRow, styles.separator, largeText && styles.profileRowLargeText]}>
      <Pressable
        accessibilityLabel={`Select ${profile.name}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        android_ripple={Platform.OS === "android" ? ripple : undefined}
        onPress={() => onSelect(profile)}
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
        onPress={() => onEdit(profile)}
        size="compact"
        style={largeText ? styles.profileActionLargeText : styles.profileAction}
        variant="text"
      />
    </View>
  );
}

function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <Text
      accessibilityRole="alert"
      dynamicTypeRamp={typeRamp.subheadline}
      style={[styles.message, styles.error]}
    >
      {children}
    </Text>
  );
}

function NoticeMessage({ children }: { children: ReactNode }) {
  return (
    <Text
      accessibilityLiveRegion="polite"
      dynamicTypeRamp={typeRamp.subheadline}
      style={[styles.message, styles.notice]}
    >
      {children}
    </Text>
  );
}

function ConnectionDetails({
  connections,
  largeText,
  probeActions,
  profileActions,
  runtime,
  state,
}: {
  connections: Connections;
  largeText: boolean;
  probeActions: ConnectionProbeActions;
  profileActions: ConnectionProfileActions;
  runtime: ConnectionRuntime;
  state: ConnectionScreenState;
}) {
  const editingProfile = connections.profiles.find(
    (profile) => profile.id === state.editingProfileId,
  );

  return (
    <View style={styles.details}>
      <View style={styles.section}>
        <View style={styles.detailHeading}>
          <Text
            accessibilityRole="header"
            dynamicTypeRamp={typeRamp.sectionLabel}
            style={styles.sectionTitle}
          >
            {state.editingProfileId ? "Server details" : "New server"}
          </Text>
          <Button
            accessibilityLabel="Hide connection details"
            label="Hide"
            onPress={() => state.setShowDetails(false)}
            size="compact"
            variant="text"
          />
        </View>
        <ConnectionFields largeText={largeText} onConnect={profileActions.connect} state={state} />
      </View>

      {state.error ? <ErrorMessage>{state.error}</ErrorMessage> : null}
      {state.notice ? <NoticeMessage>{state.notice}</NoticeMessage> : null}

      <Button
        busy={state.busy || state.saving}
        disabled={state.actionsDisabled}
        fullWidth
        label={connectButtonLabel(state.busy, state.saving, state.editingProfileId)}
        onPress={() => void profileActions.connect()}
        variant="primary"
      />

      <MenuGroup>
        <MenuRow
          description="Diagnostics and transport probes"
          expanded={state.showAdvanced}
          icon="activity"
          label="Advanced"
          last
          onPress={() => state.setShowAdvanced((visible) => !visible)}
        />
      </MenuGroup>

      {state.showAdvanced ? (
        <AdvancedProbes probeActions={probeActions} runtime={runtime} state={state} />
      ) : null}

      {editingProfile ? (
        <Button
          accessibilityLabel={`Remove ${editingProfile.name}`}
          fullWidth
          label="Remove server"
          onPress={() => profileActions.confirmRemoval(editingProfile)}
          variant="danger"
        />
      ) : null}
    </View>
  );
}

function ConnectionFields({
  largeText,
  onConnect,
  state,
}: {
  largeText: boolean;
  onConnect: () => Promise<void>;
  state: ConnectionScreenState;
}) {
  const nameInput = useRef<TextInput>(null);
  const usernameInput = useRef<TextInput>(null);
  const secretInput = useRef<TextInput>(null);
  const { allowHttp, authMode, origin } = state.values;
  const usesHttp = withInferredScheme(origin).toLowerCase().startsWith("http:");

  function focusAfterName() {
    if (authMode === "basic") usernameInput.current?.focus();
    else if (authMode === "bearer") secretInput.current?.focus();
    else void onConnect();
  }

  return (
    <View style={managementStyles.group}>
      <Field label="Server address">
        <TextInput
          accessibilityLabel="Server address"
          autoCapitalize="none"
          autoComplete="url"
          autoCorrect={false}
          keyboardType="url"
          keyboardAppearance="dark"
          onChangeText={state.edited(state.setOrigin)}
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

      {usesHttp || allowHttp ? <AllowHttpRow largeText={largeText} state={state} /> : null}

      <Field label="Name">
        <TextInput
          accessibilityLabel="Connection name"
          keyboardAppearance="dark"
          maxLength={80}
          onChangeText={state.edited(state.setName)}
          onSubmitEditing={focusAfterName}
          placeholder={addressHostname(origin) || "My OpenCode server"}
          placeholderTextColor={palette.dim}
          ref={nameInput}
          returnKeyType={authMode === "none" ? "go" : "next"}
          style={styles.input}
          submitBehavior={authMode === "none" ? "blurAndSubmit" : "submit"}
          value={state.values.name}
        />
      </Field>

      <View style={[styles.fieldRow, styles.segmentRow, authMode !== "none" && styles.separator]}>
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
          onChange={state.edited(state.setAuthMode)}
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
            onChangeText={state.edited(state.setUsername)}
            onSubmitEditing={() => secretInput.current?.focus()}
            ref={usernameInput}
            returnKeyType="next"
            style={styles.input}
            submitBehavior="submit"
            textContentType="username"
            value={state.values.username}
          />
        </Field>
      ) : null}

      {authMode !== "none" ? (
        <SecretField inputRef={secretInput} onConnect={onConnect} state={state} />
      ) : null}
    </View>
  );
}

function AllowHttpRow({ largeText, state }: { largeText: boolean; state: ConnectionScreenState }) {
  return (
    <View style={[styles.switchRow, styles.separator, largeText && styles.switchRowLargeText]}>
      <View style={styles.switchCopy}>
        <Text dynamicTypeRamp={typeRamp.body} style={styles.rowTitle}>
          Allow HTTP
        </Text>
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.rowDescription}>
          HTTP is not encrypted. Anyone on the network path can read your password and sessions. Use
          it only on your own network or Tailscale.
        </Text>
      </View>
      <Switch
        {...switchColors}
        accessibilityLabel="Allow HTTP"
        onValueChange={state.edited(state.setAllowHttp)}
        value={state.values.allowHttp}
      />
    </View>
  );
}

function SecretField({
  inputRef,
  onConnect,
  state,
}: {
  inputRef: RefObject<TextInput | null>;
  onConnect: () => Promise<void>;
  state: ConnectionScreenState;
}) {
  const basic = state.values.authMode === "basic";
  const secretLabel = basic ? "Password" : "Token";

  return (
    <Field label={secretLabel} last>
      <View style={styles.secretRow}>
        <TextInput
          accessibilityLabel={secretLabel}
          autoCapitalize="none"
          autoComplete={basic ? "current-password" : "off"}
          autoCorrect={false}
          keyboardAppearance="dark"
          onChangeText={state.edited(basic ? state.setPassword : state.setToken)}
          onSubmitEditing={() => void onConnect()}
          ref={inputRef}
          returnKeyType="go"
          secureTextEntry={!state.showSecret}
          style={[styles.input, styles.secretInput]}
          textContentType={basic ? "password" : "none"}
          value={state.secret}
        />
        <Pressable
          accessibilityLabel={`${state.showSecret ? "Hide" : "Show"} ${secretLabel.toLowerCase()}`}
          accessibilityRole="button"
          android_ripple={Platform.OS === "android" ? borderlessRipple : undefined}
          hitSlop={secretToggleHitSlop}
          onPress={() => state.setShowSecret((visible) => !visible)}
          style={({ pressed }) => [
            styles.secretToggle,
            pressed && Platform.OS === "ios" && styles.pressed,
          ]}
        >
          <Feather
            accessible={false}
            color={palette.dim}
            name={state.showSecret ? "eye-off" : "eye"}
            size={20}
          />
        </Pressable>
      </View>
    </Field>
  );
}

function AdvancedProbes({
  probeActions,
  runtime,
  state,
}: {
  probeActions: ConnectionProbeActions;
  runtime: ConnectionRuntime;
  state: ConnectionScreenState;
}) {
  const { actionsDisabled, diagnostic, lifecycleBusy, lifecycleProbe, ptyDiagnostic } = state;
  const { streamDiagnostic } = state;

  return (
    <View style={styles.advanced}>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.helper}>
        Physical devices need a LAN, Tailscale, tunnel, or remote address. iOS Simulator can usually
        use the Mac's localhost. Android Emulator commonly uses 10.0.2.2 for its host.
      </Text>
      {runtime.status !== "idle" ? <RuntimeStatusCard runtime={runtime} state={state} /> : null}

      <Button
        busy={state.busy}
        disabled={actionsDisabled}
        fullWidth
        label={state.busy ? "Testing…" : "Test without saving"}
        onPress={() => void probeActions.testConnection()}
      />

      {diagnostic ? <DiagnosticCard diagnostic={diagnostic} /> : null}

      {diagnostic ? (
        <Button
          busy={state.streamBusy}
          disabled={actionsDisabled}
          fullWidth
          label={state.streamBusy ? "Probing event stream…" : "Run event and cancellation probe"}
          onPress={() => void probeActions.testEventStream()}
        />
      ) : null}

      {streamDiagnostic ? <StreamDiagnosticCard diagnostic={streamDiagnostic} /> : null}

      {streamDiagnostic ? (
        <Button
          busy={state.ptyBusy}
          disabled={actionsDisabled}
          fullWidth
          label={state.ptyBusy ? "Probing PTY transport…" : "Run PTY WebSocket probe"}
          onPress={() => void probeActions.testPtyTransport()}
        />
      ) : null}

      {ptyDiagnostic ? <PtyDiagnosticCard diagnostic={ptyDiagnostic} /> : null}

      {ptyDiagnostic ? (
        <Button
          busy={lifecycleBusy}
          disabled={actionsDisabled}
          fullWidth
          label={lifecycleBusy ? "Lifecycle probe running…" : "Run background and reconnect probe"}
          onPress={() => void probeActions.testLifecycleRecovery()}
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
  );
}

function RuntimeStatusCard({
  runtime,
  state,
}: {
  runtime: ConnectionRuntime;
  state: ConnectionScreenState;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.runtimeStatus}>
      <View style={styles.resultHeading}>
        <View
          style={[styles.runtimeDot, runtime.status === "connected" && styles.runtimeDotConnected]}
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
      {runtime.serverVersion && runtime.serverVersion !== openCodeClientContractVersion ? (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.runtimeCopy}>
          Server {runtime.serverVersion} passed checks against client contract{" "}
          {openCodeClientContractVersion}.
        </Text>
      ) : null}
      <View style={styles.runtimeActions}>
        <Button
          label={state.showRuntimeDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
          onPress={() => {
            if (!state.showRuntimeDiagnostics) {
              state.setRuntimeDiagnosticsText(runtime.getDiagnosticsText());
            }
            state.setShowRuntimeDiagnostics((visible) => !visible);
          }}
          size="compact"
        />
        <Button
          label="Share redacted report"
          onPress={() =>
            void Share.share({ message: runtime.getDiagnosticsText() }).catch(() =>
              state.setError("Diagnostics could not be shared."),
            )
          }
          size="compact"
        />
      </View>
      {state.showRuntimeDiagnostics ? (
        <Text dynamicTypeRamp={typeRamp.footnote} selectable style={styles.diagnosticsText}>
          {state.runtimeDiagnosticsText}
        </Text>
      ) : null}
    </View>
  );
}

const ripple = { color: rippleColor };
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
  segmentRow: { gap: space.xs },
  flex: { flex: 1 },
  footer: {
    ...typography.footnote,
    color: palette.dim,
    textAlign: "center",
  },
  // Same height and divider as the other modal headers (ModalSheet, Pairing, New session).
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 64,
    paddingHorizontal: space.md,
  },
  headerDivider: {
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
