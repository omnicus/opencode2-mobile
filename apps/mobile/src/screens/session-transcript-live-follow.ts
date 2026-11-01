export type TranscriptLiveFollowEvent =
  | { type: "reset" }
  | { type: "user-scroll-begin" }
  | {
      isAtLiveEdge: boolean;
      type: "user-scroll-end";
      userScrollSessionActive: boolean;
    }
  | {
      isAtLiveEdge: boolean;
      type: "scroll";
      userScrollSessionActive: boolean;
    };

export function resolveTranscriptLiveFollow(current: boolean, event: TranscriptLiveFollowEvent) {
  switch (event.type) {
    case "reset":
      return true;
    case "user-scroll-begin":
      return false;
    case "user-scroll-end":
      return event.userScrollSessionActive ? event.isAtLiveEdge : current;
    case "scroll":
      if (event.userScrollSessionActive) return false;
      return current;
  }
}

// The live-edge glide is a critically damped spring toward offset zero, tuned against the
// OpenCode iOS app: one 22-point line peaks near 140 points per second and settles in about
// 0.33 seconds. A line that arrives mid-glide adds distance but keeps the current velocity,
// so motion continues instead of restarting from rest.
export const liveEdgeGlideRate = 17;

export function liveEdgeGlideStep(offset: number, velocity: number, elapsedMs: number) {
  "worklet";
  const t = Math.max(0, elapsedMs) / 1000;
  const decay = Math.exp(-liveEdgeGlideRate * t);
  const drive = velocity + liveEdgeGlideRate * offset;
  const next = (offset + drive * t) * decay;
  const nextVelocity = (velocity - liveEdgeGlideRate * drive * t) * decay;
  // Settle exactly on the edge; a critically damped spring never needs to cross it.
  if (next < 0.5) return { offset: 0, velocity: 0 };
  return { offset: next, velocity: nextVelocity };
}
