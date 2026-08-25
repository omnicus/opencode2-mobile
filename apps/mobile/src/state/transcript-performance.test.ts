import { expect, test } from "@jest/globals";

import {
  formatTranscriptPerformanceDiagnostics,
  getTranscriptPerformanceMetrics,
  recordTranscriptFollowCorrection,
  recordTranscriptLatestJump,
  recordTranscriptProjectionFrame,
  recordTranscriptResidentSet,
  recordTranscriptRowCommit,
  resetTranscriptPerformanceMetrics,
} from "./transcript-performance";

test("collects bounded content-free transcript performance counters", () => {
  const scheduled: Array<() => void> = [];
  resetTranscriptPerformanceMetrics();
  recordTranscriptProjectionFrame({
    cacheWrites: 1,
    durationMs: 2.125,
    eventCount: 40,
    reconciliations: 0,
  });
  recordTranscriptProjectionFrame({
    cacheWrites: 1,
    durationMs: 1,
    eventCount: 4,
    reconciliations: 1,
  });
  recordTranscriptRowCommit((callback) => scheduled.push(callback));
  recordTranscriptRowCommit((callback) => scheduled.push(callback));
  recordTranscriptResidentSet(2, 70);
  recordTranscriptResidentSet(1, 40);
  recordTranscriptFollowCorrection();
  recordTranscriptLatestJump();
  expect(scheduled).toHaveLength(1);
  scheduled[0]?.();

  const snapshot = getTranscriptPerformanceMetrics();
  expect(snapshot).toMatchObject({
    explicitLatestJumps: 1,
    followCorrections: 1,
    maxProjectionDurationMs: 2.125,
    maxProjectionEventsPerFrame: 40,
    maxResidentMessages: 70,
    maxResidentPages: 2,
    maxRowCommitsPerFrame: 2,
    projectionCacheWrites: 2,
    projectionEvents: 44,
    projectionFrames: 2,
    projectionReconciliations: 1,
    rowCommitFrames: 1,
    rowCommits: 2,
  });
  expect(formatTranscriptPerformanceDiagnostics(snapshot)).toContain(
    "max_projection_duration_ms=2.125",
  );
  expect(formatTranscriptPerformanceDiagnostics(snapshot)).toContain("content_included=false");
});

test("discards row-frame work queued before a connection reset", () => {
  const scheduled: Array<() => void> = [];
  resetTranscriptPerformanceMetrics();
  recordTranscriptRowCommit((callback) => scheduled.push(callback));
  resetTranscriptPerformanceMetrics();
  scheduled[0]?.();

  expect(getTranscriptPerformanceMetrics()).toMatchObject({
    maxRowCommitsPerFrame: 0,
    rowCommitFrames: 0,
    rowCommits: 0,
  });
});
