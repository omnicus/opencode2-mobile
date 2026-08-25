import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Base64 } from "js-base64";

import { secureStoreService } from "./secure-store-service";

const draftKeyBytes = 32;
const draftKeyPrefix = "opencode.connection.draft-key.v1.";
const connectionIdPattern = /^[A-Za-z0-9._-]+$/;

export const draftKeyStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: secureStoreService("drafts"),
} satisfies SecureStore.SecureStoreOptions;

const pendingKeyLoads = new Map<string, Promise<Uint8Array>>();

export async function getOrCreateConnectionDraftKey(connectionId: string) {
  const reference = draftKeyReference(connectionId);
  const pending = pendingKeyLoads.get(reference);
  if (pending) return pending;

  const load = loadOrCreateDraftKey(reference);
  pendingKeyLoads.set(reference, load);
  try {
    return await load;
  } finally {
    if (pendingKeyLoads.get(reference) === load) pendingKeyLoads.delete(reference);
  }
}

export async function readConnectionDraftKey(connectionId: string) {
  const reference = draftKeyReference(connectionId);
  const pending = pendingKeyLoads.get(reference);
  if (pending) return pending;
  await assertSecureStoreAvailable();
  const stored = await SecureStore.getItemAsync(reference, draftKeyStoreOptions);
  if (stored === null) throw new Error("DRAFT_KEY_MISSING");
  return decodeDraftKey(stored);
}

export async function deleteConnectionDraftKey(connectionId: string) {
  const reference = draftKeyReference(connectionId);
  await pendingKeyLoads.get(reference)?.catch(() => undefined);
  await assertSecureStoreAvailable();
  await SecureStore.deleteItemAsync(reference, draftKeyStoreOptions);
}

async function loadOrCreateDraftKey(reference: string) {
  await assertSecureStoreAvailable();
  const stored = await SecureStore.getItemAsync(reference, draftKeyStoreOptions);
  if (stored !== null) return decodeDraftKey(stored);

  const key = Crypto.getRandomBytes(draftKeyBytes);
  await SecureStore.setItemAsync(reference, Base64.fromUint8Array(key), draftKeyStoreOptions);
  return key;
}

function draftKeyReference(connectionId: string) {
  if (
    connectionId.length === 0 ||
    connectionId.length > 128 ||
    !connectionIdPattern.test(connectionId)
  ) {
    throw new Error("INVALID_DRAFT_CONNECTION_ID");
  }
  return `${draftKeyPrefix}${connectionId}`;
}

function decodeDraftKey(stored: string) {
  const key = Base64.toUint8Array(stored);
  if (key.byteLength !== draftKeyBytes || Base64.fromUint8Array(key) !== stored) {
    throw new Error("INVALID_STORED_DRAFT_KEY");
  }
  return key;
}

async function assertSecureStoreAvailable() {
  if (!(await SecureStore.isAvailableAsync())) throw new Error("SECURE_STORE_UNAVAILABLE");
}
