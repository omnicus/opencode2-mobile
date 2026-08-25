import { beforeEach, expect, jest, test } from "@jest/globals";

const secureValues = new Map<string, string>();
const mockDeleteItem = jest.fn<(key: string, options?: unknown) => Promise<void>>(
  async (key: string) => {
    secureValues.delete(key);
  },
);
const mockGetItem = jest.fn<(key: string, options?: unknown) => Promise<string | null>>(
  async (key: string) => secureValues.get(key) ?? null,
);
const mockSetItem = jest.fn<(key: string, value: string, options?: unknown) => Promise<void>>(
  async (key: string, value: string) => {
    secureValues.set(key, value);
  },
);

jest.mock("expo-crypto", () => ({
  getRandomBytes: (length: number) => Uint8Array.from({ length }, (_, index) => index + 1),
}));
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  deleteItemAsync: (key: string, options: unknown) => mockDeleteItem(key, options),
  getItemAsync: (key: string, options: unknown) => mockGetItem(key, options),
  isAvailableAsync: async () => true,
  setItemAsync: (key: string, value: string, options: unknown) => mockSetItem(key, value, options),
}));

import {
  deleteConnectionDraftKey,
  draftKeyStoreOptions,
  getOrCreateConnectionDraftKey,
  readConnectionDraftKey,
} from "./draft-key-store";

beforeEach(() => {
  secureValues.clear();
  mockDeleteItem.mockClear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
});

test("creates one random per-connection key in the draft-only SecureStore service", async () => {
  const [first, second] = await Promise.all([
    getOrCreateConnectionDraftKey("connection-1"),
    getOrCreateConnectionDraftKey("connection-1"),
  ]);

  expect(first).toEqual(second);
  expect(first).toHaveLength(32);
  expect(mockSetItem).toHaveBeenCalledTimes(1);
  expect(mockSetItem).toHaveBeenCalledWith(
    "opencode.connection.draft-key.v1.connection-1",
    expect.any(String),
    draftKeyStoreOptions,
  );
  expect(draftKeyStoreOptions).toEqual({
    keychainAccessible: 7,
    keychainService: "dev.opencode2.mobile.drafts",
  });
});

test("reads and deletes a connection draft key with the same service", async () => {
  const created = await getOrCreateConnectionDraftKey("connection-1");

  await expect(readConnectionDraftKey("connection-1")).resolves.toEqual(created);
  await deleteConnectionDraftKey("connection-1");

  expect(mockDeleteItem).toHaveBeenCalledWith(
    "opencode.connection.draft-key.v1.connection-1",
    draftKeyStoreOptions,
  );
  await expect(readConnectionDraftKey("connection-1")).rejects.toThrow("DRAFT_KEY_MISSING");
});

test("rejects malformed stored key material", async () => {
  secureValues.set("opencode.connection.draft-key.v1.connection-1", "not-a-key");

  await expect(readConnectionDraftKey("connection-1")).rejects.toThrow("INVALID_STORED_DRAFT_KEY");
});
