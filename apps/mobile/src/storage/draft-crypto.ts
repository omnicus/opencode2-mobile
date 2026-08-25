import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import * as Crypto from "expo-crypto";

export const maxDraftBytes = 256 * 1024;

const draftSchemaVersion = 1;
const draftKeyBytes = 32;
const draftNonceBytes = 24;
const draftTagBytes = 16;
const maxDraftIdentityBytes = 512;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type EncryptedSessionDraft = {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
};

export function encryptSessionDraft(
  content: string,
  key: Uint8Array,
  connectionId: string,
  sessionId: string,
): EncryptedSessionDraft {
  assertDraftKey(key);
  const plaintext = textEncoder.encode(content);
  if (plaintext.byteLength > maxDraftBytes) throw new Error("DRAFT_TOO_LARGE");

  const nonce = Crypto.getRandomBytes(draftNonceBytes);
  const ciphertext = xchacha20poly1305(
    key,
    nonce,
    draftAdditionalData(connectionId, sessionId),
  ).encrypt(plaintext);
  return { ciphertext, nonce };
}

export function decryptSessionDraft(
  encrypted: EncryptedSessionDraft,
  key: Uint8Array,
  connectionId: string,
  sessionId: string,
) {
  assertDraftKey(key);
  if (
    encrypted.nonce.byteLength !== draftNonceBytes ||
    encrypted.ciphertext.byteLength < draftTagBytes ||
    encrypted.ciphertext.byteLength > maxDraftBytes + draftTagBytes
  ) {
    throw new Error("INVALID_ENCRYPTED_DRAFT");
  }

  try {
    const plaintext = xchacha20poly1305(
      key,
      encrypted.nonce,
      draftAdditionalData(connectionId, sessionId),
    ).decrypt(encrypted.ciphertext);
    return textDecoder.decode(plaintext);
  } catch {
    throw new Error("DRAFT_DECRYPTION_FAILED");
  }
}

function draftAdditionalData(connectionId: string, sessionId: string) {
  if (
    connectionId.length === 0 ||
    sessionId.length === 0 ||
    connectionId.length + sessionId.length > maxDraftIdentityBytes
  ) {
    throw new Error("INVALID_DRAFT_IDENTITY");
  }
  const encoded = textEncoder.encode(
    JSON.stringify({ connectionId, schemaVersion: draftSchemaVersion, sessionId }),
  );
  if (encoded.byteLength > maxDraftIdentityBytes) {
    throw new Error("INVALID_DRAFT_IDENTITY");
  }
  return encoded;
}

function assertDraftKey(key: Uint8Array) {
  if (key.byteLength !== draftKeyBytes) throw new Error("INVALID_DRAFT_KEY");
}
