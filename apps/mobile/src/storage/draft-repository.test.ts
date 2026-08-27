import { beforeEach, expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";

const mockDraftKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const mockDeleteDraftKey = jest.fn<(connectionId: string) => Promise<void>>(async () => undefined);

jest.mock("expo-crypto", () => ({
  getRandomBytes: (length: number) => Uint8Array.from({ length }, (_, index) => index + 10),
}));
jest.mock("../security/draft-key-store", () => ({
  deleteConnectionDraftKey: (connectionId: string) => mockDeleteDraftKey(connectionId),
  getOrCreateConnectionDraftKey: async () => mockDraftKey,
  readConnectionDraftKey: async () => mockDraftKey,
}));

import { encryptSessionDraft } from "./draft-crypto";
import {
  cleanupPendingDraftKeyDeletions,
  deleteSessionDraft,
  readSessionDraft,
  stageConnectionDraftDeletion,
  writeSessionDraft,
} from "./draft-repository";

beforeEach(() => {
  mockDeleteDraftKey.mockClear();
  mockDeleteDraftKey.mockImplementation(async () => undefined);
});

test("writes only encrypted draft bytes to SQLite and reads them back", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));
  const writeDb = {
    getFirstAsync: jest.fn(async () => ({ id: "connection-1" })),
    runAsync,
  } as unknown as SQLiteDatabase;

  await writeSessionDraft(writeDb, {
    connectionId: "connection-1",
    content: "private draft",
    mentions: [
      {
        id: "release",
        mention: { end: 8, start: 0, text: "@release" },
        type: "skill",
      },
    ],
    revision: 7,
    sessionId: "session-1",
  });

  expect(JSON.stringify(runAsync.mock.calls)).not.toContain("private draft");
  const parameters = runAsync.mock.calls[0];
  const nonce = parameters?.[6];
  const ciphertext = parameters?.[7];
  expect(nonce).toBeInstanceOf(Uint8Array);
  expect(ciphertext).toBeInstanceOf(Uint8Array);
  expect(String(parameters?.[0])).toContain("excluded.revision >= session_drafts.revision");
  expect(runAsync.mock.calls.some(([sql]) => String(sql).includes("LIMIT 100"))).toBe(true);

  const readDb = {
    getFirstAsync: jest.fn(async () => ({
      ciphertext,
      nonce,
      payload_version: 2,
      revision: 7,
      schema_version: 1,
      updated_at_ms: 42,
    })),
  } as unknown as SQLiteDatabase;
  await expect(readSessionDraft(readDb, "connection-1", "session-1")).resolves.toEqual({
    content: "private draft",
    mentions: [
      {
        id: "release",
        mention: { end: 8, start: 0, text: "@release" },
        type: "skill",
      },
    ],
    revision: 7,
    updatedAtMs: 42,
  });
});

test("reads pre-mention encrypted drafts as plain text", async () => {
  const legacyDraft = 'opencode-mobile-draft:2\n{"content":"still plain text"}';
  const encrypted = encryptSessionDraft(legacyDraft, mockDraftKey, "connection-1", "session-1");
  const db = {
    getFirstAsync: jest.fn(async () => ({
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      payload_version: 1,
      revision: 3,
      schema_version: 1,
      updated_at_ms: 42,
    })),
  } as unknown as SQLiteDatabase;

  await expect(readSessionDraft(db, "connection-1", "session-1")).resolves.toEqual({
    content: legacyDraft,
    mentions: [],
    revision: 3,
    updatedAtMs: 42,
  });
});

test("deletes one connection/session draft", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));

  await deleteSessionDraft({ runAsync } as unknown as SQLiteDatabase, "connection-1", "session-1");

  expect(runAsync).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM session_drafts"),
    "connection-1",
    "session-1",
  );
});

test("reports a stale revision that SQLite refuses to apply", async () => {
  const db = {
    getFirstAsync: jest.fn(async () => ({ id: "connection-1" })),
    runAsync: jest.fn(async () => ({ changes: 0, lastInsertRowId: 0 })),
  } as unknown as SQLiteDatabase;

  await expect(
    writeSessionDraft(db, {
      connectionId: "connection-1",
      content: "older draft",
      revision: 1,
      sessionId: "session-1",
    }),
  ).rejects.toThrow("STALE_DRAFT_REVISION");
});

test("keeps interrupted key deletions pending and clears them after retry", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));
  const db = {
    getAllAsync: jest.fn(async () => [{ connection_id: "connection-1" }]),
    runAsync,
  } as unknown as SQLiteDatabase;
  mockDeleteDraftKey.mockRejectedValueOnce(new Error("interrupted"));

  await cleanupPendingDraftKeyDeletions(db);
  expect(runAsync).not.toHaveBeenCalled();

  await cleanupPendingDraftKeyDeletions(db);
  expect(mockDeleteDraftKey).toHaveBeenLastCalledWith("connection-1");
  expect(runAsync).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM pending_draft_key_deletions"),
    "connection-1",
  );
});

test("stages connection key deletion before profile removal", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));

  await stageConnectionDraftDeletion({ runAsync } as unknown as SQLiteDatabase, "connection-1");

  expect(runAsync).toHaveBeenCalledWith(
    expect.stringContaining("INSERT OR IGNORE INTO pending_draft_key_deletions"),
    "connection-1",
  );
});
