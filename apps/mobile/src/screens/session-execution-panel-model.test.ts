import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import type { SessionInboxInfo } from "@opencode2-mobile/opencode-adapter";

import type { PromptAdmission } from "./prompt-admission-model";
import {
  boundedPromptPreview,
  executionPanelItems,
  inboxTypeLabel,
  nextInboxDeadlines,
  nextPromptCardDeadline,
  queuedInboxIds,
} from "./session-execution-panel-model";

beforeEach(() => {
  jest.useFakeTimers({ now: 10_000 });
});
afterEach(() => {
  jest.useRealTimers();
});

function inboxItem(id: string, delivery: "queue" | "steer" = "queue"): SessionInboxInfo {
  return {
    id,
    type: "user",
    sessionID: "ses_test",
    delivery,
    payload: { text: id },
    time: { created: 1 },
  };
}

function admission(overrides: Partial<PromptAdmission> = {}): PromptAdmission {
  return {
    id: "msg_admission",
    kind: "prompt",
    durable: false,
    status: "submitting",
    submittedAtMs: 1,
    ...overrides,
  };
}

test("labels every inbox item type", () => {
  expect(
    (["user", "synthetic", "compaction", "move"] as const).map((type) =>
      inboxTypeLabel({ ...inboxItem("msg"), type } as SessionInboxInfo),
    ),
  ).toEqual(["Prompt", "System input", "Compaction", "Move"]);
});

test("bounds long prompt previews", () => {
  expect(boundedPromptPreview("short")).toBe("short");
  expect(boundedPromptPreview("x".repeat(2_000))).toBe("x".repeat(2_000));
  expect(boundedPromptPreview("x".repeat(2_001))).toBe(`${"x".repeat(2_000)}\n...`);
});

test("only queued, unprojected user prompts get card deadlines", () => {
  const ids = queuedInboxIds(
    [
      inboxItem("msg_queued"),
      inboxItem("msg_steer", "steer"),
      inboxItem("msg_projected"),
      { ...inboxItem("msg_synthetic"), type: "synthetic" } as SessionInboxInfo,
    ],
    new Set(["msg_projected"]),
  );
  expect(ids).toEqual(["msg_queued"]);
});

test("keeps existing inbox deadlines and adds new ones after the card delay", () => {
  const current = new Map([["msg_a", 2_000]]);
  expect(nextInboxDeadlines(current, ["msg_a"])).toBe(current);
  expect([...nextInboxDeadlines(current, ["msg_a", "msg_b"])]).toEqual([
    ["msg_a", 2_000],
    ["msg_b", 10_500],
  ]);
  expect([...nextInboxDeadlines(current, ["msg_b"])]).toEqual([["msg_b", 10_500]]);
  expect(nextInboxDeadlines(current, [])).toEqual(new Map());
});

test("the next refresh is the earliest future deadline of an unsettled card", () => {
  const input = {
    inboxDeadlines: new Map([["msg_inbox", 10_700]]),
    now: 10_000,
    projectedMessageIds: new Set(["msg_projected"]),
  };
  expect(
    nextPromptCardDeadline({
      ...input,
      admissions: [
        admission({ id: "msg_new", submittedAtMs: 10_300 }),
        admission({ id: "msg_old", submittedAtMs: 9_000 }),
        admission({ id: "msg_unknown", status: "unknown-delivery", submittedAtMs: 9_900 }),
        admission({ id: "msg_cancelled", status: "cancelled", submittedAtMs: 9_900 }),
        admission({ id: "msg_completed", status: "completed", submittedAtMs: 9_900 }),
        admission({ id: "msg_projected", submittedAtMs: 9_900 }),
      ],
    }),
  ).toBe(10_700);
  expect(
    nextPromptCardDeadline({
      ...input,
      admissions: [admission({ id: "msg_soon", submittedAtMs: 9_600 })],
    }),
  ).toBe(10_100);
  expect(
    nextPromptCardDeadline({ ...input, admissions: [], inboxDeadlines: new Map() }),
  ).toBeUndefined();
});

test("shows queued cards and sending only after an admission settles", () => {
  const base = {
    inbox: [inboxItem("msg_queued"), inboxItem("msg_pending"), inboxItem("msg_settling")],
    inboxDeadlines: new Map([
      ["msg_queued", 9_000],
      ["msg_settling", 9_000],
    ]),
    now: 10_000,
    projectedMessageIds: new Set<string>(),
  };
  const settled = executionPanelItems({
    ...base,
    admissions: [
      admission({ id: "msg_settling", status: "queued", submittedAtMs: 9_800 }),
      admission({ id: "msg_send", submittedAtMs: 9_000 }),
      admission({ id: "msg_unknown", status: "unknown-delivery", submittedAtMs: 9_900 }),
      admission({ id: "msg_queued", status: "unknown-delivery" }),
      admission({ id: "msg_done", status: "completed" }),
    ],
  });
  expect(settled.promptInbox.map((item) => item.id)).toEqual(["msg_queued"]);
  expect(settled.localOverlays.map((item) => item.id)).toEqual(["msg_unknown"]);
  expect(settled.sending).toBe(true);

  expect(
    executionPanelItems({
      ...base,
      admissions: [admission({ id: "msg_send", submittedAtMs: 9_800 })],
    }).sending,
  ).toBe(false);
  expect(
    executionPanelItems({
      ...base,
      admissions: [admission({ id: "msg_queued" })],
    }).sending,
  ).toBe(false);
  expect(
    executionPanelItems({
      ...base,
      admissions: [admission({ id: "msg_send" })],
      projectedMessageIds: new Set(["msg_send"]),
    }).sending,
  ).toBe(false);
});
