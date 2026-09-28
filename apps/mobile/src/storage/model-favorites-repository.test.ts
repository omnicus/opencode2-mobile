import { expect, jest, test } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  modelIdentityKey,
  readModelFavorites,
  setModelFavorite,
} from "./model-favorites-repository";

test("scopes reads and parameterized writes to the exact connection and model identity", async () => {
  const transaction = {
    getFirstAsync: jest.fn(async () => ({ updated_at_ms: 7 })),
    runAsync: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const getAllAsync = jest.fn(async (..._args: unknown[]) => [
    { provider_id: "provider", model_id: "model" },
  ]);
  const db = {
    getAllAsync,
    withExclusiveTransactionAsync: async (fn: (txn: typeof transaction) => Promise<void>) =>
      fn(transaction),
  } as unknown as SQLiteDatabase;
  expect(await readModelFavorites(db, "connection-a")).toEqual([
    { providerID: "provider", id: "model" },
  ]);
  expect(getAllAsync).toHaveBeenCalledWith(
    expect.stringContaining("WHERE connection_id = ?"),
    "connection-a",
  );
  await setModelFavorite(db, "connection-b", 7, { providerID: "provider", id: "model" }, true);
  expect(transaction.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining("INSERT OR IGNORE"),
    "connection-b",
    "provider",
    "model",
    "connection-b",
  );
  await setModelFavorite(db, "connection-b", 7, { providerID: "provider", id: "model" }, false);
  expect(transaction.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining("provider_id = ? AND model_id = ?"),
    "connection-b",
    "provider",
    "model",
  );
});

test("rejects writes after a connection profile is replaced", async () => {
  const runAsync = jest.fn();
  const db = {
    withExclusiveTransactionAsync: async (fn: (txn: unknown) => Promise<void>) =>
      fn({ getFirstAsync: async () => ({ updated_at_ms: 8 }), runAsync }),
  } as unknown as SQLiteDatabase;
  await expect(
    setModelFavorite(db, "connection", 7, { providerID: "provider", id: "model" }, true),
  ).rejects.toThrow("CONNECTION_PROFILE_CHANGED");
  expect(runAsync).not.toHaveBeenCalled();
  expect(modelIdentityKey({ providerID: "a/b", id: "c" })).not.toBe(
    modelIdentityKey({ providerID: "a", id: "b/c" }),
  );
});
