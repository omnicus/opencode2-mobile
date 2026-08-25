import { beforeEach, expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  removeConnectionProfile,
  saveConnectionProfile,
  selectConnectionProfile,
} from "./connection-repository";

const mockCreateCredentialReference = jest.fn(() => "credential-ref");
const mockDeleteCredential = jest.fn<(reference: string) => Promise<void>>(async () => undefined);
const mockWriteCredential = jest.fn<(reference: string, credential: unknown) => Promise<void>>(
  async () => undefined,
);
const mockFinishDraftDeletion = jest.fn<(connectionId: string) => Promise<void>>(
  async () => undefined,
);
const mockStageDraftDeletion = jest.fn<(db: unknown, connectionId: string) => Promise<void>>(
  async () => undefined,
);

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  normalizeOpenCodeBaseUrl: (value: string) => new URL(value).origin,
}));

jest.mock("expo-crypto", () => ({ randomUUID: () => "profile-id" }));

jest.mock("../storage/draft-repository", () => ({
  finishConnectionDraftDeletion: (_db: unknown, connectionId: string) =>
    mockFinishDraftDeletion(connectionId),
  stageConnectionDraftDeletion: (db: unknown, connectionId: string) =>
    mockStageDraftDeletion(db, connectionId),
}));

jest.mock("./credential-store", () => ({
  createCredentialReference: () => mockCreateCredentialReference(),
  deleteConnectionCredential: (reference: string) => mockDeleteCredential(reference),
  writeConnectionCredential: (reference: string, credential: unknown) =>
    mockWriteCredential(reference, credential),
}));

beforeEach(() => {
  mockCreateCredentialReference.mockClear();
  mockDeleteCredential.mockClear();
  mockFinishDraftDeletion.mockClear();
  mockFinishDraftDeletion.mockImplementation(async () => undefined);
  mockStageDraftDeletion.mockClear();
  mockWriteCredential.mockClear();
});

test("writes secrets to SecureStore but not SQLite", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));
  const db = {
    getFirstAsync: jest.fn(async () => null),
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: unknown) => Promise<void>) => task(db),
  } as unknown as SQLiteDatabase;
  const credential = {
    mode: "basic" as const,
    password: "private-password",
    schemaVersion: 1 as const,
    username: "private-user",
  };

  await saveConnectionProfile(db, {
    credential,
    draft: {
      allowDevelopmentHttp: false,
      authMode: "basic",
      baseUrl: "https://server.test",
      name: "Test server",
    },
    health: { checkedAtMs: 1, pid: 42, version: "test" },
  });

  expect(mockWriteCredential).toHaveBeenCalledWith("credential-ref", credential);
  expect(JSON.stringify(runAsync.mock.calls)).not.toContain("private-password");
  expect(JSON.stringify(runAsync.mock.calls)).not.toContain("private-user");
});

test("rejects unapproved HTTP before storing a credential", async () => {
  const db = {} as SQLiteDatabase;

  await expect(
    saveConnectionProfile(db, {
      credential: {
        mode: "bearer",
        schemaVersion: 1,
        token: "private-token",
      },
      draft: {
        allowDevelopmentHttp: false,
        authMode: "bearer",
        baseUrl: "http://server.test",
        name: "Test server",
      },
      health: { checkedAtMs: 1, pid: 42, version: "test" },
    }),
  ).rejects.toThrow("DEVELOPMENT_HTTP_NOT_APPROVED");
  expect(mockWriteCredential).not.toHaveBeenCalled();
});

test("removes the profile and its SecureStore credential", async () => {
  const runAsync = jest.fn<(sql: string, ...params: unknown[]) => Promise<unknown>>(async () => ({
    changes: 1,
    lastInsertRowId: 0,
  }));
  const db = {
    getFirstAsync: jest.fn(async () => ({ credential_ref: "credential-ref" })),
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: unknown) => Promise<void>) => task(db),
  } as unknown as SQLiteDatabase;

  await removeConnectionProfile(db, "profile-id");

  expect(mockDeleteCredential).toHaveBeenCalledWith("credential-ref");
  expect(mockStageDraftDeletion).toHaveBeenCalledWith(db, "profile-id");
  expect(mockFinishDraftDeletion).toHaveBeenCalledWith("profile-id");
  expect(
    runAsync.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM connection_profiles")),
  ).toBe(true);
});

test("commits profile deletion when draft key cleanup is interrupted", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));
  const db = {
    getFirstAsync: jest.fn(async () => ({ credential_ref: null })),
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: unknown) => Promise<void>) => task(db),
  } as unknown as SQLiteDatabase;
  mockFinishDraftDeletion.mockRejectedValueOnce(new Error("interrupted"));

  await expect(removeConnectionProfile(db, "profile-id")).resolves.toBeUndefined();

  expect(mockStageDraftDeletion).toHaveBeenCalledWith(db, "profile-id");
  expect(
    runAsync.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM connection_profiles")),
  ).toBe(true);
});

test("deletes server-scoped local state when an existing profile changes origin", async () => {
  const runAsync = jest.fn(async (..._parameters: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  }));
  const db = {
    getFirstAsync: jest.fn(async () => ({
      base_url: "https://old.test",
      created_at_ms: 1,
      credential_ref: null,
      updated_at_ms: 1,
    })),
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: unknown) => Promise<void>) => task(db),
  } as unknown as SQLiteDatabase;

  await saveConnectionProfile(db, {
    draft: {
      allowDevelopmentHttp: false,
      authMode: "none",
      baseUrl: "https://new.test",
      id: "profile-id",
      name: "Replacement server",
    },
    health: { checkedAtMs: 2, pid: 43, version: "test" },
  });

  expect(
    runAsync.mock.calls.some(
      ([sql, profileId]) =>
        String(sql).includes("DELETE FROM session_drafts") && profileId === "profile-id",
    ),
  ).toBe(true);
  expect(
    runAsync.mock.calls.some(
      ([sql, profileId]) =>
        String(sql).includes("DELETE FROM unresolved_prompt_admissions") &&
        profileId === "profile-id",
    ),
  ).toBe(true);
  expect(
    runAsync.mock.calls.some(
      ([sql, profileId]) =>
        String(sql).includes("DELETE FROM followed_projects") && profileId === "profile-id",
    ),
  ).toBe(true);
  expect(
    runAsync.mock.calls.some(
      ([sql, profileId]) =>
        String(sql).includes("DELETE FROM followed_project_preferences") &&
        profileId === "profile-id",
    ),
  ).toBe(true);
});

test("selecting a profile does not change its cache revision", async () => {
  const runAsync = jest.fn<(sql: string, ...parameters: unknown[]) => Promise<unknown>>(
    async () => ({ changes: 1, lastInsertRowId: 0 }),
  );
  const db = {
    getFirstAsync: jest.fn(async () => ({ id: "profile-id" })),
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: unknown) => Promise<void>) => task(db),
  } as unknown as SQLiteDatabase;

  await selectConnectionProfile(db, "profile-id");

  const profileUpdate = runAsync.mock.calls.find(([sql]) =>
    String(sql).includes("UPDATE connection_profiles"),
  );
  expect(profileUpdate?.[0]).toContain("last_used_at_ms = ?");
  expect(profileUpdate?.[0]).not.toContain("updated_at_ms");
});
