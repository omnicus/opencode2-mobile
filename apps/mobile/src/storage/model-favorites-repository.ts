import type { ModelRef } from "@opencode2-mobile/opencode-adapter";
import type { SQLiteDatabase } from "expo-sqlite";

export type ModelIdentity = Pick<ModelRef, "id" | "providerID">;

export function modelIdentityKey(model: ModelIdentity) {
  return JSON.stringify([model.providerID, model.id]);
}

export async function readModelFavorites(
  db: SQLiteDatabase,
  connectionID: string,
): Promise<ModelIdentity[]> {
  const rows = await db.getAllAsync<{ provider_id: string; model_id: string }>(
    "SELECT provider_id, model_id FROM model_favorites WHERE connection_id = ? ORDER BY position, provider_id, model_id",
    connectionID,
  );
  return rows.map((row) => ({ providerID: row.provider_id, id: row.model_id }));
}

export async function setModelFavorite(
  db: SQLiteDatabase,
  connectionID: string,
  updatedAt: number,
  model: ModelIdentity,
  favorite: boolean,
) {
  if (
    ![connectionID, model.providerID, model.id].every(
      (value) => value.trim() && !value.includes("\u0000"),
    )
  )
    throw new Error("INVALID_MODEL_IDENTITY");
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const profile = await transaction.getFirstAsync<{ updated_at_ms: number }>(
      "SELECT updated_at_ms FROM connection_profiles WHERE id = ?",
      connectionID,
    );
    if (profile?.updated_at_ms !== updatedAt) throw new Error("CONNECTION_PROFILE_CHANGED");
    if (favorite) {
      await transaction.runAsync(
        `INSERT OR IGNORE INTO model_favorites(connection_id, provider_id, model_id, position)
         SELECT ?, ?, ?, COALESCE(MAX(position), -1) + 1 FROM model_favorites WHERE connection_id = ?`,
        connectionID,
        model.providerID,
        model.id,
        connectionID,
      );
    } else {
      await transaction.runAsync(
        "DELETE FROM model_favorites WHERE connection_id = ? AND provider_id = ? AND model_id = ?",
        connectionID,
        model.providerID,
        model.id,
      );
    }
  });
}
