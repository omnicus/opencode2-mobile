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
