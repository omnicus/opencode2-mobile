import { useEffect, useState } from "react";

// Presentation only. Callers must keep transport, mutations, and permission
// state authoritative rather than using this value to enable an action.
export function useDelayedVisibility(pending: boolean, scope: string, delayMs = 1000) {
  const [shown, setShown] = useState<{ scope: string; visible: boolean }>({
    scope,
    visible: false,
  });
  useEffect(() => {
    setShown({ scope, visible: false });
    if (!pending) return;
    const timer = setTimeout(() => setShown({ scope, visible: true }), delayMs);
    return () => clearTimeout(timer);
  }, [pending, scope, delayMs]);
  return pending && shown.scope === scope && shown.visible;
}
