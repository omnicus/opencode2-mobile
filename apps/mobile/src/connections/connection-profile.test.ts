import { expect, jest, test } from "@jest/globals";

import {
  type ConnectionProfileRow,
  decodeConnectionProfile,
  parseConnectionCredential,
  serializeConnectionCredential,
} from "./connection-profile";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  normalizeOpenCodeBaseUrl: (value: string) => {
    const url = new URL(value);
    if (url.pathname !== "/" || url.search || url.hash) throw new Error("BASE_URL_MUST_BE_ORIGIN");
    return url.origin;
  },
}));

const row: ConnectionProfileRow = {
  allow_development_http: 0,
  auth_mode: "bearer",
  base_url: "https://server.test",
  created_at_ms: 1,
  credential_ref: "credential-ref",
  id: "profile-1",
  last_health_at_ms: 2,
  last_health_pid: 42,
  last_server_version: "test",
  last_used_at_ms: 3,
  name: "Test server",
  schema_version: 1,
  updated_at_ms: 4,
};

test("decodes the versioned non-secret profile schema", () => {
  expect(decodeConnectionProfile(row)).toEqual({
    allowDevelopmentHttp: false,
    authMode: "bearer",
    baseUrl: "https://server.test",
    createdAtMs: 1,
    credentialRef: "credential-ref",
    id: "profile-1",
    lastHealth: { checkedAtMs: 2, pid: 42, version: "test" },
    lastUsedAtMs: 3,
    name: "Test server",
    schemaVersion: 1,
    updatedAtMs: 4,
  });
});

test("rejects an unsupported profile schema version", () => {
  expect(() => decodeConnectionProfile({ ...row, schema_version: 2 })).toThrow(
    "UNSUPPORTED_CONNECTION_PROFILE_VERSION",
  );
});

test("rejects invalid persisted URL and credential combinations", () => {
  expect(() => decodeConnectionProfile({ ...row, base_url: "https://server.test/path" })).toThrow(
    "BASE_URL_MUST_BE_ORIGIN",
  );
  expect(() =>
    decodeConnectionProfile({ ...row, auth_mode: "none", credential_ref: "credential-ref" }),
  ).toThrow("INVALID_CONNECTION_PROFILE");
  expect(() =>
    decodeConnectionProfile({ ...row, allow_development_http: 0, base_url: "http://server.test" }),
  ).toThrow("INVALID_CONNECTION_PROFILE");
});

test("round trips a versioned credential without accepting malformed values", () => {
  const credential = {
    mode: "basic" as const,
    password: "secret",
    schemaVersion: 1 as const,
    username: "opencode",
  };
  expect(parseConnectionCredential(serializeConnectionCredential(credential))).toEqual(credential);
  expect(() => parseConnectionCredential('{"mode":"bearer","schemaVersion":1,"token":""}')).toThrow(
    "INVALID_STORED_CREDENTIAL",
  );
});
