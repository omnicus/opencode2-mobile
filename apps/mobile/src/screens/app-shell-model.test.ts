import { expect, test } from "@jest/globals";

import type { AttentionCoverage } from "../state/followed-projects-model";
import {
  affectedProjectsText,
  allKnownLocationsFailed,
  branchStatusLabel,
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
} from "./app-shell-model";

const coverage: AttentionCoverage = {
  completeness: "complete",
  failedLocationCount: 0,
  failedLocations: [],
  failedProjects: [],
  freshness: "current",
  knownLocationCount: 3,
  reasons: [],
  reconciledLocationCount: 2,
  revision: 1,
};

const pairing = {
  bindingID: "binding-1",
  brokerOrigin: "https://broker.test",
} as never;

test("labels the Needs you tab by count, completeness, and freshness", () => {
  expect(pendingLabel(0, coverage)).toBe("Needs you");
  expect(pendingLabel(2, coverage)).toBe("Needs you 2");
  expect(pendingLabel(2, { ...coverage, completeness: "incomplete" })).toBe("Needs you 2+");
  expect(pendingLabel(0, { ...coverage, freshness: "reconciling" })).toBe("Needs you, checking");
  expect(pendingLabel(0, { ...coverage, freshness: "stale" })).toBe("Needs you");
});

test("titles the summary and caps the menu badge", () => {
  expect(pendingSummaryTitle(0, true)).toBe("Nothing needs you");
  expect(pendingSummaryTitle(0, false)).toBe("Nothing found that needs you");
  expect(pendingSummaryTitle(1, true)).toBe("1 request");
  expect(pendingSummaryTitle(2, false)).toBe("At least 2 requests");
  expect(pendingBadge(0)).toBeUndefined();
  expect(pendingBadge(-1)).toBeUndefined();
  expect(pendingBadge(1)).toBe("1");
  expect(pendingBadge(99)).toBe("99");
  expect(pendingBadge(100)).toBe("99+");
});

test("describes attention coverage freshness", () => {
  expect(pendingCoverageLabel({ ...coverage, freshness: "stale" })).toBe(
    "Last checked across 3 locations.",
  );
  expect(pendingCoverageLabel({ ...coverage, freshness: "reconciling" })).toBe(
    "Checking 2 of 3 locations.",
  );
  expect(pendingCoverageLabel(coverage)).toBe("Checked 2 locations.");
  expect(pendingCoverageLabel({ ...coverage, completeness: "incomplete" })).toBe(
    "Checked 2 of 3 locations.",
  );
});

test("summarizes failed locations and affected projects", () => {
  expect(locationFailureTitle(1)).toBe("1 location could not be checked.");
  expect(locationFailureTitle(2)).toBe("2 locations could not be checked.");
  expect(respondedLocationsText(1)).toBe(
    "No requests were found at the 1 location that responded.",
  );
  expect(respondedLocationsText(4)).toBe(
    "No requests were found at the 4 locations that responded.",
  );
  expect(allKnownLocationsFailed({ ...coverage, reconciledLocationCount: 0 })).toBe(true);
  expect(allKnownLocationsFailed(coverage)).toBe(false);
  expect(
    allKnownLocationsFailed({ ...coverage, knownLocationCount: 0, reconciledLocationCount: 0 }),
  ).toBe(false);
  expect(affectedProjectsText([])).toBe("The affected project could not be identified. ");
  expect(affectedProjectsText(undefined as never)).toBe(
    "The affected project could not be identified. ",
  );
  expect(affectedProjectsText([{ label: "Alpha", locationCount: 1 }])).toBe(
    "Affected project: Alpha. ",
  );
  expect(
    affectedProjectsText([
      { label: "Alpha", locationCount: 1 },
      { label: "Beta", locationCount: 2 },
    ]),
  ).toBe("Affected projects: Alpha, Beta. ");
});

test("names where a failed location came from", () => {
  expect(locationSourceLabel("project-root")).toBe("Project root");
  expect(locationSourceLabel("worktree")).toBe("Registered worktree");
  expect(locationSourceLabel("session-history")).toBe("Referenced by session history");
  expect(locationSourceLabel("discovered")).toBe("Discovered location");
  const failure = {
    failedChecks: ["forms" as const],
    location: { directory: "/a" },
    projectLabel: "Alpha",
  };
  expect(hasMovableLocationFailure([])).toBe(false);
  expect(hasMovableLocationFailure([{ ...failure, source: "project-root" }])).toBe(false);
  expect(hasMovableLocationFailure([{ ...failure, source: "worktree" }])).toBe(true);
  expect(hasMovableLocationFailure([{ ...failure, source: "session-history" }])).toBe(true);
});

test("describes the notification setting and when to offer pairing", () => {
  const connectionID = "connection-1";
  expect(
    notificationSettingDescription({ connectionID, loading: true, pairing, state: undefined }),
  ).toBe("Checking notification status.");
  expect(
    notificationSettingDescription({
      connectionID: undefined,
      loading: false,
      pairing: undefined,
      state: undefined,
    }),
  ).toBe("Choose a connection to set up notifications.");
  expect(
    notificationSettingDescription({
      connectionID,
      loading: false,
      pairing: undefined,
      state: undefined,
    }),
  ).toBe("Pair this connection to get notifications for new requests.");
  expect(
    notificationSettingDescription({
      connectionID,
      loading: false,
      pairing,
      state: { enabled: true } as never,
    }),
  ).toBe("On for every phone paired with this connection.");
  expect(
    notificationSettingDescription({
      connectionID,
      loading: false,
      pairing,
      state: { enabled: false } as never,
    }),
  ).toBe("Paused. New requests will not create mobile notifications.");
  expect(
    notificationSettingDescription({ connectionID, loading: false, pairing, state: undefined }),
  ).toBe("Notification status is unavailable.");

  expect(offersNotificationPairing({ connectionID, loading: false, pairing: undefined })).toBe(
    true,
  );
  expect(offersNotificationPairing({ connectionID, loading: true, pairing: undefined })).toBe(
    false,
  );
  expect(
    offersNotificationPairing({ connectionID: undefined, loading: false, pairing: undefined }),
  ).toBe(false);
  expect(offersNotificationPairing({ connectionID: "", loading: false, pairing: undefined })).toBe(
    false,
  );
  expect(offersNotificationPairing({ connectionID, loading: false, pairing })).toBe(false);
});

test("labels branch states and detail copy actions", () => {
  expect(branchStatusLabel("loading")).toBe("Checking branch");
  expect(branchStatusLabel("none")).toBe("No branch");
  expect(branchStatusLabel("unavailable")).toBe("Branch unavailable");
  expect(branchStatusLabel("known")).toBe("Branch unavailable");
  expect(detailCopyLabel("copied", "branch")).toBe("Copied");
  expect(detailCopyLabel("error", "server")).toBe("Try copying again");
  expect(detailCopyLabel("idle", "branch")).toBe("Copy branch name");
  expect(detailCopyLabel("idle", "server")).toBe("Copy server name");
  expect(detailCopyAnnouncement("branch", true)).toBe("Branch name copied");
  expect(detailCopyAnnouncement("server", true)).toBe("Server name copied");
  expect(detailCopyAnnouncement("branch", false)).toBe("Branch name could not be copied");
  expect(detailCopyAnnouncement(undefined, false)).toBe("Server name could not be copied");
});
