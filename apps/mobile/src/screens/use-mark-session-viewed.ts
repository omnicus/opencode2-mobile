import {
  markOpenCodeSessionViewed,
  type OpenCodeClient,
  type SessionInfo,
} from "@opencode2-mobile/opencode-adapter";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

// Read state is shared by every client, so only a session the person can see marks its last
// finished run as read, as OpenCode desktop does for a focused window. A run that ends while the
// session stays open is marked when its new idle time arrives.
export function useMarkSessionViewed({
  client,
  enabled,
  session,
}: {
  client: OpenCodeClient | undefined;
  enabled: boolean;
  session: SessionInfo | undefined;
}) {
  const [foreground, setForeground] = useState(() => isForeground(AppState.currentState));
  const markedRef = useRef<string>(undefined);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(isForeground(state)),
    );
    return () => subscription.remove();
  }, []);
  const sessionID = session?.id;
  const idle = session?.time.idle;
  const viewed = session?.time.viewed;
  useEffect(() => {
    if (!client || !enabled || !foreground || !sessionID || idle === undefined) return;
    if (viewed !== undefined && viewed >= idle) return;
    const key = `${sessionID}\u0000${idle}`;
    if (markedRef.current === key) return;
    markedRef.current = key;
    void markOpenCodeSessionViewed(client, sessionID, idle).catch(() => {
      // Let a later render try again.
      if (markedRef.current === key) markedRef.current = undefined;
    });
  }, [client, enabled, foreground, idle, sessionID, viewed]);
}

// The first state can be "unknown" before the app reports one, which still means visible.
function isForeground(state: unknown) {
  return state !== "background" && state !== "inactive";
}
