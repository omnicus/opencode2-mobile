import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  deleteSessionLocalState,
  deleteUnresolvedPromptAdmission,
  listUnresolvedPromptAdmissions,
  writeUnresolvedPromptAdmission,
} from "./prompt-admission-repository";

test("stores only content-free unresolved admission metadata", async () => {
  const runAsync = jest.fn(async (..._args: unknown[]) => undefined);
  const db = {
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: unknown) => Promise<void>) => task(db),
  } as unknown as SQLiteDatabase;

  await writeUnresolvedPromptAdmission(db, "connection-1", "ses_a", {
    delivery: "queue",
    draftRevision: 3,
    durable: false,
    id: "msg_test",
    status: "unknown-delivery",
    submittedAtMs: 10,
  });

  expect(JSON.stringify(runAsync.mock.calls)).not.toContain("prompt text");
  expect(runAsync.mock.calls[0]?.slice(1)).toEqual([
    "connection-1",
    "ses_a",
    "msg_test",
    "unknown-delivery",
    "queue",
    3,
    10,
  ]);
  expect(String(runAsync.mock.calls[1]?.[0])).toContain("LIMIT 20");
});

test("deletes drafts and admissions for a complete server session tree", async () => {
  const runAsync = jest.fn(async (..._args: unknown[]) => undefined);
  const db = {
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: unknown) => Promise<void>) => task(db),
  } as unknown as SQLiteDatabase;

  await deleteSessionLocalState(db, "connection-1", ["ses_parent", "ses_child"]);

  expect(runAsync).toHaveBeenCalledTimes(4);
  expect(runAsync).toHaveBeenCalledWith(
    expect.stringContaining("session_drafts"),
    "connection-1",
    "ses_parent",
  );
  expect(runAsync).toHaveBeenCalledWith(
    expect.stringContaining("unresolved_prompt_admissions"),
    "connection-1",
    "ses_child",
  );
});

test("decodes unresolved admission rows and deletes a confirmed ID", async () => {
  const runAsync = jest.fn(async (..._args: unknown[]) => undefined);
  const db = {
    getAllAsync: jest.fn(async () => [
      {
        admission_id: "msg_test",
        delivery: "steer",
        draft_revision: 2,
        status: "submitting",
        submitted_at_ms: 10,
      },
    ]),
    runAsync,
  } as unknown as SQLiteDatabase;

  await expect(listUnresolvedPromptAdmissions(db, "connection-1", "ses_a")).resolves.toEqual([
    {
      delivery: "steer",
      draftRevision: 2,
      durable: false,
      id: "msg_test",
      status: "unknown-delivery",
      submittedAtMs: 10,
    },
  ]);
  await deleteUnresolvedPromptAdmission(db, "connection-1", "ses_a", "msg_test");
  expect(runAsync).toHaveBeenCalledWith(expect.any(String), "connection-1", "ses_a", "msg_test");
});
