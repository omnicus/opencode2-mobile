import { expect, test } from "@jest/globals";

import {
  createPromptAdmission,
  markPromptAdmitted,
  markPromptCancelled,
  markPromptDeliveryUnknown,
  markPromptInterrupted,
  pendingPromptPreviews,
  promptAdmissionLabel,
  promptAdmissionNeedsOverlay,
  reconcilePromptAdmission,
} from "./prompt-admission-model";

test("pending previews merge local sends with inbox state and disappear on projection", () => {
  const admission = {
    ...createPromptAdmission(
      "steer",
      () => "preview",
      () => 10,
    ),
    previewText: "Local text",
  };
  const inbox = [
    {
      id: admission.id,
      type: "user" as const,
      sessionID: "ses_test",
      delivery: "steer" as const,
      payload: { text: "Server text" },
      time: { created: 20 },
    },
  ];
  expect(pendingPromptPreviews([admission], [], new Set())[0]).toMatchObject({
    text: "Local text",
    status: "sending",
  });
  expect(pendingPromptPreviews([admission], inbox, new Set())).toEqual([
    {
      type: "pending-prompt",
      id: admission.id,
      text: "Server text",
      status: "steering",
      createdAtMs: 10,
    },
  ]);
  expect(pendingPromptPreviews([admission], inbox, new Set([admission.id]))).toEqual([]);
});

test("inbox previews work after relaunch without persisting local text", () => {
  expect(
    pendingPromptPreviews(
      [],
      [
        {
          id: "msg_restored",
          type: "user",
          sessionID: "ses_test",
          delivery: "queue",
          payload: { text: "Restored from server" },
          time: { created: 10 },
        },
      ],
      new Set(),
    )[0],
  ).toMatchObject({ status: "queued", text: "Restored from server" });
});

test("unknown delivery remains visibly uncertain and cancelled sends disappear", () => {
  const admission = {
    ...createPromptAdmission(
      "queue",
      () => "preview",
      () => 10,
    ),
    previewText: "Pending",
  };
  expect(
    pendingPromptPreviews([markPromptDeliveryUnknown(admission)], [], new Set())[0]?.status,
  ).toBe("unknown-delivery");
  expect(pendingPromptPreviews([markPromptCancelled(admission)], [], new Set())).toEqual([]);
  expect(pendingPromptPreviews([{ ...admission, kind: "command" }], [], new Set())).toEqual([]);
});

test("multiple pending messages remain newest-first", () => {
  const first = {
    ...createPromptAdmission(
      "queue",
      () => "first",
      () => 10,
    ),
    previewText: "First",
  };
  const second = {
    ...createPromptAdmission(
      "steer",
      () => "second",
      () => 20,
    ),
    previewText: "Second",
  };
  expect(
    pendingPromptPreviews([first, second], [], new Set()).map((preview) => preview.id),
  ).toEqual([second.id, first.id]);
});

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
    kind: "prompt",
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
