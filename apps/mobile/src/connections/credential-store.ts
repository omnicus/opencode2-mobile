import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { SQLiteDatabase } from "expo-sqlite";

import { secureStoreService } from "../security/secure-store-service";
import {
  type ConnectionCredential,
  parseConnectionCredential,
  serializeConnectionCredential,
} from "./connection-profile";

const legacyCredentialKey = "connection.default.credential.v1";

export const credentialStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: secureStoreService("connections"),
} satisfies SecureStore.SecureStoreOptions;

export function createCredentialReference() {
  return `opencode.connection.credential.v1.${Crypto.randomUUID()}`;
}

export async function writeConnectionCredential(
  reference: string,
  credential: ConnectionCredential,
) {
  if (!(await SecureStore.isAvailableAsync())) throw new Error("SECURE_STORE_UNAVAILABLE");
  await SecureStore.setItemAsync(
    reference,
    serializeConnectionCredential(credential),
    credentialStoreOptions,
  );
}

export async function readConnectionCredential(reference: string) {
  if (!(await SecureStore.isAvailableAsync())) throw new Error("SECURE_STORE_UNAVAILABLE");
  const value = await SecureStore.getItemAsync(reference, credentialStoreOptions);
  if (value === null) throw new Error("STORED_CREDENTIAL_MISSING");
  return parseConnectionCredential(value);
}

export async function deleteConnectionCredential(reference: string) {
  if (!(await SecureStore.isAvailableAsync())) throw new Error("SECURE_STORE_UNAVAILABLE");
  await SecureStore.deleteItemAsync(reference, credentialStoreOptions);
}

export async function cleanupPendingCredentialOperations(db: SQLiteDatabase) {
  const writes = await db.getAllAsync<{ credential_ref: string }>(
    "SELECT credential_ref FROM pending_secure_store_writes",
  );
  for (const row of writes) {
    await deleteConnectionCredential(row.credential_ref)
      .then(() =>
        db.runAsync(
          "DELETE FROM pending_secure_store_writes WHERE credential_ref = ?",
          row.credential_ref,
        ),
      )
      .catch(() => undefined);
  }

  const deletions = await db.getAllAsync<{ credential_ref: string }>(
    "SELECT credential_ref FROM pending_secure_store_deletions",
  );
  for (const row of deletions) {
    await deleteConnectionCredential(row.credential_ref)
      .then(() =>
        db.runAsync(
          "DELETE FROM pending_secure_store_deletions WHERE credential_ref = ?",
          row.credential_ref,
        ),
      )
      .catch(() => undefined);
  }

  await SecureStore.deleteItemAsync(legacyCredentialKey).catch(() => undefined);
}
