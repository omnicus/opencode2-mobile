import Feather from "@expo/vector-icons/Feather";
import type { NotificationDeliveryState } from "@opencode2-mobile/notification-protocol";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ModalSheet } from "../components/modal-sheet";
import { useConnections } from "../connections/connections-context";
import type { RootStackParamList } from "../navigation/root-navigation";
import { sendNotificationDeviceCommand } from "../notifications/notification-client";
import {
  getNotificationPairingByConnectionID,
  type NotificationPairing,
  readNotificationPairingSecret,
} from "../notifications/notification-pairing-repository";
import { useAppLock } from "../security/app-lock-context";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import type { ConnectionTransportStatus } from "../state/connection-transport-coordinator";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { palette, radius, space, typeRamp, usesLargeTextLayout } from "../theme";
import { FormRequestList } from "./form-request-list";
import { permissionActionExplanation } from "./permission-presentation";
import { sanitizeTranscriptText } from "./session-transcript-model";

type Section = "Pending" | "Settings" | "Workspace";
type SessionBranch = {
  name?: string;
  stale?: boolean;
  state: "known" | "loading" | "none" | "unavailable";
};
type ScreenProps<RouteName extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  RouteName
>;

const tabletBreakpoint = 760;

export function PendingInteractionsScreen({ navigation }: ScreenProps<"Pending">) {
  const runtime = useConnectionRuntime();
  const selection = useWorkspaceSelection();
  const { width } = useWindowDimensions();
  const tablet = isTabletShell(width);
  const failedLocationCount = selection.attentionCoverage.failedLocationCount;
  const failedProjectSummary = (selection.attentionCoverage.failedProjects ?? [])
    .map((project) => project.label)
    .join(", ");
  const allKnownLocationsFailed =
    selection.attentionCoverage.knownLocationCount > 0 &&
    selection.attentionCoverage.reconciledLocationCount === 0;
  const navigate = (section: Section) =>
    section === "Workspace" ? navigation.popTo("Workspace") : navigation.navigate(section);
  return (
    <ShellFrame active="Pending" navigate={navigate}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {tablet ? (
          <>
            <Text style={styles.eyebrow}>PENDING WORK</Text>
            <Text accessibilityRole="header" style={styles.title}>
              Requests that need you.
            </Text>
            <Text style={styles.lede}>Approvals and forms from followed projects appear here.</Text>
          </>
        ) : null}
        {selection.preferencesLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator
              accessibilityLabel="Loading followed projects"
              color={palette.signal}
            />
            <Text style={styles.cardTitle}>Loading followed projects</Text>
          </View>
        ) : selection.followedProjectIds.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyMark}>UNAVAILABLE</Text>
            <Text style={styles.cardTitle}>Follow a project to reconcile pending work.</Text>
          </View>
        ) : selection.interactionsLoading && selection.pendingCount === 0 ? (
          <View style={styles.stateCard}>
            <ActivityIndicator accessibilityLabel="Loading pending work" color={palette.signal} />
            <Text style={styles.cardTitle}>Reconciling pending work</Text>
          </View>
        ) : selection.interactionsError && selection.pendingCount === 0 ? (
          <View
            accessibilityRole="alert"
            style={allKnownLocationsFailed ? styles.failureCard : styles.cacheCard}
          >
            <Text style={styles.cardLabel}>
              {allKnownLocationsFailed ? "UNAVAILABLE" : "PARTIAL"}
            </Text>
            <Text style={styles.cardTitle}>
              {allKnownLocationsFailed
                ? "Pending requests could not be checked."
                : locationFailureTitle(failedLocationCount)}
            </Text>
            <Text style={styles.cardCopy}>
              {failedProjectSummary
                ? `Affected ${selection.attentionCoverage.failedProjects.length === 1 ? "project" : "projects"}: ${failedProjectSummary}. `
                : "The affected project could not be identified. "}
              {allKnownLocationsFailed
                ? "The server returned errors for every known location."
                : `No requests were found at the ${selection.attentionCoverage.reconciledLocationCount} ${selection.attentionCoverage.reconciledLocationCount === 1 ? "location" : "locations"} that responded.`}
            </Text>
            <View style={styles.stateActions}>
              <ActionButton
                label="Retry"
                onPress={async () => {
                  await selection.refetch();
                }}
              />
              {runtime.status !== "connected" ? (
                <ActionButton
                  label="Connections"
                  onPress={() => navigation.navigate("Connections")}
                  secondary
                />
              ) : null}
            </View>
          </View>
        ) : (
          <>
            {selection.interactionsError ? (
              <View accessibilityRole="alert" style={styles.cacheCard}>
                <Text style={styles.cardLabel}>PARTIAL</Text>
                <Text style={styles.cardTitle}>{locationFailureTitle(failedLocationCount)}</Text>
                <Text style={styles.cardCopy}>
                  {failedProjectSummary
                    ? `Affected ${selection.attentionCoverage.failedProjects.length === 1 ? "project" : "projects"}: ${failedProjectSummary}. `
                    : "The affected project could not be identified. "}
                  Showing requests found at the other locations.
                </Text>
                <ActionButton
                  label="Retry"
                  onPress={async () => {
                    await selection.refetch();
                  }}
                  secondary
                />
              </View>
            ) : null}
            <View style={styles.emptyCard}>
              <Text style={styles.emptyMark}>{selection.pendingCount}</Text>
              <Text style={styles.cardTitle}>
                {selection.attentionCoverage.completeness === "complete"
                  ? selection.pendingCount === 1
                    ? "Pending request"
                    : "Pending requests"
                  : selection.pendingCount === 1
                    ? "Known pending request"
                    : "Known pending requests"}
              </Text>
              <Text style={styles.cardCopy}>
                {pendingCoverageLabel(selection.attentionCoverage)}
              </Text>
            </View>
            {selection.permissions.map((request) => (
              <View key={`permission:${request.id}`} style={styles.actionCard}>
                <Text style={styles.cardLabel}>PERMISSION</Text>
                <Text style={styles.cardTitle}>{sanitizeTranscriptText(request.action, 256)}</Text>
                {request.resources.map((resource) => (
                  <Text key={resource} selectable style={styles.permissionResource}>
                    {sanitizeTranscriptText(resource, 1_024)}
                  </Text>
                ))}
                {request.save?.map((pattern) => (
                  <Text key={pattern} selectable style={styles.permissionResource}>
                    Save pattern: {sanitizeTranscriptText(pattern, 1_024)}
                  </Text>
                ))}
                {permissionActionExplanation(request.action) ? (
                  <View style={styles.clientExplanation}>
                    <Text style={styles.clientExplanationLabel}>OPENCODE MOBILE EXPLANATION</Text>
                    <Text style={styles.cardCopy}>
                      {permissionActionExplanation(request.action)}
                    </Text>
                  </View>
                ) : null}
                <Text style={styles.permissionWarning}>
                  {request.save && request.save.length > 0
                    ? `Always allow may save ${request.save.length} broader permission${request.save.length === 1 ? "" : "s"}. `
                    : ""}
                  Reject may also reject other pending permission requests in this session.
                </Text>
                {selection.permissionReplyError ? (
                  <Text accessibilityRole="alert" style={styles.permissionError}>
                    The permission reply was not accepted. The request has been reloaded.
                  </Text>
                ) : null}
                <View style={styles.permissionActions}>
                  <ActionButton
                    disabled={selection.replyingPermissionId === request.id}
                    label={
                      selection.replyingPermissionId === request.id ? "Replying" : "Allow once"
                    }
                    onPress={() => selection.replyPermission(request.id, request.sessionID, "once")}
                  />
                  <ActionButton
                    disabled={selection.replyingPermissionId === request.id}
                    label="Always allow"
                    onPress={() =>
                      selection.replyPermission(request.id, request.sessionID, "always")
                    }
                    secondary
                  />
                  <ActionButton
                    disabled={selection.replyingPermissionId === request.id}
                    label="Reject"
                    onPress={() =>
                      selection.replyPermission(request.id, request.sessionID, "reject")
                    }
                    secondary
                  />
                </View>
              </View>
            ))}
            {selection.forms.length > 0 ? (
              <FormRequestList
                client={runtime.restClient}
                connectionId={runtime.connectionId}
                formLocations={selection.formLocations}
                forms={selection.forms}
                location={undefined}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </ShellFrame>
  );
}

export function SettingsScreen({ navigation }: ScreenProps<"Settings">) {
  const db = useSQLiteContext();
  const appLock = useAppLock();
  const runtime = useConnectionRuntime();
  const connections = useConnections();
  const selected = connections.profiles.find(
    (profile) => profile.id === connections.selectedProfileId,
  );
  const [notificationPairing, setNotificationPairing] = useState<NotificationPairing>();
  const [notificationState, setNotificationState] = useState<NotificationDeliveryState>();
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState(false);
  const navigate = (section: Section) =>
    section === "Workspace" ? navigation.popTo("Workspace") : navigation.navigate(section);

  async function shareDiagnostics() {
    await Share.share({ message: runtime.getDiagnosticsText() });
  }

  useEffect(() => {
    let active = true;
    async function refresh() {
      setNotificationLoading(true);
      setNotificationError(false);
      try {
        const pairing = connections.selectedProfileId
          ? await getNotificationPairingByConnectionID(db, connections.selectedProfileId)
          : undefined;
        if (!active) return;
        setNotificationPairing(pairing);
        if (!pairing) {
          setNotificationState(undefined);
          return;
        }
        const secret = await readNotificationPairingSecret(pairing);
        const state = await sendNotificationDeviceCommand({
          bindingID: pairing.bindingID,
          brokerOrigin: pairing.brokerOrigin,
          deviceKey: secret.deviceKey,
          operation: "status",
        });
        if (active) setNotificationState(state);
      } catch {
        if (active) {
          setNotificationState(undefined);
          setNotificationError(true);
        }
      } finally {
        if (active) setNotificationLoading(false);
      }
    }
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [connections.selectedProfileId, db]);

  async function setNotificationsEnabled(enabled: boolean) {
    if (!notificationPairing) return;
    setNotificationBusy(true);
    setNotificationError(false);
    try {
      const secret = await readNotificationPairingSecret(notificationPairing);
      const state = await sendNotificationDeviceCommand({
        bindingID: notificationPairing.bindingID,
        brokerOrigin: notificationPairing.brokerOrigin,
        deviceKey: secret.deviceKey,
        operation: enabled ? "enable" : "pause",
      });
      setNotificationState(state);
    } catch {
      setNotificationError(true);
    } finally {
      setNotificationBusy(false);
    }
  }

  return (
    <ShellFrame active="Settings" navigate={navigate}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.eyebrow}>SETTINGS</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Device and connection controls.
        </Text>

        <View style={styles.settingCard}>
          <View style={styles.settingText}>
            <Text style={styles.cardTitle}>App lock</Text>
            <Text style={styles.cardCopy}>
              Require device authentication after the app leaves the foreground.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Require device authentication"
            disabled={appLock.busy}
            onValueChange={(enabled) => void appLock.setEnabled(enabled)}
            thumbColor={appLock.enabled ? palette.signal : palette.dim}
            trackColor={{ false: palette.border, true: palette.signalDark }}
            value={appLock.enabled}
          />
        </View>
        {appLock.error ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {appLock.error}
          </Text>
        ) : null}

        <View style={styles.settingCard}>
          <View style={styles.settingText}>
            <Text style={styles.cardTitle}>Mobile notifications</Text>
            <Text style={styles.cardCopy}>
              {notificationLoading
                ? "Reading the shared broker setting."
                : !notificationPairing
                  ? "Pair this connection for notifications before enabling delivery."
                  : notificationState?.enabled
                    ? "Enabled for every phone paired with this notification broker."
                    : notificationState
                      ? "Paused. New requests will not create mobile notifications."
                      : "The shared broker setting is unavailable."}
            </Text>
          </View>
          {notificationLoading ? (
            <ActivityIndicator
              accessibilityLabel="Loading mobile notification setting"
              color={palette.signal}
            />
          ) : (
            <Switch
              accessibilityLabel="Send mobile notifications"
              disabled={!notificationPairing || !notificationState || notificationBusy}
              onValueChange={(enabled) => void setNotificationsEnabled(enabled)}
              thumbColor={notificationState?.enabled ? palette.signal : palette.dim}
              trackColor={{ false: palette.border, true: palette.signalDark }}
              value={notificationState?.enabled ?? false}
            />
          )}
        </View>
        {notificationError ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            The notification broker setting could not be read or updated.
          </Text>
        ) : null}

        <View style={styles.actionCard}>
          <Text style={styles.cardLabel}>SESSION INBOX</Text>
          <Text style={styles.cardTitle}>Followed projects</Text>
          <Text style={styles.cardCopy}>
            Choose which server projects are merged into Sessions and attention reconciliation.
          </Text>
          <ActionButton
            label="MANAGE FOLLOWED PROJECTS"
            onPress={() => navigation.navigate("FollowedProjects")}
          />
        </View>

        <View style={styles.actionCard}>
          <Text style={styles.cardLabel}>SELECTED CONNECTION</Text>
          <Text style={styles.cardTitle}>{selected?.name ?? "No connection selected"}</Text>
          <Text style={styles.cardCopy}>
            {selected?.baseUrl ?? "Choose a saved server profile."}
          </Text>
          <ActionButton
            label="MANAGE CONNECTIONS"
            onPress={() => navigation.navigate("Connections")}
          />
        </View>

        <View style={styles.actionCard}>
          <Text style={styles.cardLabel}>SUPPORT</Text>
          <Text style={styles.cardTitle}>Redacted transport and transcript report</Text>
          <Text style={styles.cardCopy}>
            Includes status transitions, event types, and numeric transcript performance counters.
            It excludes credentials, server addresses, paths, titles, prompts, and content.
          </Text>
          <ActionButton
            label="SHARE DIAGNOSTICS"
            onPress={() => void shareDiagnostics()}
            secondary
          />
        </View>
      </ScrollView>
    </ShellFrame>
  );
}

export function ConnectionStorageLoadingScreen() {
  return (
    <SafeAreaView style={styles.centeredState}>
      <StatusBar style="light" />
      <ActivityIndicator accessibilityLabel="Loading saved connections" color={palette.signal} />
      <Text accessibilityRole="header" style={styles.stateTitle}>
        Opening the local shell
      </Text>
      <Text style={styles.stateCopy}>
        Reading non-secret profiles and secure credential references.
      </Text>
    </SafeAreaView>
  );
}

export function ConnectionStorageFailureScreen() {
  const connections = useConnections();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    await connections.reload();
    setRetrying(false);
  }

  return (
    <SafeAreaView style={styles.centeredState}>
      <StatusBar style="light" />
      <Text style={styles.errorEyebrow}>LOCAL STORAGE FAILURE</Text>
      <Text accessibilityRole="header" style={styles.stateTitle}>
        Saved connections are unavailable.
      </Text>
      <Text accessibilityRole="alert" style={styles.stateCopy}>
        {connections.error}
      </Text>
      <ActionButton disabled={retrying} label={retrying ? "RETRYING" : "RETRY"} onPress={retry} />
    </SafeAreaView>
  );
}

export function isTabletShell(width: number) {
  return width >= tabletBreakpoint;
}

export function getConnectionPresentation(
  status: ConnectionTransportStatus,
  reconnectAttempt: number,
) {
  if (status === "connected") return { color: palette.signal, label: "LIVE" };
  if (status === "connecting") return { color: palette.warm, label: "CONNECTING" };
  if (status === "reconnecting") {
    return { color: palette.warm, label: `RECONNECTING ${reconnectAttempt}` };
  }
  if (status === "stale") return { color: palette.warm, label: "STALE" };
  if (status === "offline") return { color: palette.dim, label: "OFFLINE" };
  if (status === "unauthorized") return { color: palette.danger, label: "AUTH BLOCKED" };
  if (status === "incompatible") return { color: palette.danger, label: "INCOMPATIBLE" };
  return { color: palette.dim, label: "NO CONNECTION" };
}

export function getWorkspaceState(status: ConnectionTransportStatus, hasCache: boolean) {
  if (status === "connected") return "empty" as const;
  if ((status === "reconnecting" || status === "stale" || status === "offline") && hasCache) {
    return "partial-cache" as const;
  }
  if (status === "connecting" || status === "reconnecting") return "loading" as const;
  if (status === "incompatible") return "incompatible" as const;
  return "failure" as const;
}

export function ShellFrame({
  active,
  branch,
  children,
  hideConnectionBar,
  navigate,
}: {
  active: Section;
  branch?: SessionBranch;
  children?: ReactNode;
  hideConnectionBar?: boolean;
  navigate: (screen: Section) => void;
}) {
  const { fontScale, width } = useWindowDimensions();
  const tablet = isTabletShell(width);
  const largeText = usesLargeTextLayout(fontScale);
  const runtime = useConnectionRuntime();
  const workspaceSelection = useWorkspaceSelection();
  const connections = useConnections();
  const selected = connections.profiles.find(
    (profile) => profile.id === connections.selectedProfileId,
  );
  const connection = getConnectionPresentation(runtime.status, runtime.reconnectAttempt);
  const [openDetail, setOpenDetail] = useState<"branch" | "server">();
  const [copyState, setCopyState] = useState<"copied" | "error" | "idle">("idle");
  const serverName = selected?.name ?? "No server selected";
  const detailName = openDetail === "branch" ? branch?.name : serverName;

  function showDetail(detail: "branch" | "server") {
    setCopyState("idle");
    setOpenDetail(detail);
  }

  async function copyDetail() {
    if (!detailName) return;
    try {
      await Clipboard.setStringAsync(detailName);
      setCopyState("copied");
      AccessibilityInfo.announceForAccessibility(
        openDetail === "branch" ? "Branch name copied" : "Server name copied",
      );
    } catch {
      setCopyState("error");
      AccessibilityInfo.announceForAccessibility(
        openDetail === "branch"
          ? "Branch name could not be copied"
          : "Server name could not be copied",
      );
    }
  }

  return (
    <SafeAreaView edges={tablet ? ["top", "bottom"] : ["bottom"]} style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={[styles.shell, tablet && styles.tabletShell]}>
        {tablet ? (
          <View accessibilityLabel="Primary navigation" style={styles.rail}>
            <View>
              <Text style={styles.brand}>OpenCode</Text>
              <Text numberOfLines={2} style={styles.railConnection}>
                {selected?.name ?? "NO SERVER"}
              </Text>
            </View>
            <View style={styles.railNavigation}>
              <NavigationItem
                active={active === "Workspace"}
                label="Sessions"
                largeText={largeText}
                onPress={() => navigate("Workspace")}
              />
              <NavigationItem
                active={active === "Pending"}
                label={pendingLabel(
                  workspaceSelection.pendingCount,
                  workspaceSelection.attentionCoverage.completeness === "complete",
                )}
                largeText={largeText}
                onPress={() => navigate("Pending")}
              />
              <NavigationItem
                active={active === "Settings"}
                label="Settings"
                largeText={largeText}
                onPress={() => navigate("Settings")}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigate("Settings")}
              style={styles.railFooter}
            >
              <View style={[styles.statusDot, { backgroundColor: connection.color }]} />
              <Text numberOfLines={1} style={styles.railStatus}>
                {connection.label}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.main}>
          {!hideConnectionBar ? (
            <View
              accessibilityLiveRegion="polite"
              style={[styles.connectionBar, largeText && styles.connectionBarLargeText]}
            >
              <View style={styles.connectionState}>
                <View style={[styles.statusDot, { backgroundColor: connection.color }]} />
                <Text dynamicTypeRamp={typeRamp.caption} style={styles.connectionStatus}>
                  {connection.label}
                </Text>
              </View>
              {branch ? (
                branch.state === "known" && branch.name ? (
                  <Pressable
                    accessibilityHint="Opens details where you can copy the full branch name"
                    accessibilityLabel={`Current branch, ${branch.name}${branch.stale ? ", may be outdated" : ""}`}
                    accessibilityRole="button"
                    onPress={() => showDetail("branch")}
                    style={({ pressed }) => [
                      styles.branchControl,
                      largeText && styles.branchControlLargeText,
                      pressed && styles.branchControlPressed,
                    ]}
                  >
                    <Feather
                      accessibilityElementsHidden
                      color={palette.dim}
                      importantForAccessibility="no-hide-descendants"
                      name="git-branch"
                      size={14}
                    />
                    <Text
                      dynamicTypeRamp={typeRamp.subheading}
                      ellipsizeMode="middle"
                      numberOfLines={1}
                      style={styles.branchName}
                    >
                      {branch.name}
                    </Text>
                  </Pressable>
                ) : (
                  <View style={[styles.branchControl, largeText && styles.branchControlLargeText]}>
                    <Feather
                      accessibilityElementsHidden
                      color={palette.dim}
                      importantForAccessibility="no-hide-descendants"
                      name="git-branch"
                      size={14}
                    />
                    <Text dynamicTypeRamp={typeRamp.subheading} style={styles.branchName}>
                      {branch.state === "loading"
                        ? "Checking branch"
                        : branch.state === "none"
                          ? "No branch"
                          : "Branch unavailable"}
                    </Text>
                  </View>
                )
              ) : null}
              <Pressable
                accessibilityHint="Opens the full server name"
                accessibilityLabel={`Server, ${serverName}`}
                accessibilityRole="button"
                onPress={() => showDetail("server")}
                style={({ pressed }) => [
                  styles.connectionNameControl,
                  branch && styles.connectionNameControlWithBranch,
                  largeText && styles.connectionNameControlLargeText,
                  pressed && styles.branchControlPressed,
                ]}
              >
                <Text
                  dynamicTypeRamp={typeRamp.subheading}
                  numberOfLines={largeText ? undefined : 1}
                  style={[styles.connectionName, largeText && styles.connectionNameLargeText]}
                >
                  {serverName}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.content}>{children}</View>
        </View>
      </View>
      <ModalSheet
        onClose={() => {
          setOpenDetail(undefined);
          setCopyState("idle");
        }}
        title={openDetail === "branch" ? "Current branch" : "Server name"}
        visible={Boolean(openDetail && detailName)}
      >
        <Text selectable style={styles.branchDetailName}>
          {detailName}
        </Text>
        {openDetail === "branch" && branch?.stale ? (
          <Text accessibilityRole="alert" style={styles.branchDetailNote}>
            This branch may be outdated while the server reconnects.
          </Text>
        ) : null}
        <ActionButton
          label={
            copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Try copying again"
                : openDetail === "branch"
                  ? "Copy branch name"
                  : "Copy server name"
          }
          onPress={copyDetail}
        />
      </ModalSheet>
    </SafeAreaView>
  );
}

function pendingLabel(count: number | undefined, complete: boolean) {
  if (!complete) return count && count > 0 ? `Pending ${count}+` : "Pending, syncing";
  return count && count > 0 ? `Pending ${count}` : "Pending";
}

function pendingCoverageLabel(
  coverage: ReturnType<typeof useWorkspaceSelection>["attentionCoverage"],
) {
  if (coverage.freshness === "stale") {
    return `Last checked across ${coverage.knownLocationCount} locations.`;
  }
  if (coverage.freshness === "reconciling") {
    return `Checking ${coverage.reconciledLocationCount} of ${coverage.knownLocationCount} locations.`;
  }
  return coverage.completeness === "complete"
    ? `Checked ${coverage.reconciledLocationCount} locations.`
    : `Checked ${coverage.reconciledLocationCount} of ${coverage.knownLocationCount} locations.`;
}

function locationFailureTitle(count: number) {
  return `${count} ${count === 1 ? "location" : "locations"} could not be checked.`;
}

function NavigationItem({
  active,
  label,
  largeText,
  onPress,
}: {
  active: boolean;
  label: string;
  largeText: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navigationItem,
        largeText && styles.navigationItemLargeText,
        active && styles.navigationItemActive,
        pressed && styles.navigationItemPressed,
      ]}
    >
      <Text
        dynamicTypeRamp={typeRamp.control}
        numberOfLines={1}
        style={[styles.navigationLabel, active && styles.navigationLabelActive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function WorkspaceStateCard({ state }: { state: ReturnType<typeof getWorkspaceState> }) {
  if (state === "loading") {
    return (
      <View accessibilityLiveRegion="polite" style={styles.stateCard}>
        <ActivityIndicator color={palette.warm} />
        <View style={styles.stateCardText}>
          <Text style={styles.cardTitle}>Loading server state</Text>
          <Text style={styles.cardCopy}>Waiting for the first authoritative snapshot.</Text>
        </View>
      </View>
    );
  }
  if (state === "partial-cache") {
    return (
      <View accessibilityLiveRegion="polite" style={styles.cacheCard}>
        <Text style={styles.cardLabel}>CACHED SHELL</Text>
        <Text style={styles.cardTitle}>Server state may be out of date.</Text>
        <Text style={styles.cardCopy}>
          Counts below came from the last bounded snapshot. The app will replace them after
          reconnect.
        </Text>
      </View>
    );
  }
  if (state === "incompatible") {
    return (
      <View accessibilityRole="alert" style={styles.failureCard}>
        <Text style={styles.cardLabel}>BLOCKED</Text>
        <Text style={styles.cardTitle}>Required V2 behavior is incompatible.</Text>
        <Text style={styles.cardCopy}>Edit this connection or choose another server.</Text>
      </View>
    );
  }
  if (state === "failure") {
    return (
      <View accessibilityRole="alert" style={styles.failureCard}>
        <Text style={styles.cardLabel}>UNAVAILABLE</Text>
        <Text style={styles.cardTitle}>No current workspace snapshot.</Text>
        <Text style={styles.cardCopy}>Check the connection, credentials, and network.</Text>
      </View>
    );
  }
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyMark}>READY</Text>
      <Text style={styles.cardTitle}>The server snapshot is current.</Text>
    </View>
  );
}

export function ActionButton({
  disabled,
  fullWidth,
  label,
  onPress,
  secondary,
}: {
  disabled?: boolean;
  fullWidth?: boolean;
  label: string;
  onPress: () => void | Promise<void>;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        fullWidth && styles.actionButtonFullWidth,
        secondary && styles.actionButtonSecondary,
        pressed && styles.actionButtonPressed,
        disabled && styles.actionButtonDisabled,
      ]}
    >
      <Text
        dynamicTypeRamp={typeRamp.control}
        style={[styles.actionButtonLabel, secondary && styles.actionButtonLabelSecondary]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignSelf: "flex-start",
    backgroundColor: palette.signal,
    borderRadius: radius.sm,
    marginTop: space.md,
    minHeight: 44,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  actionButtonDisabled: { opacity: 0.5 },
  actionButtonFullWidth: { alignSelf: "stretch", alignItems: "center" },
  actionButtonLabel: {
    color: palette.background,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  actionButtonLabelSecondary: { color: palette.ink },
  actionButtonPressed: { opacity: 0.72 },
  actionButtonSecondary: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
  },
  branchControl: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: space.xs,
    justifyContent: "center",
    marginHorizontal: space.sm,
    minHeight: 44,
    minWidth: 0,
  },
  branchControlLargeText: {
    flex: 0,
    justifyContent: "flex-start",
    marginHorizontal: 0,
    width: "100%",
  },
  branchControlPressed: { opacity: 0.55 },
  branchDetailName: { color: palette.ink, fontSize: 17, lineHeight: 25 },
  branchDetailNote: { color: palette.warm, fontSize: 14, lineHeight: 20 },
  branchName: { color: palette.dim, flexShrink: 1, fontSize: 13, minWidth: 0 },
  actionCard: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: space.md,
    padding: space.lg,
  },
  brand: { color: palette.signal, fontSize: 15, fontWeight: "700" },
  cacheCard: {
    backgroundColor: "#211B11",
    borderColor: palette.warm,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: space.lg,
    padding: space.lg,
  },
  cardCopy: { color: palette.dim, fontSize: 15, lineHeight: 22, marginTop: space.xs },
  cardLabel: { color: palette.warm, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  cardTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 23,
    marginTop: space.xs,
  },
  clientExplanation: { marginTop: space.sm },
  clientExplanationLabel: {
    color: palette.dim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  centeredState: {
    alignItems: "flex-start",
    backgroundColor: palette.background,
    flex: 1,
    justifyContent: "center",
    padding: space.xl,
  },
  connectionBar: {
    alignItems: "center",
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 45,
    paddingHorizontal: space.md,
  },
  connectionBarLargeText: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: 2,
    paddingVertical: space.xs,
  },
  connectionName: {
    color: palette.dim,
    fontSize: 13,
    textAlign: "right",
  },
  connectionNameControl: {
    flex: 1,
    justifyContent: "center",
    marginLeft: space.sm,
    minHeight: 44,
    minWidth: 0,
  },
  connectionNameControlLargeText: {
    flex: 0,
    marginLeft: 0,
    maxWidth: "100%",
    width: "100%",
  },
  connectionNameControlWithBranch: { flex: 0, flexShrink: 1, marginLeft: 0, maxWidth: "30%" },
  connectionNameLargeText: {
    flex: 0,
    textAlign: "left",
    width: "100%",
  },
  connectionState: { alignItems: "center", flexDirection: "row" },
  connectionStatus: { color: palette.ink, fontSize: 11, fontWeight: "700" },
  content: { flex: 1 },
  emptyCard: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: space.lg,
    padding: space.lg,
  },
  emptyMark: { color: palette.signal, fontSize: 34, fontWeight: "300", letterSpacing: -1.2 },
  errorEyebrow: { color: palette.danger, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  errorText: { color: palette.danger, fontSize: 14, lineHeight: 20, marginTop: space.sm },
  eyebrow: { color: palette.signal, fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  failureCard: {
    backgroundColor: "#251411",
    borderColor: palette.danger,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: space.lg,
    padding: space.lg,
  },
  lede: { color: palette.dim, fontSize: 16, lineHeight: 24, marginTop: space.sm, maxWidth: 620 },
  main: { flex: 1, minWidth: 0 },
  metric: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minWidth: 120,
    padding: space.md,
  },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  metricLabel: { color: palette.dim, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  metricValue: { color: palette.ink, fontSize: 34, fontWeight: "300", lineHeight: 41 },
  navigationItem: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexGrow: 1,
    flexShrink: 0,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: space.sm,
  },
  navigationItemLargeText: { paddingHorizontal: space.sm, paddingVertical: space.sm },
  navigationItemActive: { backgroundColor: palette.signalDark },
  navigationItemPressed: { opacity: 0.68 },
  navigationLabel: {
    color: palette.dim,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  navigationLabelActive: { color: palette.signal },
  permissionActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  permissionError: { color: palette.danger, fontSize: 13, lineHeight: 18, marginTop: space.sm },
  permissionResource: {
    backgroundColor: palette.background,
    borderRadius: radius.sm,
    color: palette.ink,
    fontSize: 13,
    marginTop: space.sm,
    padding: space.sm,
  },
  permissionWarning: { color: palette.warm, fontSize: 12, lineHeight: 17, marginTop: space.sm },
  rail: {
    backgroundColor: palette.card,
    borderRightColor: palette.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    justifyContent: "space-between",
    padding: space.lg,
    width: 228,
  },
  railConnection: {
    color: palette.ink,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 24,
    marginTop: space.sm,
  },
  railFooter: { alignItems: "center", flexDirection: "row", minHeight: 44 },
  railNavigation: { gap: space.sm },
  railStatus: { color: palette.dim, flex: 1, fontSize: 11, fontWeight: "700" },
  safeArea: { backgroundColor: palette.background, flex: 1 },
  scrollContent: {
    alignSelf: "center",
    maxWidth: 720,
    padding: space.lg,
    paddingBottom: 80,
    width: "100%",
  },
  stateActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  settingCard: {
    alignItems: "center",
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.md,
    marginTop: space.lg,
    padding: space.lg,
  },
  settingText: { flex: 1 },
  shell: { flex: 1 },
  stateCard: {
    alignItems: "center",
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.md,
    marginTop: space.lg,
    padding: space.lg,
  },
  stateCardText: { flex: 1 },
  stateCopy: {
    color: palette.dim,
    fontSize: 16,
    lineHeight: 24,
    marginTop: space.sm,
    maxWidth: 480,
  },
  stateTitle: {
    color: palette.ink,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
    marginTop: space.sm,
  },
  statusDot: { borderRadius: 4, height: 8, marginRight: space.sm, width: 8 },
  tabletShell: { flexDirection: "row" },
  title: {
    color: palette.ink,
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1.1,
    lineHeight: 39,
    marginTop: space.sm,
  },
});
