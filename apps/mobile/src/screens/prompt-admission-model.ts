import * as Crypto from "expo-crypto";

export type PromptDelivery = "queue" | "steer";
export type PromptAdmissionKind = "command" | "prompt";

export type PromptAdmissionStatus =
  | "submitting"
  | "admitted"
  | "queued"
  | "steered"
  | "promoted"
  | "executing"
  | "cancelled"
  | "completed"
  | "unknown-delivery";

export type PromptAdmission = {
  confirmationHandled?: boolean;
  delivery?: PromptDelivery;
  draftRevision?: number;
  durable: boolean;
  id: string;
  kind: PromptAdmissionKind;
  retryOffered?: boolean;
  serverAdmittedAtMs?: number;
  status: PromptAdmissionStatus;
  submittedAtMs: number;
};

export type PromptAdmissionObservation = {
  inboxDelivery?: PromptDelivery;
  messageProjected: boolean;
  serverAdmittedAtMs?: number;
  sessionIdleAtMs?: number;
  sessionOutcome?: "failed" | "interrupted" | "succeeded";
  sessionRunning: boolean;
};

export function createPromptAdmission(
  delivery?: PromptDelivery,
  randomUUID: () => string = Crypto.randomUUID,
  now: () => number = Date.now,
): PromptAdmission {
  return {
    ...(delivery ? { delivery } : {}),
    durable: false,
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    kind: "prompt",
    status: "submitting",
    submittedAtMs: now(),
  };
}

export function markPromptAdmitted(
  admission: PromptAdmission,
  delivery: PromptDelivery,
  serverAdmittedAtMs?: number,
): PromptAdmission {
  const next = transitionAdmission(admission, "admitted", true, delivery);
  if (serverAdmittedAtMs === undefined || next.serverAdmittedAtMs === serverAdmittedAtMs) {
    return next;
  }
  return { ...next, serverAdmittedAtMs };
}

export function markPromptDeliveryUnknown(admission: PromptAdmission): PromptAdmission {
  return transitionAdmission(admission, "unknown-delivery", admission.durable);
}

export function markPromptCancelled(admission: PromptAdmission): PromptAdmission {
  return transitionAdmission(admission, "cancelled", admission.durable);
}

export function markPromptConfirmationHandled(admission: PromptAdmission): PromptAdmission {
  return admission.confirmationHandled ? admission : { ...admission, confirmationHandled: true };
}

export function markPromptRetryOffered(admission: PromptAdmission): PromptAdmission {
  return admission.retryOffered ? admission : { ...admission, retryOffered: true };
}

export function markPromptInterrupted(admission: PromptAdmission): PromptAdmission {
  if (admission.status !== "executing" && admission.status !== "promoted") return admission;
  return transitionAdmission(admission, "cancelled", admission.durable);
}

export function reconcilePromptAdmission(
  admission: PromptAdmission,
  observation: PromptAdmissionObservation,
): PromptAdmission {
  const current =
    observation.serverAdmittedAtMs === undefined ||
    admission.serverAdmittedAtMs === observation.serverAdmittedAtMs
      ? admission
      : { ...admission, serverAdmittedAtMs: observation.serverAdmittedAtMs };
  if (current.status === "cancelled" || current.status === "completed") return current;
  if (observation.inboxDelivery) {
    return transitionAdmission(
      current,
      observation.inboxDelivery === "queue" ? "queued" : "steered",
      true,
      observation.inboxDelivery,
    );
  }
  if (observation.messageProjected) {
    if (observation.sessionRunning) {
      return transitionAdmission(current, "executing", true);
    }
    if (
      observation.sessionOutcome &&
      observation.sessionIdleAtMs !== undefined &&
      current.serverAdmittedAtMs !== undefined &&
      observation.sessionIdleAtMs >= current.serverAdmittedAtMs
    ) {
      return transitionAdmission(
        current,
        observation.sessionOutcome === "interrupted" ? "cancelled" : "completed",
        true,
      );
    }
    if (current.status === "executing") {
      return transitionAdmission(current, "completed", true);
    }
    return transitionAdmission(current, "promoted", true);
  }
  if (current.status === "executing" && !observation.sessionRunning) {
    return transitionAdmission(current, "completed", current.durable);
  }
  return current;
}

function transitionAdmission(
  admission: PromptAdmission,
  status: PromptAdmissionStatus,
  durable: boolean,
  delivery = admission.delivery,
) {
  if (
    admission.status === status &&
    admission.durable === durable &&
    admission.delivery === delivery
  ) {
    return admission;
  }
  return { ...admission, ...(delivery ? { delivery } : {}), durable, status };
}

export function promptAdmissionNeedsOverlay(admission: PromptAdmission, messageProjected: boolean) {
  return !messageProjected && admission.status !== "cancelled" && admission.status !== "completed";
}

export function promptAdmissionLabel(status: PromptAdmissionStatus) {
  switch (status) {
    case "submitting":
      return "Sending";
    case "admitted":
      return "Admitted";
    case "queued":
      return "Queued";
    case "steered":
      return "Steering";
    case "promoted":
      return "Starting";
    case "executing":
      return "Executing";
    case "cancelled":
      return "Cancelled";
    case "completed":
      return "Completed";
    case "unknown-delivery":
      return "Delivery unknown";
  }
}
