import { expect, jest, test } from "@jest/globals";

jest.mock("expo-crypto", () => ({
  getRandomBytes: (length: number) => Uint8Array.from({ length }, (_, index) => index + 10),
}));

import { decryptSessionDraft, encryptSessionDraft, maxDraftBytes } from "./draft-crypto";

const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

test("authenticates draft content and its connection/session identity", () => {
  const encrypted = encryptSessionDraft("private draft", key, "connection-1", "session-1");

  expect(encrypted.nonce).toHaveLength(24);
  expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain("private draft");
  expect(decryptSessionDraft(encrypted, key, "connection-1", "session-1")).toBe("private draft");
  expect(() => decryptSessionDraft(encrypted, key, "connection-2", "session-1")).toThrow(
    "DRAFT_DECRYPTION_FAILED",
  );
  expect(() => decryptSessionDraft(encrypted, key, "connection-1", "session-2")).toThrow(
    "DRAFT_DECRYPTION_FAILED",
  );
});

test("rejects modified ciphertext", () => {
  const encrypted = encryptSessionDraft("private draft", key, "connection-1", "session-1");
  const ciphertext = encrypted.ciphertext.slice();
  ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;

  expect(() =>
    decryptSessionDraft({ ...encrypted, ciphertext }, key, "connection-1", "session-1"),
  ).toThrow("DRAFT_DECRYPTION_FAILED");
});

test("bounds plaintext before encryption", () => {
  expect(() =>
    encryptSessionDraft("x".repeat(maxDraftBytes + 1), key, "connection-1", "session-1"),
  ).toThrow("DRAFT_TOO_LARGE");
});
