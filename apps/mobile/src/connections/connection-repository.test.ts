import { beforeEach, expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  getSelectedConnectionId,
  listConnectionProfiles,
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
  mockDeleteCredential.mockImplementation(async () => undefined);
  mockFinishDraftDeletion.mockClear();
  mockFinishDraftDeletion.mockImplementation(async () => undefined);
  mockStageDraftDeletion.mockClear();
  mockWriteCredential.mockClear();
  mockWriteCredential.mockImplementation(async () => undefined);
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
        String(sql).includes("DELETE FROM model_favorites") && profileId === "profile-id",
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

function createRepositoryDb(
  getFirstAsync: (sql: string, ...parameters: unknown[]) => Promise<unknown>,
  options: { failTransaction?: Error } = {},
) {
  const runAsync = jest.fn<(sql: string, ...parameters: unknown[]) => Promise<unknown>>(
    async () => ({ changes: 1, lastInsertRowId: 0 }),
  );
  const db = {
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(getFirstAsync),
    runAsync,
    withExclusiveTransactionAsync: async (task: (txn: unknown) => Promise<void>) => {
      if (options.failTransaction) throw options.failTransaction;
      await task(db);
    },
  } as unknown as SQLiteDatabase;
  return { db, runAsync };
}

const bearerCredential = { mode: "bearer" as const, schemaVersion: 1 as const, token: "token" };

function bearerInput(overrides: { baseUrl?: string; id?: string } = {}) {
  return {
    credential: bearerCredential,
    draft: {
      allowDevelopmentHttp: false,
      authMode: "bearer" as const,
      baseUrl: overrides.baseUrl ?? "https://server.test",
      name: "Test server",
      ...(overrides.id ? { id: overrides.id } : {}),
    },
    health: { checkedAtMs: 1, pid: 42, version: "test" },
  };
}

test("rejects a credential for a profile without authentication", async () => {
  await expect(
    saveConnectionProfile({} as SQLiteDatabase, {
      credential: bearerCredential,
      draft: {
        allowDevelopmentHttp: false,
        authMode: "none",
        baseUrl: "https://server.test",
        name: "Test server",
      },
      health: { checkedAtMs: 1, pid: 42, version: "test" },
    }),
  ).rejects.toThrow("UNEXPECTED_CONNECTION_CREDENTIAL");
  expect(mockWriteCredential).not.toHaveBeenCalled();
});

test("requires a credential that matches the profile authentication mode", async () => {
  await expect(
    saveConnectionProfile({} as SQLiteDatabase, {
      ...bearerInput(),
      credential: { mode: "basic", password: "p", schemaVersion: 1, username: "u" },
    }),
  ).rejects.toThrow("CONNECTION_CREDENTIAL_REQUIRED");
  const { credential: _credential, ...withoutCredential } = bearerInput();
  await expect(saveConnectionProfile({} as SQLiteDatabase, withoutCredential)).rejects.toThrow(
    "CONNECTION_CREDENTIAL_REQUIRED",
  );
  expect(mockWriteCredential).not.toHaveBeenCalled();
});

test("allows approved development HTTP", async () => {
  const { db, runAsync } = createRepositoryDb(async () => null);
  await expect(
    saveConnectionProfile(db, {
      draft: {
        allowDevelopmentHttp: true,
        authMode: "none",
        baseUrl: "http://server.test",
        name: "Test server",
      },
      health: { checkedAtMs: 1, pid: 42, version: "test" },
    }),
  ).resolves.toBe("profile-id");
  const insert = runAsync.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO connection_profiles"),
  );
  expect(insert?.slice(1)).toEqual([
    "profile-id",
    1,
    "Test server",
    "http://server.test",
    "none",
    null,
    1,
    1,
    42,
    "test",
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
  ]);
});

test("rejects saving an unknown profile before storing a credential", async () => {
  const { db, runAsync } = createRepositoryDb(async () => null);
  await expect(saveConnectionProfile(db, bearerInput({ id: "missing" }))).rejects.toThrow(
    "CONNECTION_PROFILE_NOT_FOUND",
  );
  expect(mockWriteCredential).not.toHaveBeenCalled();
  expect(runAsync).not.toHaveBeenCalled();
});

test("cleans up a staged credential when SecureStore rejects the write", async () => {
  const { db, runAsync } = createRepositoryDb(async () => null);
  mockWriteCredential.mockRejectedValueOnce(new Error("secure store"));

  await expect(saveConnectionProfile(db, bearerInput())).rejects.toThrow("secure store");

  expect(runAsync.mock.calls.map(([sql]) => sql)).toEqual([
    "INSERT INTO pending_secure_store_writes(credential_ref) VALUES (?)",
    "DELETE FROM pending_secure_store_writes WHERE credential_ref = ?",
  ]);
  expect(mockDeleteCredential).toHaveBeenCalledWith("credential-ref");
});

test("cleans up a written credential when the profile transaction fails", async () => {
  const { db, runAsync } = createRepositoryDb(async () => null, {
    failTransaction: new Error("busy"),
  });

  await expect(saveConnectionProfile(db, bearerInput())).rejects.toThrow("busy");

  expect(mockWriteCredential).toHaveBeenCalledWith("credential-ref", bearerCredential);
  expect(mockDeleteCredential).toHaveBeenCalledWith("credential-ref");
  expect(runAsync.mock.calls.at(-1)?.[0]).toBe(
    "DELETE FROM pending_secure_store_writes WHERE credential_ref = ?",
  );
});

test("does not touch SecureStore when a credential-free transaction fails", async () => {
  const { db } = createRepositoryDb(async () => null, { failTransaction: new Error("busy") });
  await expect(
    saveConnectionProfile(db, {
      draft: {
        allowDevelopmentHttp: false,
        authMode: "none",
        baseUrl: "https://server.test",
        name: "Test server",
      },
      health: { checkedAtMs: 1, pid: 42, version: "test" },
    }),
  ).rejects.toThrow("busy");
  expect(mockDeleteCredential).not.toHaveBeenCalled();
});

test("replaces a stored credential and deletes the previous one after commit", async () => {
  const { db, runAsync } = createRepositoryDb(async () => ({
    base_url: "https://server.test",
    created_at_ms: 5,
    credential_ref: "previous-ref",
    updated_at_ms: 10_000_000_000_000,
  }));

  await expect(saveConnectionProfile(db, bearerInput({ id: "profile-id" }))).resolves.toBe(
    "profile-id",
  );

  const statements = runAsync.mock.calls.map(([sql, ...parameters]) => [sql, parameters[0]]);
  expect(statements).toContainEqual([
    "DELETE FROM pending_secure_store_writes WHERE credential_ref = ?",
    "credential-ref",
  ]);
  expect(statements).toContainEqual([
    "INSERT OR IGNORE INTO pending_secure_store_deletions(credential_ref) VALUES (?)",
    "previous-ref",
  ]);
  expect(statements).toContainEqual([
    "DELETE FROM pending_secure_store_deletions WHERE credential_ref = ?",
    "previous-ref",
  ]);
  expect(statements.some(([sql]) => String(sql).includes("DELETE FROM session_drafts"))).toBe(
    false,
  );
  expect(mockDeleteCredential).toHaveBeenCalledWith("previous-ref");
  const insert = runAsync.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO connection_profiles"),
  );
  expect(insert?.slice(11)).toEqual([10_000_000_000_001, 5, 10_000_000_000_001]);
});

test("keeps the saved profile when deleting the replaced credential fails", async () => {
  const { db } = createRepositoryDb(async () => ({
    base_url: "https://server.test",
    created_at_ms: 1,
    credential_ref: "previous-ref",
    updated_at_ms: 1,
  }));
  mockDeleteCredential.mockRejectedValueOnce(new Error("secure store"));

  await expect(saveConnectionProfile(db, bearerInput({ id: "profile-id" }))).resolves.toBe(
    "profile-id",
  );
});

test("stages notification secret removal when a paired profile changes origin", async () => {
  const { db, runAsync } = createRepositoryDb(async (sql) =>
    sql.includes("notification_pairings")
      ? { secret_ref: "notification-ref" }
      : { base_url: "https://old.test", created_at_ms: 1, credential_ref: null, updated_at_ms: 1 },
  );

  await expect(
    saveConnectionProfile(db, bearerInput({ baseUrl: "https://new.test", id: "profile-id" })),
  ).resolves.toBe("profile-id");

  expect(runAsync).toHaveBeenCalledWith(
    "INSERT OR IGNORE INTO pending_notification_secret_deletions(secret_ref) VALUES (?)",
    "notification-ref",
  );
  expect(runAsync).toHaveBeenCalledWith(
    "DELETE FROM notification_pairings WHERE connection_id = ?",
    "profile-id",
  );
});

test("rejects selecting an unknown profile", async () => {
  const { db, runAsync } = createRepositoryDb(async () => null);
  await expect(selectConnectionProfile(db, "missing")).rejects.toThrow(
    "CONNECTION_PROFILE_NOT_FOUND",
  );
  expect(runAsync).not.toHaveBeenCalled();
});

test("reads the selected profile id", async () => {
  await expect(
    getSelectedConnectionId(createRepositoryDb(async () => ({ selected_connection_id: "a" })).db),
  ).resolves.toBe("a");
  await expect(
    getSelectedConnectionId(createRepositoryDb(async () => ({ selected_connection_id: null })).db),
  ).resolves.toBeUndefined();
  await expect(
    getSelectedConnectionId(createRepositoryDb(async () => null).db),
  ).resolves.toBeUndefined();
});

test("lists decoded profiles", async () => {
  const { db } = createRepositoryDb(async () => null);
  await expect(listConnectionProfiles(db)).resolves.toEqual([]);
});

test("rejects removing an unknown profile", async () => {
  const { db, runAsync } = createRepositoryDb(async () => null);
  await expect(removeConnectionProfile(db, "missing")).rejects.toThrow(
    "CONNECTION_PROFILE_NOT_FOUND",
  );
  expect(runAsync).not.toHaveBeenCalled();
  expect(mockFinishDraftDeletion).not.toHaveBeenCalled();
});
