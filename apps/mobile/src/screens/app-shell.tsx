import Feather from "@expo/vector-icons/Feather";
import type { NotificationDeliveryState } from "@opencode2-mobile/notification-protocol";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
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
import { Button } from "../components/button";
import { managementStyles, SettingsGroup, SettingsRow } from "../components/management-layout";
import { ModalSheet } from "../components/modal-sheet";
import { SegmentedControl } from "../components/segmented-control";
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
import { useTranscriptPreferences } from "../state/transcript-preferences";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import {
  cardSurface,
  palette,
  pressedOpacity,
  radius,
  space,
  switchColors,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";
import { AppUpdateCard } from "../updates/app-updates";
import { FormRequestList } from "./form-request-list";
import { PermissionRequestCard } from "./permission-request-card";
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
  const [showLocations, setShowLocations] = useState(false);
  const runtime = useConnectionRuntime();
  const selection = useWorkspaceSelection();
  const { width } = useWindowDimensions();
  const tablet = isTabletShell(width);
  const failedLocationCount = selection.attentionCoverage.failedLocationCount;
  const failedLocations = selection.attentionCoverage.failedLocations ?? [];
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
          <View style={styles.heading}>
            <Text
              accessibilityRole="header"
              dynamicTypeRamp={typeRamp.largeTitle}
              style={styles.title}
            >
              Requests that need you.
            </Text>
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.lede}>
              Approvals and forms from followed projects appear here.
            </Text>
          </View>
        ) : null}
        {selection.preferencesLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator
              accessibilityLabel="Loading followed projects"
              color={palette.signal}
            />
            <Text dynamicTypeRamp={typeRamp.headline} style={styles.stateCardTitle}>
              Loading followed projects
            </Text>
          </View>
        ) : selection.followedProjectIds.length === 0 ? (
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <StatusIcon color={palette.dim} name="folder" />
              <Text dynamicTypeRamp={typeRamp.headline} style={styles.summaryTitle}>
                Follow a project to reconcile pending work.
              </Text>
            </View>
            <Button
              label="Choose projects"
              onPress={() => navigation.navigate("FollowedProjects")}
            />
          </View>
        ) : selection.interactionsLoading && selection.pendingCount === 0 ? (
          <View style={styles.stateCard}>
            <ActivityIndicator accessibilityLabel="Loading pending work" color={palette.signal} />
            <Text dynamicTypeRamp={typeRamp.headline} style={styles.stateCardTitle}>
              Reconciling pending work
            </Text>
          </View>
        ) : selection.interactionsError && selection.pendingCount === 0 ? (
          <View
            accessibilityRole="alert"
            style={allKnownLocationsFailed ? styles.failureCard : styles.cacheCard}
          >
            <Text
              dynamicTypeRamp={typeRamp.sectionLabel}
              style={allKnownLocationsFailed ? styles.failureLabel : styles.cacheLabel}
            >
              {allKnownLocationsFailed ? "Unavailable" : "Partial results"}
            </Text>
            <Text dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
              {allKnownLocationsFailed
                ? "Pending requests could not be checked."
                : locationFailureTitle(failedLocationCount)}
            </Text>
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
              {failedProjectSummary
                ? `Affected ${selection.attentionCoverage.failedProjects.length === 1 ? "project" : "projects"}: ${failedProjectSummary}. `
                : "The affected project could not be identified. "}
              {allKnownLocationsFailed
                ? "The server returned errors for every known location."
                : `No requests were found at the ${selection.attentionCoverage.reconciledLocationCount} ${selection.attentionCoverage.reconciledLocationCount === 1 ? "location" : "locations"} that responded.`}
            </Text>
            <View style={styles.stateActions}>
              {failedLocations.length > 0 ? (
                <ActionButton label="Review locations" onPress={() => setShowLocations(true)} />
              ) : null}
              <ActionButton
                label="Retry"
                secondary={failedLocations.length > 0}
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
                <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.cacheLabel}>
                  Partial results
                </Text>
                <Text dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
                  {locationFailureTitle(failedLocationCount)}
                </Text>
                <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
                  {failedProjectSummary
                    ? `Affected ${selection.attentionCoverage.failedProjects.length === 1 ? "project" : "projects"}: ${failedProjectSummary}. `
                    : "The affected project could not be identified. "}
                  Showing requests found at the other locations.
                </Text>
                {failedLocations.length > 0 ? (
                  <ActionButton label="Review locations" onPress={() => setShowLocations(true)} />
                ) : null}
                <ActionButton
                  label="Retry"
                  onPress={async () => {
                    await selection.refetch();
                  }}
                  secondary
                />
              </View>
            ) : null}
            <View style={styles.summary}>
              <View
                accessible
                accessibilityLabel={pendingSummaryLabel(
                  selection.pendingCount,
                  selection.attentionCoverage.completeness === "complete",
                )}
                style={styles.summaryRow}
              >
                {selection.pendingCount > 0 ? (
                  <View style={styles.countBadge}>
                    <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.countBadgeText}>
                      {selection.pendingCount}
                    </Text>
                  </View>
                ) : (
                  <StatusIcon color={palette.success} name="check-circle" />
                )}
                <Text dynamicTypeRamp={typeRamp.headline} style={styles.summaryTitle}>
                  {pendingSummaryTitle(
                    selection.pendingCount,
                    selection.attentionCoverage.completeness === "complete",
                  )}
                </Text>
              </View>
              <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.summaryCopy}>
                {pendingCoverageLabel(selection.attentionCoverage)}
              </Text>
            </View>
            {selection.permissions.map((request) => (
              <PermissionRequestCard
                key={`permission:${request.id}`}
                request={request}
                replying={selection.replyingPermissionId === request.id}
                error={selection.permissionReplyError}
                onReply={selection.replyPermission}
              />
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
      <ModalSheet
        title="Unavailable locations"
        visible={showLocations}
        onClose={() => setShowLocations(false)}
      >
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
          These checks failed. Pending work at these locations is still unknown. Session history is
          preserved.
        </Text>
        {failedLocations.some(
          (failure) => failure.source === "session-history" || failure.source === "worktree",
        ) ? (
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
            A directory referenced by session history or a worktree may have been moved or removed.
            A failed check alone does not confirm that it was deleted.
          </Text>
        ) : null}
        {failedLocations.map((failure) => (
          <View key={JSON.stringify(failure.location)} style={styles.locationFailure}>
            <Text
              accessibilityRole="header"
              dynamicTypeRamp={typeRamp.headline}
              style={styles.cardTitle}
            >
              {sanitizeTranscriptText(failure.projectLabel, 256)}
            </Text>
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
              {failure.source === "project-root"
                ? "Project root"
                : failure.source === "worktree"
                  ? "Registered worktree"
                  : failure.source === "session-history"
                    ? "Referenced by session history"
                    : "Discovered location"}
            </Text>
            <Text selectable style={styles.locationPath}>
              {sanitizeTranscriptText(
                failure.location.directory,
                failure.location.directory.length,
              )}
            </Text>
            {failure.location.workspaceID ? (
              <Text selectable style={styles.locationPath}>
                Workspace:{" "}
                {sanitizeTranscriptText(
                  failure.location.workspaceID,
                  failure.location.workspaceID.length,
                )}
              </Text>
            ) : null}
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
              Could not check: {failure.failedChecks.join(" and ")}.
            </Text>
          </View>
        ))}
        {failedLocations.length === 0 ? (
          <Text dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
            No location checks are currently failing.
          </Text>
        ) : (
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
            Check these directories on the server. Restore a moved or removed worktree if you still
            need it, then retry. If a whole project is retired, unfollow it on this device.
            Unfollowing does not delete its sessions.
          </Text>
        )}
        <ActionButton
          label="Manage followed projects"
          onPress={() => {
            setShowLocations(false);
            navigation.navigate("FollowedProjects");
          }}
          secondary
        />
      </ModalSheet>
    </ShellFrame>
  );
}

export function SettingsScreen({ navigation }: ScreenProps<"Settings">) {
  const transcript = useTranscriptPreferences();
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
      <ScrollView contentContainerStyle={managementStyles.content}>
        <Text dynamicTypeRamp={typeRamp.footnote} style={managementStyles.description}>
          Device and connection controls.
        </Text>

        <AppUpdateCard />

        <SettingsGroup title="Transcript">
          <SettingsRow>
            <View style={styles.settingText}>
              <SettingText
                description="Steer updates the current work. Queue waits until it finishes."
                title="Default follow-up delivery"
              />
              <View style={styles.deliveryOptions}>
                <SegmentedControl
                  accessibilityLabel="Default follow-up delivery"
                  disabled={transcript.busy}
                  onChange={(defaultDelivery) => {
                    if (!transcript.busy) void transcript.update({ defaultDelivery });
                  }}
                  options={deliveryOptions}
                  value={transcript.defaultDelivery}
                />
              </View>
            </View>
          </SettingsRow>

          <SettingsRow>
            <View style={styles.settingText}>
              <SettingText
                description={
                  transcript.detailed
                    ? "Detailed: individual tool executions and system notices."
                    : "Compact: group activity and collapse routine details."
                }
                title="Detailed transcript"
              />
            </View>
            <Switch
              {...switchColors}
              accessibilityLabel="Detailed transcript"
              disabled={transcript.busy}
              value={transcript.detailed}
              onValueChange={(detailed) => void transcript.update({ detailed })}
            />
          </SettingsRow>
          <SettingsRow>
            <View style={styles.settingText}>
              <SettingText
                description="Display model reasoning when provided by the server."
                title="Show reasoning"
              />
            </View>
            <Switch
              {...switchColors}
              accessibilityLabel="Show reasoning"
              disabled={transcript.busy}
              value={transcript.reasoning}
              onValueChange={(reasoning) => void transcript.update({ reasoning })}
            />
          </SettingsRow>
        </SettingsGroup>
        {transcript.error ? (
          <Text
            accessibilityRole="alert"
            dynamicTypeRamp={typeRamp.footnote}
            style={styles.errorText}
          >
            Message preferences could not be loaded or saved. Try changing the setting again.
          </Text>
        ) : null}

        <SettingsGroup title="Security and notifications">
          <SettingsRow>
            <View style={styles.settingText}>
              <SettingText
                description="Require device authentication after the app leaves the foreground."
                title="App lock"
              />
            </View>
            <Switch
              {...switchColors}
              accessibilityLabel="Require device authentication"
              disabled={appLock.busy}
              onValueChange={(enabled) => void appLock.setEnabled(enabled)}
              value={appLock.enabled}
            />
          </SettingsRow>
          {appLock.error ? (
            <SettingsRow>
              <Text
                accessibilityRole="alert"
                dynamicTypeRamp={typeRamp.footnote}
                style={styles.errorText}
              >
                {appLock.error}
              </Text>
            </SettingsRow>
          ) : null}

          <SettingsRow>
            <View style={styles.settingText}>
              <SettingText
                description={
                  notificationLoading
                    ? "Reading the shared broker setting."
                    : !notificationPairing
                      ? "Pair this connection for notifications before enabling delivery."
                      : notificationState?.enabled
                        ? "Enabled for every phone paired with this notification broker."
                        : notificationState
                          ? "Paused. New requests will not create mobile notifications."
                          : "The shared broker setting is unavailable."
                }
                title="Mobile notifications"
              />
            </View>
            {notificationLoading ? (
              <ActivityIndicator
                accessibilityLabel="Loading mobile notification setting"
                color={palette.signal}
              />
            ) : (
              <Switch
                {...switchColors}
                accessibilityLabel="Send mobile notifications"
                disabled={!notificationPairing || !notificationState || notificationBusy}
                onValueChange={(enabled) => void setNotificationsEnabled(enabled)}
                value={notificationState?.enabled ?? false}
              />
            )}
          </SettingsRow>
        </SettingsGroup>
        {notificationError ? (
          <Text
            accessibilityRole="alert"
            dynamicTypeRamp={typeRamp.footnote}
            style={styles.errorText}
          >
            The notification broker setting could not be read or updated.
          </Text>
        ) : null}

        <SettingsGroup title="Workspace">
          <View style={styles.managementAction}>
            <SettingText
              description="Choose which server projects are merged into Sessions and attention reconciliation."
              title="Followed projects"
            />
            <ActionButton
              label="Manage followed projects"
              onPress={() => navigation.navigate("FollowedProjects")}
            />
          </View>

          <View style={styles.managementAction}>
            <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.cardLabel}>
              Selected connection
            </Text>
            <SettingText
              description={selected?.baseUrl ?? "Choose a saved server profile."}
              title={selected?.name ?? "No connection selected"}
            />
            <ActionButton
              label="Manage connections"
              onPress={() => navigation.navigate("Connections")}
            />
          </View>
        </SettingsGroup>

        <SettingsGroup title="Support">
          <View style={styles.managementAction}>
            <SettingText
              description="Includes status transitions, event types, and numeric transcript performance counters. It excludes credentials, server addresses, paths, titles, prompts, and content."
              title="Redacted transport and transcript report"
            />
            <ActionButton
              label="Share diagnostics"
              onPress={() => void shareDiagnostics()}
              secondary
            />
          </View>
        </SettingsGroup>
      </ScrollView>
    </ShellFrame>
  );
}

function SettingText({ description, title }: { description: string; title: string }) {
  return (
    <>
      <Text dynamicTypeRamp={typeRamp.body} style={styles.settingTitle}>
        {title}
      </Text>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.settingCopy}>
        {description}
      </Text>
    </>
  );
}

export function ConnectionStorageLoadingScreen() {
  return (
    <SafeAreaView style={styles.centeredState}>
      <StatusBar style="light" />
      <ActivityIndicator accessibilityLabel="Loading saved connections" color={palette.signal} />
      <Text
        accessibilityRole="header"
        dynamicTypeRamp={typeRamp.largeTitle}
        style={styles.stateTitle}
      >
        Opening the local shell
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.stateCopy}>
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
      <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.failureLabel}>
        Local storage failure
      </Text>
      <Text
        accessibilityRole="header"
        dynamicTypeRamp={typeRamp.largeTitle}
        style={styles.stateTitle}
      >
        Saved connections are unavailable.
      </Text>
      <Text
        accessibilityRole="alert"
        dynamicTypeRamp={typeRamp.subheadline}
        style={styles.stateCopy}
      >
        {connections.error}
      </Text>
      <ActionButton disabled={retrying} label={retrying ? "Retrying" : "Retry"} onPress={retry} />
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
  if (status === "connected") return { color: palette.success, label: "Connected" };
  if (status === "connecting") return { color: palette.warm, label: "Connecting" };
  if (status === "reconnecting") {
    return { color: palette.warm, label: `Reconnecting (${reconnectAttempt})` };
  }
  if (status === "stale") return { color: palette.warm, label: "Stale" };
  if (status === "offline") return { color: palette.dim, label: "Offline" };
  if (status === "unauthorized") return { color: palette.danger, label: "Authorization required" };
  if (status === "incompatible") return { color: palette.danger, label: "Incompatible server" };
  return { color: palette.dim, label: "No connection" };
}

// The app only marks its connection stale while it is in the background, and it reconnects
// on return, so a stale banner would flash on every app switch without anything to fix.
export function showsConnectionIssue(status: ConnectionTransportStatus) {
  return status !== "connected" && status !== "connecting" && status !== "stale";
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
  sessionOptions,
  sessionTabs,
}: {
  active: Section;
  branch?: SessionBranch;
  children?: ReactNode;
  hideConnectionBar?: boolean;
  navigate: (screen: Section) => void;
  sessionOptions?: ReactNode;
  sessionTabs?: { active: "session" | "changes"; onSelect: (tab: "session" | "changes") => void };
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
              <Text dynamicTypeRamp={typeRamp.headline} style={styles.brand}>
                OpenCode
              </Text>
              {!sessionTabs ? (
                <Text
                  dynamicTypeRamp={typeRamp.headline}
                  numberOfLines={2}
                  style={styles.railConnection}
                >
                  {selected?.name ?? "No server"}
                </Text>
              ) : null}
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
            {!sessionTabs ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => navigate("Settings")}
                style={styles.railFooter}
              >
                <View style={[styles.statusDot, { backgroundColor: connection.color }]} />
                <Text
                  dynamicTypeRamp={typeRamp.footnote}
                  numberOfLines={1}
                  style={styles.railStatus}
                >
                  {connection.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.main}>
          {!hideConnectionBar ? (
            <View
              accessibilityLiveRegion="polite"
              style={[styles.connectionBar, largeText && styles.connectionBarLargeText]}
            >
              {sessionTabs ? (
                <View style={[styles.sessionTabs, largeText && styles.sessionTabsLargeText]}>
                  <SegmentedControl
                    accessibilityLabel="Session view"
                    onChange={sessionTabs.onSelect}
                    options={sessionTabOptions}
                    role="tablist"
                    size="compact"
                    value={sessionTabs.active}
                  />
                </View>
              ) : (
                <View style={styles.connectionState}>
                  <View style={[styles.statusDot, { backgroundColor: connection.color }]} />
                  <Text dynamicTypeRamp={typeRamp.footnote} style={styles.connectionStatus}>
                    {connection.label}
                  </Text>
                </View>
              )}
              {branch || sessionOptions ? (
                <View
                  style={[styles.locationControls, largeText && styles.locationControlsLargeText]}
                >
                  {branch ? (
                    branch.state === "known" && branch.name ? (
                      <Pressable
                        accessibilityHint="Opens details where you can copy the full branch name"
                        accessibilityLabel={`Current branch, ${branch.name}${branch.stale ? ", may be outdated" : ""}`}
                        accessibilityRole="button"
                        onPress={() => showDetail("branch")}
                        style={({ pressed }) => [
                          styles.branchControl,
                          largeText && !sessionOptions && styles.branchControlLargeText,
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
                          dynamicTypeRamp={typeRamp.subheadline}
                          ellipsizeMode="middle"
                          numberOfLines={1}
                          style={styles.branchName}
                        >
                          {branch.name}
                        </Text>
                      </Pressable>
                    ) : (
                      <View
                        style={[
                          styles.branchControl,
                          largeText && !sessionOptions && styles.branchControlLargeText,
                        ]}
                      >
                        <Feather
                          accessibilityElementsHidden
                          color={palette.dim}
                          importantForAccessibility="no-hide-descendants"
                          name="git-branch"
                          size={14}
                        />
                        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.branchName}>
                          {branch.state === "loading"
                            ? "Checking branch"
                            : branch.state === "none"
                              ? "No branch"
                              : "Branch unavailable"}
                        </Text>
                      </View>
                    )
                  ) : null}
                  {sessionOptions}
                </View>
              ) : null}
              {!sessionTabs ? (
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
                    dynamicTypeRamp={typeRamp.subheadline}
                    numberOfLines={largeText ? undefined : 1}
                    style={[styles.connectionName, largeText && styles.connectionNameLargeText]}
                  >
                    {serverName}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {sessionTabs && showsConnectionIssue(runtime.status) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Connection problem: ${connection.label}. Open connection settings`}
              onPress={() => navigate("Settings")}
              style={styles.sessionConnectionIssue}
            >
              <Text
                accessibilityLiveRegion="polite"
                dynamicTypeRamp={typeRamp.footnote}
                style={[styles.connectionIssue, { color: connection.color }]}
              >
                {connection.label}. Check connection settings.
              </Text>
            </Pressable>
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
        <Text dynamicTypeRamp={typeRamp.body} selectable style={styles.branchDetailName}>
          {detailName}
        </Text>
        {openDetail === "branch" && branch?.stale ? (
          <Text
            accessibilityRole="alert"
            dynamicTypeRamp={typeRamp.subheadline}
            style={styles.branchDetailNote}
          >
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

function pendingSummaryTitle(count: number, complete: boolean) {
  if (count === 0) return complete ? "No pending requests" : "No known pending requests";
  if (complete) return count === 1 ? "Pending request" : "Pending requests";
  return count === 1 ? "Known pending request" : "Known pending requests";
}

function pendingSummaryLabel(count: number, complete: boolean) {
  const title = pendingSummaryTitle(count, complete);
  return count === 0 ? title : `${count} ${title.toLowerCase()}`;
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

const sessionTabOptions = [
  { value: "session", label: "Session" },
  { value: "changes", label: "Changes" },
] as const;

const deliveryOptions = [
  { value: "steer", label: "Steer" },
  { value: "queue", label: "Queue" },
] as const;

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

function StatusIcon({
  color,
  name,
}: {
  color: string;
  name: ComponentProps<typeof Feather>["name"];
}) {
  return (
    <Feather
      accessibilityElementsHidden
      color={color}
      importantForAccessibility="no-hide-descendants"
      name={name}
      size={20}
    />
  );
}

export function WorkspaceStateCard({ state }: { state: ReturnType<typeof getWorkspaceState> }) {
  if (state === "loading") {
    return (
      <View accessibilityLiveRegion="polite" style={styles.stateCard}>
        <ActivityIndicator color={palette.dim} />
        <View style={styles.stateCardText}>
          <Text dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
            Loading server state
          </Text>
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
            Waiting for the first authoritative snapshot.
          </Text>
        </View>
      </View>
    );
  }
  if (state === "partial-cache") {
    return (
      <View accessibilityLiveRegion="polite" style={styles.cacheCard}>
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.cacheLabel}>
          Cached data
        </Text>
        <Text dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
          Server state may be out of date.
        </Text>
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
          Counts below came from the last bounded snapshot. The app will replace them after
          reconnect.
        </Text>
      </View>
    );
  }
  if (state === "incompatible") {
    return (
      <View accessibilityRole="alert" style={styles.failureCard}>
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.failureLabel}>
          Blocked
        </Text>
        <Text dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
          Required V2 behavior is incompatible.
        </Text>
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
          Edit this connection or choose another server.
        </Text>
        <AppUpdateCard />
      </View>
    );
  }
  if (state === "failure") {
    return (
      <View accessibilityRole="alert" style={styles.failureCard}>
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.failureLabel}>
          Unavailable
        </Text>
        <Text dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
          No current workspace snapshot.
        </Text>
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
          Check the connection, credentials, and network.
        </Text>
        <AppUpdateCard />
      </View>
    );
  }
  return (
    <View style={styles.summaryRow}>
      <StatusIcon color={palette.success} name="check-circle" />
      <Text dynamicTypeRamp={typeRamp.headline} style={styles.summaryTitle}>
        The server snapshot is current.
      </Text>
    </View>
  );
}

export function ActionButton({
  accessibilityLabel,
  disabled,
  fullWidth,
  label,
  onPress,
  secondary,
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  label: string;
  onPress: () => void | Promise<void>;
  secondary?: boolean;
}) {
  return (
    <View style={[styles.actionButton, fullWidth && styles.actionButtonFullWidth]}>
      <Button
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        disabled={Boolean(disabled)}
        fullWidth={Boolean(fullWidth)}
        label={label}
        onPress={() => void onPress()}
        variant={secondary ? "secondary" : "primary"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: { alignSelf: "flex-start", marginTop: space.md, maxWidth: "100%" },
  actionButtonFullWidth: { alignSelf: "stretch" },
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
  branchControlPressed: { opacity: pressedOpacity },
  branchDetailName: { ...typography.body, color: palette.ink },
  branchDetailNote: { ...typography.subheadline, color: palette.warm },
  branchName: { ...typography.subheadline, color: palette.dim, flexShrink: 1, minWidth: 0 },
  brand: { ...typography.headline, color: palette.signal },
  cacheCard: { ...cardSurface, borderColor: palette.warm, gap: space.xs },
  cacheLabel: { ...typography.sectionLabel, color: palette.warm },
  cardCopy: { ...typography.subheadline, color: palette.dim },
  cardLabel: { ...typography.sectionLabel, color: palette.dim },
  cardTitle: { ...typography.headline, color: palette.ink },
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
  connectionIssue: typography.footnote,
  connectionName: { ...typography.subheadline, color: palette.dim, textAlign: "right" },
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
  connectionStatus: { ...typography.footnote, color: palette.dim },
  content: { flex: 1 },
  countBadge: {
    alignItems: "center",
    backgroundColor: palette.warm,
    borderRadius: radius.pill,
    justifyContent: "center",
    minHeight: 24,
    minWidth: 24,
    paddingHorizontal: space.xs,
  },
  countBadgeText: { ...typography.sectionLabel, color: palette.background },
  deliveryOptions: { marginTop: space.sm },
  errorText: { ...typography.footnote, color: palette.danger },
  failureCard: { ...cardSurface, borderColor: palette.danger, gap: space.xs },
  failureLabel: { ...typography.sectionLabel, color: palette.danger },
  heading: { gap: space.xs },
  lede: { ...typography.subheadline, color: palette.dim, maxWidth: 620 },
  locationControls: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" },
  locationControlsLargeText: { flex: 0, width: "100%" },
  locationFailure: { ...cardSurface, gap: space.xs },
  locationPath: { ...typography.code, color: palette.ink },
  main: { flex: 1, minWidth: 0 },
  managementAction: {
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
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
  navigationItemPressed: { opacity: pressedOpacity },
  navigationLabel: { ...typography.control, color: palette.dim, textAlign: "center" },
  navigationLabelActive: { color: palette.signal },
  rail: {
    backgroundColor: palette.card,
    borderRightColor: palette.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    justifyContent: "space-between",
    padding: space.lg,
    width: 228,
  },
  railConnection: { ...typography.headline, color: palette.ink, marginTop: space.sm },
  railFooter: { alignItems: "center", flexDirection: "row", minHeight: 44 },
  railNavigation: { gap: space.sm },
  railStatus: { ...typography.footnote, color: palette.dim, flex: 1 },
  safeArea: { backgroundColor: palette.background, flex: 1 },
  scrollContent: {
    alignSelf: "center",
    gap: space.md,
    maxWidth: 720,
    padding: space.md,
    paddingBottom: space.xl,
    width: "100%",
  },
  sessionConnectionIssue: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.md },
  // Fixed width keeps both compact segments legible beside the branch name.
  sessionTabs: { width: 176 },
  sessionTabsLargeText: { width: "100%" },
  settingCopy: { ...typography.footnote, color: palette.dim },
  settingText: { flexGrow: 1, flexShrink: 1, gap: 2 },
  settingTitle: { ...typography.body, color: palette.ink },
  shell: { flex: 1 },
  stateActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  stateCard: { ...cardSurface, alignItems: "center", flexDirection: "row", gap: space.md },
  stateCardText: { flex: 1, gap: space.xs },
  stateCardTitle: { ...typography.headline, color: palette.ink, flex: 1 },
  stateCopy: {
    ...typography.subheadline,
    color: palette.dim,
    marginTop: space.sm,
    maxWidth: 480,
  },
  stateTitle: {
    ...typography.largeTitle,
    color: palette.ink,
    marginTop: space.sm,
  },
  statusDot: { borderRadius: 4, height: 8, marginRight: space.sm, width: 8 },
  summary: { gap: space.sm },
  summaryCopy: { ...typography.subheadline, color: palette.dim },
  summaryRow: { alignItems: "center", flexDirection: "row", gap: space.sm },
  summaryTitle: { ...typography.headline, color: palette.ink, flexShrink: 1 },
  tabletShell: { flexDirection: "row" },
  title: { ...typography.largeTitle, color: palette.ink },
});
