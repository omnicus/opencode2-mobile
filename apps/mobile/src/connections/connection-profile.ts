import { normalizeOpenCodeBaseUrl } from "@opencode2-mobile/opencode-adapter";

export const connectionProfileSchemaVersion = 1 as const;
export const maxConnectionNameLength = 80;
export const maxCredentialBytes = 2048;

export type ConnectionAuthMode = "basic" | "bearer" | "none";

export type ConnectionCredential =
  | { mode: "basic"; password: string; schemaVersion: 1; username: string }
  | { mode: "bearer"; schemaVersion: 1; token: string };

export type ConnectionHealth = {
  checkedAtMs: number;
  pid: number;
  version: string;
};

export type ConnectionProfile = {
  allowDevelopmentHttp: boolean;
  authMode: ConnectionAuthMode;
  baseUrl: string;
  createdAtMs: number;
  credentialRef?: string;
  id: string;
  lastHealth?: ConnectionHealth;
  lastUsedAtMs?: number;
  name: string;
  schemaVersion: 1;
  updatedAtMs: number;
};

export type ConnectionProfileDraft = {
  allowDevelopmentHttp: boolean;
  authMode: ConnectionAuthMode;
  baseUrl: string;
  id?: string;
  name: string;
};

export type ConnectionProfileRow = {
  allow_development_http: number;
  auth_mode: string;
  base_url: string;
  created_at_ms: number;
  credential_ref: string | null;
  id: string;
  last_health_at_ms: number | null;
  last_health_pid: number | null;
  last_server_version: string | null;
  last_used_at_ms: number | null;
  name: string;
  schema_version: number;
  updated_at_ms: number;
};

export function normalizeConnectionName(value: string) {
  const name = value.trim();
  if (!name || name.length > maxConnectionNameLength) throw new Error("INVALID_CONNECTION_NAME");
  return name;
}

export function serializeConnectionCredential(credential: ConnectionCredential) {
  const value = JSON.stringify(credential);
  if (new TextEncoder().encode(value).byteLength > maxCredentialBytes) {
    throw new Error("CREDENTIAL_TOO_LARGE");
  }
  return value;
}

export function parseConnectionCredential(value: string): ConnectionCredential {
  if (new TextEncoder().encode(value).byteLength > maxCredentialBytes) {
    throw new Error("INVALID_STORED_CREDENTIAL");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("INVALID_STORED_CREDENTIAL");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) throw new Error("INVALID_STORED_CREDENTIAL");
  if (
    parsed.mode === "basic" &&
    typeof parsed.username === "string" &&
    parsed.username.length > 0 &&
    typeof parsed.password === "string" &&
    parsed.password.length > 0
  ) {
    return {
      mode: "basic",
      password: parsed.password,
      schemaVersion: 1,
      username: parsed.username,
    };
  }
  if (parsed.mode === "bearer" && typeof parsed.token === "string" && parsed.token.length > 0) {
    return { mode: "bearer", schemaVersion: 1, token: parsed.token };
  }
  throw new Error("INVALID_STORED_CREDENTIAL");
}

export function decodeConnectionProfile(row: ConnectionProfileRow): ConnectionProfile {
  if (row.schema_version !== connectionProfileSchemaVersion) {
    throw new Error("UNSUPPORTED_CONNECTION_PROFILE_VERSION");
  }
  if (!isAuthMode(row.auth_mode)) throw new Error("INVALID_CONNECTION_PROFILE");
  if (row.allow_development_http !== 0 && row.allow_development_http !== 1) {
    throw new Error("INVALID_CONNECTION_PROFILE");
  }
  if ((row.auth_mode === "none") !== (row.credential_ref === null)) {
    throw new Error("INVALID_CONNECTION_PROFILE");
  }
  const name = normalizeConnectionName(row.name);
  const baseUrl = normalizeOpenCodeBaseUrl(row.base_url);
  if (
    baseUrl !== row.base_url ||
    (baseUrl.startsWith("http:") && row.allow_development_http !== 1)
  ) {
    throw new Error("INVALID_CONNECTION_PROFILE");
  }
  const healthFields = [row.last_health_at_ms, row.last_health_pid, row.last_server_version].filter(
    (value) => value !== null,
  ).length;
  if (healthFields !== 0 && healthFields !== 3) throw new Error("INVALID_CONNECTION_PROFILE");

  const lastHealth =
    row.last_health_at_ms !== null &&
    row.last_health_pid !== null &&
    row.last_server_version !== null
      ? {
          checkedAtMs: row.last_health_at_ms,
          pid: row.last_health_pid,
          version: row.last_server_version,
        }
      : undefined;

  return {
    allowDevelopmentHttp: row.allow_development_http === 1,
    authMode: row.auth_mode,
    baseUrl,
    createdAtMs: row.created_at_ms,
    ...(row.credential_ref ? { credentialRef: row.credential_ref } : {}),
    id: row.id,
    ...(lastHealth ? { lastHealth } : {}),
    ...(row.last_used_at_ms === null ? {} : { lastUsedAtMs: row.last_used_at_ms }),
    name,
    schemaVersion: connectionProfileSchemaVersion,
    updatedAtMs: row.updated_at_ms,
  };
}

function isAuthMode(value: string): value is ConnectionAuthMode {
  return value === "basic" || value === "bearer" || value === "none";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
