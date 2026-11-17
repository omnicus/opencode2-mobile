import type { LocationRef } from "@opencode2-mobile/opencode-adapter";
import { useEffect, useRef } from "react";

import {
  type ComposerMention,
  type ComposerSubmitIntent,
  resolveComposerSubmitIntent,
} from "./session-composer-model";

type HandedOffDraft = { draft: string; loaded: boolean; mentions: ComposerMention[] };
type HandedOffExecution = {
  commands: Parameters<typeof resolveComposerSubmitIntent>[1];
  completionLoading: boolean;
  submit: (text: string, intent?: ComposerSubmitIntent) => void;
  submitDisabled: boolean;
};

// The new-session screen hands its first message over as this session's draft. Send it once
// the session can take a prompt; a failed send leaves it in the composer like any other draft.
export function useSendHandedOffDraft({
  draft,
  enabled,
  execution,
  location,
  onSent,
  ready,
}: {
  draft: HandedOffDraft;
  enabled: boolean;
  execution: HandedOffExecution;
  location: LocationRef;
  onSent: () => void;
  ready: boolean;
}) {
  const sentRef = useRef(false);
  const latestRef = useRef({ draft, execution, location, onSent });
  latestRef.current = { draft, execution, location, onSent };
  // Slash commands resolve against the command list, so wait for it before sending.
  const canSend =
    enabled && ready && draft.loaded && !execution.submitDisabled && !execution.completionLoading;
  useEffect(() => {
    if (!canSend || sentRef.current) return;
    sentRef.current = true;
    const latest = latestRef.current;
    latest.onSent();
    const text = latest.draft.draft;
    if (!text.trim()) return;
    latest.execution.submit(
      text,
      resolveComposerSubmitIntent(
        text,
        latest.execution.commands,
        latest.draft.mentions,
        latest.location,
      ),
    );
  }, [canSend]);
}
