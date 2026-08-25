import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

export type EncryptedValue = { ciphertext: Uint8Array; nonce: Uint8Array };

export function encryptBrokerValue(masterKey: Uint8Array, value: Uint8Array): EncryptedValue {
  assertKey(masterKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: new Uint8Array(encrypted), nonce: new Uint8Array(nonce) };
}

export function decryptBrokerValue(
  masterKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
) {
  assertKey(masterKey);
  if (nonce.byteLength !== 12 || ciphertext.byteLength < 17) throw new Error("INVALID_BROKER_DATA");
  const encrypted = Buffer.from(ciphertext);
  const decipher = createDecipheriv("aes-256-gcm", masterKey, nonce);
  decipher.setAuthTag(encrypted.subarray(encrypted.byteLength - 16));
  try {
    return new Uint8Array(
      Buffer.concat([
        decipher.update(encrypted.subarray(0, encrypted.byteLength - 16)),
        decipher.final(),
      ]),
    );
  } catch {
    throw new Error("INVALID_BROKER_DATA");
  }
}

export function secureTokenEquals(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function assertKey(value: Uint8Array) {
  if (value.byteLength !== 32) throw new Error("INVALID_BROKER_MASTER_KEY");
}
