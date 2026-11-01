import { applicationName } from "../application-name";

export type TranscriptProjectionFrameSample = {
  cacheWrites: number;
  durationMs: number;
  eventCount: number;
  reconciliations: number;
};

export type TranscriptPerformanceMetrics = {
  explicitLatestJumps: number;
  followCorrections: number;
  maxProjectionDurationMs: number;
  maxProjectionEventsPerFrame: number;
  maxResidentMessages: number;
  maxResidentPages: number;
  maxRowCommitsPerFrame: number;
  projectionCacheWrites: number;
  projectionEvents: number;
  projectionFrames: number;
  projectionReconciliations: number;
  rowCommitFrames: number;
  rowCommits: number;
};

const emptyMetrics = (): TranscriptPerformanceMetrics => ({
  explicitLatestJumps: 0,
  followCorrections: 0,
  maxProjectionDurationMs: 0,
  maxProjectionEventsPerFrame: 0,
  maxResidentMessages: 0,
  maxResidentPages: 0,
  maxRowCommitsPerFrame: 0,
  projectionCacheWrites: 0,
  projectionEvents: 0,
  projectionFrames: 0,
  projectionReconciliations: 0,
  rowCommitFrames: 0,
  rowCommits: 0,
});

let metrics = emptyMetrics();
let pendingRowCommits = 0;
let rowFrameScheduled = false;
let rowFrameHandle: number | undefined;
let generation = 0;

export function resetTranscriptPerformanceMetrics() {
  if (rowFrameHandle !== undefined) cancelAnimationFrame(rowFrameHandle);
  generation += 1;
  metrics = emptyMetrics();
  pendingRowCommits = 0;
  rowFrameScheduled = false;
  rowFrameHandle = undefined;
}

export function recordTranscriptProjectionFrame(sample: TranscriptProjectionFrameSample) {
  metrics.projectionFrames += 1;
  metrics.projectionEvents += sample.eventCount;
  metrics.projectionCacheWrites += sample.cacheWrites;
  metrics.projectionReconciliations += sample.reconciliations;
  metrics.maxProjectionEventsPerFrame = Math.max(
    metrics.maxProjectionEventsPerFrame,
    sample.eventCount,
  );
  metrics.maxProjectionDurationMs = Math.max(
    metrics.maxProjectionDurationMs,
    Math.max(0, sample.durationMs),
  );
}

export function recordTranscriptRowCommit(schedule?: (callback: () => void) => void) {
  metrics.rowCommits += 1;
  pendingRowCommits += 1;
  if (rowFrameScheduled) return;
  rowFrameScheduled = true;
  const scheduledGeneration = generation;
  const commitFrame = () => {
    if (scheduledGeneration !== generation) return;
    rowFrameHandle = undefined;
    rowFrameScheduled = false;
    metrics.rowCommitFrames += 1;
    metrics.maxRowCommitsPerFrame = Math.max(metrics.maxRowCommitsPerFrame, pendingRowCommits);
    pendingRowCommits = 0;
  };
  if (schedule) schedule(commitFrame);
  else rowFrameHandle = requestAnimationFrame(commitFrame);
}

export function recordTranscriptResidentSet(pageCount: number, messageCount: number) {
  metrics.maxResidentPages = Math.max(metrics.maxResidentPages, Math.max(0, pageCount));
  metrics.maxResidentMessages = Math.max(metrics.maxResidentMessages, Math.max(0, messageCount));
}

export function recordTranscriptFollowCorrection() {
  metrics.followCorrections += 1;
}

export function recordTranscriptLatestJump() {
  metrics.explicitLatestJumps += 1;
}

export function getTranscriptPerformanceMetrics() {
  return { ...metrics };
}

export function formatTranscriptPerformanceDiagnostics(snapshot: TranscriptPerformanceMetrics) {
  return [
    `${applicationName} redacted transcript performance`,
    "content_included=false",
    `projection_frames=${snapshot.projectionFrames}`,
    `projection_events=${snapshot.projectionEvents}`,
    `projection_cache_writes=${snapshot.projectionCacheWrites}`,
    `projection_reconciliations=${snapshot.projectionReconciliations}`,
    `max_projection_events_per_frame=${snapshot.maxProjectionEventsPerFrame}`,
    `max_projection_duration_ms=${snapshot.maxProjectionDurationMs.toFixed(3)}`,
    `row_commits=${snapshot.rowCommits}`,
    `row_commit_frames=${snapshot.rowCommitFrames}`,
    `max_row_commits_per_frame=${snapshot.maxRowCommitsPerFrame}`,
    `max_resident_pages=${snapshot.maxResidentPages}`,
    `max_resident_messages=${snapshot.maxResidentMessages}`,
    `follow_corrections=${snapshot.followCorrections}`,
    `explicit_latest_jumps=${snapshot.explicitLatestJumps}`,
  ].join("\n");
}
