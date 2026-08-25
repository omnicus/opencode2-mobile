import { expect, test } from "@jest/globals";

import {
  createPromptAdmission,
  markPromptAdmitted,
  markPromptCancelled,
  markPromptDeliveryUnknown,
  markPromptInterrupted,
  promptAdmissionLabel,
  promptAdmissionNeedsOverlay,
  reconcilePromptAdmission,
} from "./prompt-admission-model";

test("creates a stable caller-owned message ID before transmission", () => {
  const admission = createPromptAdmission(
    "queue",
    () => "12345678-1234-4234-8234-123456789abc",
    () => 42,
  );

  expect(admission).toEqual({
    delivery: "queue",
    durable: false,
    id: "msg_12345678123442348234123456789abc",
    status: "submitting",
    submittedAtMs: 42,
  });
});

test("keeps a failed submission unknown until server state identifies it", () => {
  const submitting = createPromptAdmission(
    undefined,
    () => "admission",
    () => 1,
  );
  const unknown = markPromptDeliveryUnknown(submitting);

  expect(unknown.status).toBe("unknown-delivery");
  expect(
    reconcilePromptAdmission(unknown, {
      messageProjected: false,
      sessionRunning: false,
    }),
  ).toBe(unknown);
  expect(promptAdmissionNeedsOverlay(unknown, false)).toBe(true);
});

test("tracks durable inbox delivery independently from projection and execution", () => {
  const submitting = createPromptAdmission(
    "queue",
    () => "admission",
    () => 1,
  );
  const admitted = markPromptAdmitted(submitting, "queue");
  const queued = reconcilePromptAdmission(admitted, {
    inboxDelivery: "queue",
    messageProjected: false,
    sessionRunning: true,
  });
  const steered = reconcilePromptAdmission(queued, {
    inboxDelivery: "steer",
    messageProjected: false,
    sessionRunning: true,
  });
  const promoted = reconcilePromptAdmission(steered, {
    messageProjected: true,
    sessionRunning: false,
  });
  const executing = reconcilePromptAdmission(promoted, {
    messageProjected: true,
    sessionRunning: true,
  });
  const completed = reconcilePromptAdmission(executing, {
    messageProjected: true,
    sessionRunning: false,
  });

  expect([
    admitted.status,
    queued.status,
    steered.status,
    promoted.status,
    executing.status,
  ]).toEqual(["admitted", "queued", "steered", "promoted", "executing"]);
  expect(completed.status).toBe("completed");
  expect(promptAdmissionNeedsOverlay(promoted, true)).toBe(false);
});

test("cancels inbox work and only marks promoted or executing work interrupted", () => {
  const admitted = markPromptAdmitted(
    createPromptAdmission(
      "steer",
      () => "admission",
      () => 1,
    ),
    "steer",
  );
  const promoted = reconcilePromptAdmission(admitted, {
    messageProjected: true,
    sessionRunning: false,
  });

  expect(markPromptCancelled(admitted).status).toBe("cancelled");
  expect(markPromptInterrupted(promoted).status).toBe("cancelled");
  expect(markPromptInterrupted(admitted)).toBe(admitted);
  expect(promptAdmissionLabel("unknown-delivery")).toBe("Delivery unknown");
});

test("recovers terminal execution state from authoritative session metadata", () => {
  const admission = markPromptAdmitted(
    createPromptAdmission(
      "queue",
      () => "admission",
      () => 100,
    ),
    "queue",
    100,
  );

  expect(
    reconcilePromptAdmission(admission, {
      messageProjected: true,
      sessionIdleAtMs: 120,
      sessionOutcome: "succeeded",
      sessionRunning: false,
    }).status,
  ).toBe("completed");
  expect(
    reconcilePromptAdmission(admission, {
      messageProjected: true,
      sessionIdleAtMs: 120,
      sessionOutcome: "interrupted",
      sessionRunning: false,
    }).status,
  ).toBe("cancelled");
  expect(
    reconcilePromptAdmission(admission, {
      messageProjected: true,
      sessionIdleAtMs: 99,
      sessionOutcome: "succeeded",
      sessionRunning: false,
    }).status,
  ).toBe("promoted");
});
