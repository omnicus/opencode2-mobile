import { expect, jest, test } from "@jest/globals";
import type { SessionInboxInfo, SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";

import type { PromptAdmission } from "./prompt-admission-model";
import {
  applyInboxAction,
  classifySubmissionFailure,
  commandSubmissionInput,
  currentAdmissionRevision,
  hasUnresolvedAdmission,
  mentionableAgents,
  modelRef,
  primaryAgents,
  promptSubmissionInput,
  type RestoredAdmissionState,
  reconcileRestoredAdmission,
  selectableModels,
  sessionObservation,
  unresolvedPromptAdmission,
} from "./session-execution-model";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  classifyOpenCodeError: (error: unknown) =>
    typeof error === "object" && error !== null && "kind" in error ? error.kind : "UNREACHABLE",
}));

const idleSession = { active: false, idleAtMs: undefined, outcome: undefined };

function admission(overrides: Partial<PromptAdmission> = {}): PromptAdmission {
  return {
    durable: false,
    id: "msg_a",
    kind: "prompt",
    status: "submitting",
    submittedAtMs: 1,
    ...overrides,
  };
}

function inboxItem(id: string, delivery: "queue" | "steer"): SessionInboxInfo {
  return {
    delivery,
    id,
    payload: { text: "Prompt" },
    sessionID: "ses_a",
    time: { created: 5 },
    type: "user",
  };
}

function restoredState(overrides: Partial<RestoredAdmissionState> = {}): RestoredAdmissionState {
  return { inboxById: new Map(), messagesById: new Map(), session: idleSession, ...overrides };
}

test("filters agents for selection and mentions, and models for selection", () => {
  const agents = [
    { hidden: false, id: "build", mode: "primary" },
    { hidden: true, id: "secret", mode: "all" },
    { hidden: false, id: "explore", mode: "subagent" },
    { id: "general", mode: "all" },
  ];
  expect(primaryAgents(agents).map((agent) => agent.id)).toEqual(["build", "general"]);
  expect(mentionableAgents(agents).map((agent) => agent.id)).toEqual(["explore", "general"]);
  expect(
    selectableModels([
      { enabled: true, id: "a", status: "active" },
      { enabled: false, id: "b", status: "active" },
      { enabled: true, id: "c", status: "deprecated" },
      { enabled: true, id: "d" },
    ]).map((model) => model.id),
  ).toEqual(["a", "d"]);
});

test("reduces a model to its reference", () => {
  expect(modelRef({ id: "model", providerID: "provider", name: "Model" } as never)).toEqual({
    id: "model",
    providerID: "provider",
  });
  expect(modelRef(null)).toBeUndefined();
  expect(modelRef(undefined)).toBeUndefined();
});

test("reads the draft revision of a known admission and defaults to zero", () => {
  const admissions = [admission({ draftRevision: 4 }), admission({ id: "msg_b" })];
  expect(currentAdmissionRevision(admissions, "msg_a")).toBe(4);
  expect(currentAdmissionRevision(admissions, "msg_b")).toBe(0);
  expect(currentAdmissionRevision(admissions, "msg_missing")).toBe(0);
});

test("treats submitting and unknown-delivery admissions as unresolved", () => {
  expect(hasUnresolvedAdmission([admission({ status: "queued" })])).toBe(false);
  expect(hasUnresolvedAdmission([admission({ status: "submitting" })])).toBe(true);
  expect(hasUnresolvedAdmission([admission({ status: "unknown-delivery" })])).toBe(true);
});

test("stores only recovery fields for an unresolved admission", () => {
  expect(() => unresolvedPromptAdmission(admission())).toThrow(
    "PROMPT_ADMISSION_PERSISTENCE_FAILED",
  );
  expect(
    unresolvedPromptAdmission(admission({ delivery: "queue", draftRevision: 2, previewText: "x" })),
  ).toEqual({
    delivery: "queue",
    draftRevision: 2,
    durable: false,
    id: "msg_a",
    kind: "prompt",
    status: "submitting",
    submittedAtMs: 1,
  });
  expect(
    unresolvedPromptAdmission(admission({ draftRevision: 0, status: "unknown-delivery" })),
  ).toEqual({
    draftRevision: 0,
    durable: false,
    id: "msg_a",
    kind: "prompt",
    status: "unknown-delivery",
    submittedAtMs: 1,
  });
});

test("describes the session only with the facts it has", () => {
  expect(sessionObservation(idleSession)).toEqual({ sessionRunning: false });
  expect(sessionObservation({ active: true, idleAtMs: 3, outcome: "succeeded" })).toEqual({
    sessionIdleAtMs: 3,
    sessionOutcome: "succeeded",
    sessionRunning: true,
  });
});

test("leaves restored commands untouched", () => {
  const command = admission({ kind: "command" });
  expect(
    reconcileRestoredAdmission(
      command,
      restoredState({ inboxById: new Map([["msg_a", inboxItem("msg_a", "queue")]]) }),
    ),
  ).toEqual({ admission: command, confirmed: false });
});

test("confirms a restored prompt once the inbox shows it", () => {
  const result = reconcileRestoredAdmission(
    admission({ draftRevision: 1 }),
    restoredState({ inboxById: new Map([["msg_a", inboxItem("msg_a", "queue")]]) }),
  );
  expect(result.confirmed).toBe(true);
  expect(result.admission).toMatchObject({
    confirmationHandled: true,
    delivery: "queue",
    durable: true,
    serverAdmittedAtMs: 5,
    status: "queued",
  });
});

test("drops the preview of a restored prompt once its message is projected", () => {
  const message = {
    id: "msg_a",
    time: { created: 7 },
    type: "user",
  } as unknown as SessionMessageInfo;
  const result = reconcileRestoredAdmission(
    admission({ previewText: "Pending" }),
    restoredState({
      messagesById: new Map([["msg_a", message]]),
      session: { active: true, idleAtMs: undefined, outcome: undefined },
    }),
  );
  expect(result.confirmed).toBe(true);
  expect(result.admission.previewText).toBeUndefined();
  expect(result.admission).toMatchObject({ serverAdmittedAtMs: 7, status: "executing" });
});

test("does not confirm a restored prompt the server has not reported", () => {
  const pending = admission();
  expect(reconcileRestoredAdmission(pending, restoredState())).toEqual({
    admission: pending,
    confirmed: false,
  });
  const handled = admission({ confirmationHandled: true, durable: true, status: "queued" });
  expect(
    reconcileRestoredAdmission(
      handled,
      restoredState({ inboxById: new Map([["msg_a", inboxItem("msg_a", "queue")]]) }),
    ).confirmed,
  ).toBe(false);
});

test("classifies submission failures by local cause and server classification", () => {
  const prompt = { type: "prompt" } as const;
  const command = { command: "review", type: "command" } as const;
  expect(classifySubmissionFailure(new Error("DRAFT_CHANGED_BEFORE_SEND"), prompt)).toEqual({
    error: "The draft changed before transmission. Review it and send again.",
    type: "cancelled",
  });
  expect(classifySubmissionFailure(new Error("PROMPT_CANCELLED_BEFORE_SEND"), prompt)).toEqual({
    error: undefined,
    type: "cancelled",
  });
  expect(
    classifySubmissionFailure(new Error("PROMPT_ADMISSION_PERSISTENCE_FAILED"), command),
  ).toEqual({
    error: "The submission could not be saved safely and was not sent.",
    type: "cancelled",
  });
  expect(classifySubmissionFailure({ kind: "INVALID_REQUEST" }, command)).toEqual({
    error: "The server rejected this command.",
    type: "rejected",
  });
  expect(classifySubmissionFailure({ kind: "UNAUTHORIZED" }, prompt)).toEqual({
    error: "The server rejected this prompt before admission.",
    type: "rejected",
  });
  expect(classifySubmissionFailure({ kind: "CONFLICT" }, command)).toEqual({
    error: "The server reported a command conflict. Check delivery before sending again.",
    type: "unknown",
  });
  expect(classifySubmissionFailure(new TypeError("Network request failed"), command)).toEqual({
    error:
      "The response was lost. The command may have run; check the transcript before sending again.",
    type: "unknown",
  });
  expect(classifySubmissionFailure(new Error("other"), prompt).error).toMatch(
    /prompt may have been admitted/,
  );
});

test("builds command and prompt requests with only the attachments present", () => {
  const attachments = {
    agents: [{ mention: { end: 6, start: 0, text: "@build" }, name: "build" }],
    files: [{ mention: { end: 4, start: 0, text: "@a.ts" }, name: "a.ts", uri: "file:///a.ts" }],
    skills: [{ id: "release", mention: { end: 8, start: 0, text: "@release" } }],
  };
  const queued = admission({ delivery: "queue" });
  expect(
    commandSubmissionInput(
      { ...attachments, arguments: "src", command: "review", type: "command" },
      queued,
    ),
  ).toEqual({ ...attachments, command: "review", delivery: "queue", text: "src" });
  expect(commandSubmissionInput({ command: "review", type: "command" }, admission())).toEqual({
    command: "review",
    delivery: "steer",
    text: "",
  });
  expect(promptSubmissionInput({ ...attachments, type: "prompt" }, queued, "Go")).toEqual({
    ...attachments,
    delivery: "queue",
    id: "msg_a",
    resume: true,
    text: "Go",
  });
  expect(promptSubmissionInput({ type: "prompt" }, admission(), "Go")).toEqual({
    delivery: "steer",
    id: "msg_a",
    resume: true,
    text: "Go",
  });
});

test("applies inbox cancel, queue, and steer actions to the matching item", () => {
  const inbox = [inboxItem("msg_a", "steer"), inboxItem("msg_b", "steer")];
  expect(applyInboxAction(inbox, "cancel", "msg_a").map((item) => item.id)).toEqual(["msg_b"]);
  expect(applyInboxAction(inbox, "queue", "msg_a").map((item) => item.delivery)).toEqual([
    "queue",
    "steer",
  ]);
  const queued = [inboxItem("msg_a", "queue")];
  expect(applyInboxAction(queued, "steer", "msg_a")[0]?.delivery).toBe("steer");
});
