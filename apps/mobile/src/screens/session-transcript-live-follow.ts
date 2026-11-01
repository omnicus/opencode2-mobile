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

// Time constant of the live-edge glide. Each frame closes the same share of the remaining
// distance, so a line arriving mid-glide lengthens it without restarting from rest.
export const liveEdgeGlideMs = 90;

export function liveEdgeGlideOffset(offset: number, elapsedMs: number) {
  "worklet";
  const next = offset * Math.exp(-Math.max(0, elapsedMs) / liveEdgeGlideMs);
  return next < 0.5 ? 0 : next;
}
