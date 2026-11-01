import type { NotificationDeliveryState } from "@opencode2-mobile/notification-protocol";
import type { NotificationPairing } from "../notifications/notification-pairing-repository";
import type { AttentionCoverage } from "../state/followed-projects-model";

type LocationFailure = AttentionCoverage["failedLocations"][number];
export type ShellDetail = "branch" | "server";
export type CopyState = "copied" | "error" | "idle";

export function pendingLabel(
  count: number,
  coverage: Pick<AttentionCoverage, "completeness" | "freshness">,
) {
  if (count > 0) return `Needs you ${count}${coverage.completeness === "complete" ? "" : "+"}`;
  return coverage.freshness === "reconciling" ? "Needs you, checking" : "Needs you";
}

export function pendingSummaryTitle(count: number, complete: boolean) {
  if (count === 0) return complete ? "Nothing needs you" : "Nothing found that needs you";
  const requests = `${count} ${count === 1 ? "request" : "requests"}`;
  return complete ? requests : `At least ${requests}`;
}

export function pendingBadge(count: number) {
  if (count <= 0) return undefined;
  return count > 99 ? "99+" : `${count}`;
}

export function pendingCoverageLabel(coverage: AttentionCoverage) {
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

export function locationFailureTitle(count: number) {
  return `${count} ${count === 1 ? "location" : "locations"} could not be checked.`;
}

export function allKnownLocationsFailed(coverage: AttentionCoverage) {
  return coverage.knownLocationCount > 0 && coverage.reconciledLocationCount === 0;
}

export function affectedProjectsText(failedProjects: AttentionCoverage["failedProjects"]) {
  const summary = (failedProjects ?? []).map((project) => project.label).join(", ");
  if (!summary) return "The affected project could not be identified. ";
  return `Affected ${failedProjects.length === 1 ? "project" : "projects"}: ${summary}. `;
}

export function respondedLocationsText(count: number) {
  return `No requests were found at the ${count} ${count === 1 ? "location" : "locations"} that responded.`;
}

export function hasMovableLocationFailure(failures: LocationFailure[]) {
  return failures.some(
    (failure) => failure.source === "session-history" || failure.source === "worktree",
  );
}

const locationSourceLabels: Partial<Record<LocationFailure["source"], string>> = {
  "project-root": "Project root",
  "session-history": "Referenced by session history",
  worktree: "Registered worktree",
};

export function locationSourceLabel(source: LocationFailure["source"]) {
  return locationSourceLabels[source] ?? "Discovered location";
}

type NotificationSetting = {
  connectionID: string | undefined;
  loading: boolean;
  pairing: NotificationPairing | undefined;
  state: NotificationDeliveryState | undefined;
};

export function notificationSettingDescription({
  connectionID,
  loading,
  pairing,
  state,
}: NotificationSetting) {
  if (loading) return "Checking notification status.";
  if (!connectionID) return "Choose a connection to set up notifications.";
  if (!pairing) return "Pair this connection to get notifications for new requests.";
  if (state?.enabled) return "On for every phone paired with this connection.";
  if (state) return "Paused. New requests will not create mobile notifications.";
  return "Notification status is unavailable.";
}

export function offersNotificationPairing({
  connectionID,
  loading,
  pairing,
}: Omit<NotificationSetting, "state">) {
  return !loading && Boolean(connectionID) && !pairing;
}

export function branchStatusLabel(state: "known" | "loading" | "none" | "unavailable") {
  if (state === "loading") return "Checking branch";
  if (state === "none") return "No branch";
  return "Branch unavailable";
}

export function detailCopyLabel(copyState: CopyState, detail: ShellDetail | undefined) {
  if (copyState === "copied") return "Copied";
  if (copyState === "error") return "Try copying again";
  return detail === "branch" ? "Copy branch name" : "Copy server name";
}

export function detailCopyAnnouncement(detail: ShellDetail | undefined, copied: boolean) {
  const subject = detail === "branch" ? "Branch name" : "Server name";
  return copied ? `${subject} copied` : `${subject} could not be copied`;
}
