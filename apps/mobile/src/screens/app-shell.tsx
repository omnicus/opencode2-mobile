import Feather from "@expo/vector-icons/Feather";
import { NavigationContext } from "@react-navigation/native";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import {
  type ComponentProps,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
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
import { MenuRow } from "../components/menu-row";
import { ModalSheet } from "../components/modal-sheet";
import { SegmentedControl } from "../components/segmented-control";
import { announceOnIOS, useAnnouncement } from "../components/use-announcement";
import { useConnections } from "../connections/connections-context";
import { attentionAccessibilityValue } from "../navigation/attention-labels";
import type { RootStackParamList } from "../navigation/root-navigation";
import { useAppLock } from "../security/app-lock-context";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import type { ConnectionTransportStatus } from "../state/connection-transport-coordinator";
import type { AttentionCoverage } from "../state/followed-projects-model";
import { useTranscriptPreferences } from "../state/transcript-preferences";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
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
import { AppUpdateCard } from "../updates/app-updates";
import {
  affectedProjectsText,
  allKnownLocationsFailed,
  branchStatusLabel,
  type CopyState,
  detailCopyAnnouncement,
  detailCopyLabel,
  hasMovableLocationFailure,
  locationFailureTitle,
  locationSourceLabel,
  notificationSettingDescription,
  offersNotificationPairing,
  pendingBadge,
  pendingCoverageLabel,
  pendingLabel,
  pendingSummaryTitle,
  respondedLocationsText,
  type ShellDetail,
} from "./app-shell-model";
import { useNotificationSetting } from "./app-shell-notification-setting";
import { FormRequestList } from "./form-request-list";
import { PermissionRequestCard } from "./permission-request-card";
import { sanitizeTranscriptText } from "./session-transcript-model";

export { pendingLabel, pendingSummaryTitle } from "./app-shell-model";

type Section = "Connections" | "Pending" | "Settings" | "Workspace";
type SessionBranch = {
  name?: string;
  stale?: boolean;
  state: "known" | "loading" | "none" | "unavailable";
};
type ScreenProps<RouteName extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  RouteName
>;
type SessionTabs = {
  active: "session" | "changes";
  onSelect: (tab: "session" | "changes") => void;
};
type PendingDestination = "Connections" | "FollowedProjects";
type ConnectionPresentation = ReturnType<typeof getConnectionPresentation>;
type WorkspaceSelection = ReturnType<typeof useWorkspaceSelection>;
type LocationFailure = AttentionCoverage["failedLocations"][number];

const tabletBreakpoint = 760;

// Modal routes replace an already open modal instead of stacking a second copy of it.
export function navigateToSection(
  navigation: Pick<NativeStackNavigationProp<RootStackParamList>, "navigate" | "popTo">,
  section: Section,
) {
  if (section === "Workspace") navigation.popTo("Workspace");
  else navigation.navigate(section, undefined, { pop: true });
}

export function PendingInteractionsScreen({ navigation }: ScreenProps<"Pending">) {
  const { width } = useWindowDimensions();
  const tablet = isTabletShell(width);
  const navigate = (section: Section) => navigateToSection(navigation, section);

  return (
    <ShellFrame active="Pending" hideConnectionBar={!tablet} navigate={navigate}>
      <PendingInteractions
        heading={tablet}
        onNavigate={(destination) => navigation.navigate(destination)}
      />
    </ShellFrame>
  );
}

// Requests from followed projects. Shared by the Needs you screen and the phone Approvals tab.
export function PendingInteractions({
  bottomInset = 0,
  heading,
  onNavigate,
}: {
  bottomInset?: number;
  heading: boolean;
  onNavigate: (destination: PendingDestination) => void;
}) {
  const [showLocations, setShowLocations] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const runtime = useConnectionRuntime();
  const selection = useWorkspaceSelection();
  const failedLocations = selection.attentionCoverage.failedLocations ?? [];

  async function retry() {
    setRetrying(true);
    try {
      await selection.refetch();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          bottomInset > 0 && { paddingBottom: bottomInset },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {heading ? (
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
        <PendingContent
          failedLocations={failedLocations}
          onNavigate={onNavigate}
          onRetry={retry}
          onReviewLocations={() => setShowLocations(true)}
          retrying={retrying}
          runtime={runtime}
          selection={selection}
        />
      </ScrollView>
      <UnavailableLocationsSheet
        failedLocations={failedLocations}
        onClose={() => setShowLocations(false)}
        onManage={() => {
          setShowLocations(false);
          onNavigate("FollowedProjects");
        }}
        visible={showLocations}
      />
    </>
  );
}

function PendingContent({
  failedLocations,
  onNavigate,
  onRetry,
  onReviewLocations,
  retrying,
  runtime,
  selection,
}: {
  failedLocations: LocationFailure[];
  onNavigate: (destination: PendingDestination) => void;
  onRetry: () => Promise<void>;
  onReviewLocations: () => void;
  retrying: boolean;
  runtime: ReturnType<typeof useConnectionRuntime>;
  selection: WorkspaceSelection;
}) {
  if (selection.preferencesLoading) {
    return (
      <PendingLoadingCard label="Loading followed projects" title="Loading followed projects" />
    );
  }
  if (selection.followedProjectIds.length === 0) {
    return (
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <StatusIcon color={palette.dim} name="folder" />
          <Text dynamicTypeRamp={typeRamp.headline} style={styles.summaryTitle}>
            Follow a project to see requests that need you here.
          </Text>
        </View>
        <Button label="Choose projects" onPress={() => onNavigate("FollowedProjects")} />
      </View>
    );
  }
  if (selection.interactionsLoading && selection.pendingCount === 0) {
    return (
      <PendingLoadingCard
        label="Checking for requests"
        title="Checking followed projects for requests"
      />
    );
  }
  if (selection.interactionsError && selection.pendingCount === 0) {
    return (
      <PendingFailureCard
        connected={runtime.status === "connected"}
        coverage={selection.attentionCoverage}
        failedLocations={failedLocations}
        onConnections={() => onNavigate("Connections")}
        onRetry={onRetry}
        onReviewLocations={onReviewLocations}
        retrying={retrying}
      />
    );
  }
  return (
    <>
      {selection.interactionsError ? (
        <PartialResultsCard
          coverage={selection.attentionCoverage}
          failedLocations={failedLocations}
          onRetry={onRetry}
          onReviewLocations={onReviewLocations}
          retrying={retrying}
        />
      ) : null}
      <PendingSummary count={selection.pendingCount} coverage={selection.attentionCoverage} />
      {selection.permissions.map((request) => (
        <PermissionRequestCard
          key={`permission:${request.id}`}
          request={request}
          replying={selection.replyingPermissionId === request.id}
          error={selection.failedPermissionReplyId === request.id}
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
  );
}

function PendingLoadingCard({ label, title }: { label: string; title: string }) {
  return (
    <View style={styles.stateCard}>
      <ActivityIndicator accessibilityLabel={label} color={palette.signal} />
      <Text dynamicTypeRamp={typeRamp.headline} style={styles.stateCardTitle}>
        {title}
      </Text>
    </View>
  );
}

function PendingFailureCard({
  connected,
  coverage,
  failedLocations,
  onConnections,
  onRetry,
  onReviewLocations,
  retrying,
}: {
  connected: boolean;
  coverage: AttentionCoverage;
  failedLocations: LocationFailure[];
  onConnections: () => void;
  onRetry: () => Promise<void>;
  onReviewLocations: () => void;
  retrying: boolean;
}) {
  const allFailed = allKnownLocationsFailed(coverage);
  return (
    <View accessibilityRole="alert" style={allFailed ? styles.failureCard : styles.cacheCard}>
      <Text
        dynamicTypeRamp={typeRamp.sectionLabel}
        style={allFailed ? styles.failureLabel : styles.cacheLabel}
      >
        {allFailed ? "Unavailable" : "Partial results"}
      </Text>
      <Text dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
        {allFailed
          ? "Requests that need you could not be checked."
          : locationFailureTitle(coverage.failedLocationCount)}
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
        {affectedProjectsText(coverage.failedProjects)}
        {allFailed
          ? "The server returned errors for every known location."
          : respondedLocationsText(coverage.reconciledLocationCount)}
      </Text>
      <View style={styles.stateActions}>
        {failedLocations.length > 0 ? (
          <ActionButton label="Review locations" onPress={onReviewLocations} />
        ) : null}
        <ActionButton
          busy={retrying}
          label="Retry"
          secondary={failedLocations.length > 0}
          onPress={onRetry}
        />
        {!connected ? <ActionButton label="Connections" onPress={onConnections} secondary /> : null}
      </View>
    </View>
  );
}

function PartialResultsCard({
  coverage,
  failedLocations,
  onRetry,
  onReviewLocations,
  retrying,
}: {
  coverage: AttentionCoverage;
  failedLocations: LocationFailure[];
  onRetry: () => Promise<void>;
  onReviewLocations: () => void;
  retrying: boolean;
}) {
  return (
    <View accessibilityRole="alert" style={styles.cacheCard}>
      <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.cacheLabel}>
        Partial results
      </Text>
      <Text dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
        {locationFailureTitle(coverage.failedLocationCount)}
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
        {affectedProjectsText(coverage.failedProjects)}
        Showing requests found at the other locations.
      </Text>
      {failedLocations.length > 0 ? (
        <ActionButton label="Review locations" onPress={onReviewLocations} />
      ) : null}
      <ActionButton busy={retrying} label="Retry" onPress={onRetry} secondary />
    </View>
  );
}

function PendingSummary({ count, coverage }: { count: number; coverage: AttentionCoverage }) {
  return (
    <View style={styles.summary}>
      <View style={styles.summaryRow}>
        {count > 0 ? (
          <StatusIcon color={palette.warm} name="inbox" />
        ) : (
          <StatusIcon color={palette.success} name="check-circle" />
        )}
        <Text dynamicTypeRamp={typeRamp.headline} style={styles.summaryTitle}>
          {pendingSummaryTitle(count, coverage.completeness === "complete")}
        </Text>
      </View>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.summaryCopy}>
        {pendingCoverageLabel(coverage)}
      </Text>
    </View>
  );
}

function UnavailableLocationsSheet({
  failedLocations,
  onClose,
  onManage,
  visible,
}: {
  failedLocations: LocationFailure[];
  onClose: () => void;
  onManage: () => void;
  visible: boolean;
}) {
  return (
    <ModalSheet title="Unavailable locations" visible={visible} onClose={onClose}>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
        These checks failed, so requests at these locations are still unknown. Session history is
        preserved.
      </Text>
      {hasMovableLocationFailure(failedLocations) ? (
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
          A directory referenced by session history or a worktree may have been moved or removed. A
          failed check alone does not confirm that it was deleted.
        </Text>
      ) : null}
      {failedLocations.map((failure) => (
        <LocationFailureCard key={JSON.stringify(failure.location)} failure={failure} />
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
      <ActionButton label="Manage followed projects" onPress={onManage} secondary />
    </ModalSheet>
  );
}

function LocationFailureCard({ failure }: { failure: LocationFailure }) {
  return (
    <View style={styles.locationFailure}>
      <Text accessibilityRole="header" dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
        {sanitizeTranscriptText(failure.projectLabel, 256)}
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
        {locationSourceLabel(failure.source)}
      </Text>
      <Text selectable style={styles.locationPath}>
        {sanitizeTranscriptText(failure.location.directory, failure.location.directory.length)}
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
  );
}

export function SettingsScreen({ navigation }: ScreenProps<"Settings">) {
  const { width } = useWindowDimensions();
  const tablet = isTabletShell(width);
  const selection = useWorkspaceSelection();
  const transcript = useTranscriptPreferences();
  const db = useSQLiteContext();
  const appLock = useAppLock();
  const runtime = useConnectionRuntime();
  const connections = useConnections();
  const selected = connections.profiles.find(
    (profile) => profile.id === connections.selectedProfileId,
  );
  const notifications = useNotificationSetting(db, connections.selectedProfileId, navigation);
  const navigate = (section: Section) => navigateToSection(navigation, section);

  async function shareDiagnostics() {
    await Share.share({ message: runtime.getDiagnosticsText() });
  }

  return (
    <ShellFrame active="Settings" hideConnectionBar={!tablet} navigate={navigate}>
      <ScrollView contentContainerStyle={managementStyles.content}>
        <WorkspaceSettings
          connectionName={selected?.name}
          coverage={selection.attentionCoverage}
          navigate={navigate}
          onFollowedProjects={() => navigation.navigate("FollowedProjects")}
          pendingCount={selection.pendingCount}
        />

        <TranscriptSettings transcript={transcript} />

        <SecuritySettings
          appLock={appLock}
          connectionID={connections.selectedProfileId}
          notifications={notifications}
          onPair={() => navigation.navigate("Pairing")}
        />

        <AppUpdateCard />

        <SettingsGroup title="Support">
          <View style={styles.managementAction}>
            <SettingText
              description="Connection events and transcript performance counts. It leaves out credentials, server addresses, paths, titles, prompts, and content."
              title="Diagnostics report"
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

function WorkspaceSettings({
  connectionName,
  coverage,
  navigate,
  onFollowedProjects,
  pendingCount,
}: {
  connectionName: string | undefined;
  coverage: AttentionCoverage;
  navigate: (section: Section) => void;
  onFollowedProjects: () => void;
  pendingCount: number;
}) {
  return (
    <SettingsGroup title="Workspace">
      <MenuRow
        accessibilityValue={attentionAccessibilityValue(pendingCount, coverage)}
        badge={pendingBadge(pendingCount)}
        description="Permission and form requests"
        icon="inbox"
        label="Needs you"
        onPress={() => navigate("Pending")}
      />
      <MenuRow
        description="Choose projects shown in Sessions and Needs you"
        icon="folder"
        label="Followed projects"
        onPress={onFollowedProjects}
      />
      <MenuRow
        description={connectionName ?? "No connection selected"}
        icon="server"
        label="Connections"
        last
        onPress={() => navigate("Connections")}
      />
    </SettingsGroup>
  );
}

function TranscriptSettings({
  transcript,
}: {
  transcript: ReturnType<typeof useTranscriptPreferences>;
}) {
  return (
    <>
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
        <SettingsRow last>
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
    </>
  );
}

function SecuritySettings({
  appLock,
  connectionID,
  notifications,
  onPair,
}: {
  appLock: ReturnType<typeof useAppLock>;
  connectionID: string | undefined;
  notifications: ReturnType<typeof useNotificationSetting>;
  onPair: () => void;
}) {
  return (
    <>
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
            accessibilityLabel="App lock"
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

        <NotificationSettingRow
          connectionID={connectionID}
          notifications={notifications}
          onPair={onPair}
        />
      </SettingsGroup>
      {notifications.error ? (
        <Text
          accessibilityRole="alert"
          dynamicTypeRamp={typeRamp.footnote}
          style={styles.errorText}
        >
          Notification settings could not be loaded or saved.
        </Text>
      ) : null}
    </>
  );
}

function NotificationSettingRow({
  connectionID,
  notifications,
  onPair,
}: {
  connectionID: string | undefined;
  notifications: ReturnType<typeof useNotificationSetting>;
  onPair: () => void;
}) {
  const setting = { ...notifications, connectionID };
  return (
    <SettingsRow last>
      <View style={styles.settingText}>
        <SettingText
          description={notificationSettingDescription(setting)}
          title="Mobile notifications"
        />
        {offersNotificationPairing(setting) ? (
          <Button
            label="Pair notifications"
            onPress={onPair}
            size="compact"
            style={styles.inlineAction}
          />
        ) : null}
      </View>
      {notifications.loading ? (
        <ActivityIndicator
          accessibilityLabel="Loading mobile notification setting"
          color={palette.signal}
        />
      ) : (
        <Switch
          {...switchColors}
          accessibilityLabel="Mobile notifications"
          disabled={!notifications.pairing || !notifications.state || notifications.busy}
          onValueChange={(enabled) => void notifications.setEnabled(enabled)}
          value={notifications.state?.enabled ?? false}
        />
      )}
    </SettingsRow>
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
        Loading saved connections
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.stateCopy}>
        Reading the servers saved on this device.
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
  sessionTabs?: SessionTabs;
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
  const [openDetail, setOpenDetail] = useState<ShellDetail>();
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const serverName = selected?.name ?? "No server selected";
  const detailName = openDetail === "branch" ? branch?.name : serverName;
  useConnectionAnnouncement(runtime.status, connection.label, tablet || !hideConnectionBar);

  function showDetail(detail: ShellDetail) {
    setCopyState("idle");
    setOpenDetail(detail);
  }

  async function copyDetail() {
    if (!detailName) return;
    try {
      await Clipboard.setStringAsync(detailName);
      setCopyState("copied");
      AccessibilityInfo.announceForAccessibility(detailCopyAnnouncement(openDetail, true));
    } catch {
      setCopyState("error");
      AccessibilityInfo.announceForAccessibility(detailCopyAnnouncement(openDetail, false));
    }
  }

  return (
    <SafeAreaView edges={tablet ? ["top", "bottom"] : ["bottom"]} style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={[styles.shell, tablet && styles.tabletShell]}>
        {tablet ? (
          <ShellRail
            active={active}
            connection={connection}
            coverage={workspaceSelection.attentionCoverage}
            largeText={largeText}
            navigate={navigate}
            pendingCount={workspaceSelection.pendingCount}
            serverName={selected?.name}
            showConnection={!sessionTabs}
          />
        ) : null}

        <View style={styles.main}>
          {!hideConnectionBar ? (
            <ConnectionBar
              branch={branch}
              connection={connection}
              largeText={largeText}
              onShowDetail={showDetail}
              serverName={serverName}
              sessionOptions={sessionOptions}
              sessionTabs={sessionTabs}
            />
          ) : null}
          {sessionTabs && showsConnectionIssue(runtime.status) ? (
            <SessionConnectionIssue
              connection={connection}
              onPress={() => navigate("Connections")}
            />
          ) : null}
          <View style={styles.content}>{children}</View>
        </View>
      </View>
      <ShellDetailSheet
        copyState={copyState}
        detail={openDetail}
        detailName={detailName}
        onClose={() => {
          setOpenDetail(undefined);
          setCopyState("idle");
        }}
        onCopy={copyDetail}
        stale={branch?.stale}
      />
    </SafeAreaView>
  );
}

// Only a status change is announced, so each reconnect attempt does not repeat it, and only
// the focused screen speaks because the stack keeps earlier screens mounted.
function useConnectionAnnouncement(
  status: ConnectionTransportStatus,
  label: string,
  visible: boolean,
) {
  const navigation = useContext(NavigationContext);
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (visible && (navigation?.isFocused() ?? true)) announceOnIOS(label);
  }, [label, navigation, status, visible]);
}

function ShellRail({
  active,
  connection,
  coverage,
  largeText,
  navigate,
  pendingCount,
  serverName,
  showConnection,
}: {
  active: Section;
  connection: ConnectionPresentation;
  coverage: AttentionCoverage;
  largeText: boolean;
  navigate: (screen: Section) => void;
  pendingCount: number;
  serverName: string | undefined;
  showConnection: boolean;
}) {
  return (
    <View style={styles.rail}>
      <View>
        <Text dynamicTypeRamp={typeRamp.headline} style={styles.brand}>
          OpenCode
        </Text>
        {showConnection ? (
          <Text dynamicTypeRamp={typeRamp.headline} numberOfLines={2} style={styles.railConnection}>
            {serverName ?? "No server"}
          </Text>
        ) : null}
      </View>
      <View
        accessibilityLabel="Primary navigation"
        accessibilityRole="tablist"
        style={styles.railNavigation}
      >
        <NavigationItem
          active={active === "Workspace"}
          label="Sessions"
          largeText={largeText}
          onPress={() => navigate("Workspace")}
        />
        <NavigationItem
          accessibilityLabel="Needs you"
          accessibilityValue={attentionAccessibilityValue(pendingCount, coverage)}
          active={active === "Pending"}
          label={pendingLabel(pendingCount, coverage)}
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
      {showConnection ? (
        <Pressable
          accessibilityHint="Opens connections"
          accessibilityLabel={`Connection, ${connection.label}`}
          accessibilityRole="button"
          onPress={() => navigate("Connections")}
          style={({ pressed }) => [styles.railFooter, pressed && styles.branchControlPressed]}
        >
          <View style={[styles.statusDot, { backgroundColor: connection.color }]} />
          <Text dynamicTypeRamp={typeRamp.footnote} numberOfLines={1} style={styles.railStatus}>
            {connection.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ConnectionBar({
  branch,
  connection,
  largeText,
  onShowDetail,
  serverName,
  sessionOptions,
  sessionTabs,
}: {
  branch: SessionBranch | undefined;
  connection: ConnectionPresentation;
  largeText: boolean;
  onShowDetail: (detail: ShellDetail) => void;
  serverName: string;
  sessionOptions: ReactNode;
  sessionTabs: SessionTabs | undefined;
}) {
  return (
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
        <View style={[styles.locationControls, largeText && styles.locationControlsLargeText]}>
          {branch ? (
            <BranchControl
              branch={branch}
              fullWidth={largeText && !sessionOptions}
              onPress={() => onShowDetail("branch")}
            />
          ) : null}
          {sessionOptions}
        </View>
      ) : null}
      {!sessionTabs ? (
        <ServerNameControl
          branch={branch}
          largeText={largeText}
          onPress={() => onShowDetail("server")}
          serverName={serverName}
        />
      ) : null}
    </View>
  );
}

function BranchControl({
  branch,
  fullWidth,
  onPress,
}: {
  branch: SessionBranch;
  fullWidth: boolean;
  onPress: () => void;
}) {
  if (branch.state === "known" && branch.name) {
    return (
      <Pressable
        accessibilityHint="Opens details where you can copy the full branch name"
        accessibilityLabel={`Current branch, ${branch.name}${branch.stale ? ", may be outdated" : ""}`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.branchControl,
          fullWidth && styles.branchControlLargeText,
          pressed && styles.branchControlPressed,
        ]}
      >
        <BranchIcon />
        <Text
          dynamicTypeRamp={typeRamp.subheadline}
          ellipsizeMode="middle"
          numberOfLines={1}
          style={styles.branchName}
        >
          {branch.name}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.branchControl, fullWidth && styles.branchControlLargeText]}>
      <BranchIcon />
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.branchName}>
        {branchStatusLabel(branch.state)}
      </Text>
    </View>
  );
}

function BranchIcon() {
  return (
    <Feather
      accessibilityElementsHidden
      color={palette.dim}
      importantForAccessibility="no-hide-descendants"
      name="git-branch"
      size={14}
    />
  );
}

function ServerNameControl({
  branch,
  largeText,
  onPress,
  serverName,
}: {
  branch: SessionBranch | undefined;
  largeText: boolean;
  onPress: () => void;
  serverName: string;
}) {
  return (
    <Pressable
      accessibilityHint="Opens the full server name"
      accessibilityLabel={`Server, ${serverName}`}
      accessibilityRole="button"
      onPress={onPress}
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
  );
}

function SessionConnectionIssue({
  connection,
  onPress,
}: {
  connection: ConnectionPresentation;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Opens connections"
      accessibilityRole="button"
      accessibilityLabel={`Connection problem: ${connection.label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sessionConnectionIssue,
        pressed && styles.branchControlPressed,
      ]}
    >
      <Text
        accessibilityLiveRegion="polite"
        dynamicTypeRamp={typeRamp.footnote}
        style={[styles.connectionIssue, { color: connection.color }]}
      >
        {connection.label}. Check connections.
      </Text>
    </Pressable>
  );
}

function ShellDetailSheet({
  copyState,
  detail,
  detailName,
  onClose,
  onCopy,
  stale,
}: {
  copyState: CopyState;
  detail: ShellDetail | undefined;
  detailName: string | undefined;
  onClose: () => void;
  onCopy: () => Promise<void>;
  stale: boolean | undefined;
}) {
  return (
    <ModalSheet
      onClose={onClose}
      title={detail === "branch" ? "Current branch" : "Server name"}
      visible={Boolean(detail && detailName)}
    >
      <Text dynamicTypeRamp={typeRamp.body} selectable style={styles.branchDetailName}>
        {detailName}
      </Text>
      {detail === "branch" && stale ? (
        <Text
          accessibilityRole="alert"
          dynamicTypeRamp={typeRamp.subheadline}
          style={styles.branchDetailNote}
        >
          This branch may be outdated while the server reconnects.
        </Text>
      ) : null}
      <ActionButton label={detailCopyLabel(copyState, detail)} onPress={onCopy} />
    </ModalSheet>
  );
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
  accessibilityLabel,
  accessibilityValue,
  active,
  label,
  largeText,
  onPress,
}: {
  accessibilityLabel?: string;
  accessibilityValue?: string;
  active: boolean;
  label: string;
  largeText: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tab"
      accessibilityValue={accessibilityValue ? { text: accessibilityValue } : undefined}
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

const workspaceStateAnnouncements = {
  empty: undefined,
  failure: "Sessions could not be loaded. Check the connection, credentials, and network.",
  incompatible: "Server not supported. This server version does not work with the app.",
  loading: "Loading server state",
  "partial-cache": "Server state may be out of date.",
} as const;

export function WorkspaceStateCard({ state }: { state: ReturnType<typeof getWorkspaceState> }) {
  useAnnouncement(workspaceStateAnnouncements[state]);
  if (state === "loading") {
    return (
      <View accessibilityLiveRegion="polite" style={styles.stateCard}>
        <ActivityIndicator color={palette.signal} />
        <View style={styles.stateCardText}>
          <Text dynamicTypeRamp={typeRamp.headline} style={styles.cardTitle}>
            Loading server state
          </Text>
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cardCopy}>
            Waiting for the server to respond.
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
          Counts below are from the last time the app reached the server. They update when it
          reconnects.
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
          This server version does not work with the app.
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
          Sessions could not be loaded from this server.
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
        Up to date with the server.
      </Text>
    </View>
  );
}

export function ActionButton({
  accessibilityLabel,
  busy,
  disabled,
  fullWidth,
  label,
  onPress,
  secondary,
}: {
  accessibilityLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  label: string;
  onPress: () => void | Promise<void>;
  secondary?: boolean;
}) {
  return (
    <Button
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      busy={Boolean(busy)}
      disabled={Boolean(disabled)}
      fullWidth={Boolean(fullWidth)}
      label={label}
      onPress={() => void onPress()}
      style={styles.actionButton}
      variant={secondary ? "secondary" : "primary"}
    />
  );
}

const styles = StyleSheet.create({
  actionButton: { marginTop: space.md, maxWidth: "100%" },
  branchControl: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: space.xs,
    justifyContent: "center",
    marginHorizontal: space.sm,
    minHeight: minTouchTarget,
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
    minHeight: minTouchTarget,
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
  deliveryOptions: { marginTop: space.sm },
  errorText: { ...typography.footnote, color: palette.danger },
  failureCard: { ...cardSurface, borderColor: palette.danger, gap: space.xs },
  failureLabel: { ...typography.sectionLabel, color: palette.danger },
  heading: { gap: space.xs },
  inlineAction: { marginTop: space.sm },
  lede: { ...typography.subheadline, color: palette.dim, maxWidth: 620 },
  locationControls: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" },
  locationControlsLargeText: { flex: 0, width: "100%" },
  locationFailure: { ...cardSurface, gap: space.xs },
  locationPath: { ...typography.code, color: palette.ink },
  main: { flex: 1, minWidth: 0 },
  managementAction: {
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
  navigationItemActive: { backgroundColor: palette.selected },
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
  railFooter: { alignItems: "center", flexDirection: "row", minHeight: minTouchTarget },
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
  sessionConnectionIssue: {
    justifyContent: "center",
    minHeight: minTouchTarget,
    paddingHorizontal: space.md,
  },
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
