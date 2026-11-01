import { expect, jest, test } from "@jest/globals";
import { EventProbeError, PtyProbeError } from "@opencode2-mobile/opencode-adapter";
import type { ConnectionProfile } from "../connections/connection-profile";
import {
  authorizationOption,
  type ConnectionFormValues,
  connectButtonLabel,
  connectionDiagnostic,
  connectionErrorMessage,
  connectionSaveRequest,
  credentialFromInput,
  emptyConnectionFormValues,
  eventProbeErrorMessage,
  formSecret,
  httpNotAllowedMessage,
  isLoopbackHost,
  profileErrorMessage,
  profileFormValues,
  ptyProbeErrorMessage,
  resolveConnectionTarget,
  runtimeStatusLabel,
  urlErrorMessage,
} from "./connection-screen-model";

jest.mock("@opencode2-mobile/opencode-adapter", () => {
  class ProbeError extends Error {
    readonly reason: string;

    constructor(reason: string) {
      super(reason);
      this.reason = reason;
    }
  }
  return {
    classifyOpenCodeError: (error: unknown) =>
      typeof error === "object" && error !== null && "kind" in error ? error.kind : "UNREACHABLE",
    EventProbeError: class EventProbeError extends ProbeError {},
    normalizeOpenCodeBaseUrl: (value: string) => {
      const url = new URL(value.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("UNSUPPORTED_PROTOCOL");
      }
      if (url.username || url.password) throw new Error("EMBEDDED_CREDENTIALS");
      if (url.pathname !== "/" || url.search || url.hash) {
        throw new Error("BASE_URL_MUST_BE_ORIGIN");
      }
      return url.origin;
    },
    PtyProbeError: class PtyProbeError extends ProbeError {},
  };
});

const profile: ConnectionProfile = {
  allowDevelopmentHttp: true,
  authMode: "basic",
  baseUrl: "http://saved.test",
  createdAtMs: 1,
  id: "profile-1",
  name: "Saved server",
  schemaVersion: 1,
  updatedAtMs: 1,
};

function values(overrides: Partial<ConnectionFormValues> = {}): ConnectionFormValues {
  return {
    allowHttp: false,
    authMode: "basic",
    name: "Server",
    origin: "https://server.test",
    password: "secret",
    token: "token",
    username: "opencode",
    ...overrides,
  };
}

const checked = {
  advertisedUrls: 1,
  checkedAtMs: 1234,
  pid: 42,
  sessions: 3,
  version: "1.0.0",
};

test("fills the form from a profile and its credential", () => {
  expect(
    profileFormValues(profile, {
      mode: "basic",
      password: "pw",
      schemaVersion: 1,
      username: "user",
    }),
  ).toEqual({
    allowHttp: true,
    authMode: "basic",
    name: "Saved server",
    origin: "http://saved.test",
    password: "pw",
    token: "",
    username: "user",
  });
  expect(
    profileFormValues(profile, { mode: "bearer", schemaVersion: 1, token: "token" }),
  ).toMatchObject({ password: "", token: "token", username: "" });
  expect(profileFormValues(profile)).toMatchObject({ password: "", token: "", username: "" });
});

test("starts a new form empty with basic authentication", () => {
  expect(emptyConnectionFormValues).toEqual({
    allowHttp: false,
    authMode: "basic",
    name: "",
    origin: "",
    password: "",
    token: "",
    username: "",
  });
});

test("reads the secret that belongs to the authentication mode", () => {
  expect(formSecret(values())).toBe("secret");
  expect(formSecret(values({ authMode: "bearer" }))).toBe("token");
  expect(formSecret(values({ authMode: "none" }))).toBe("");
});

test("resolves a connection target or the first validation error", () => {
  expect(resolveConnectionTarget(values(), false)).toEqual({
    credential: { mode: "basic", password: "secret", schemaVersion: 1, username: "opencode" },
    origin: "https://server.test",
  });
  expect(resolveConnectionTarget(values({ origin: "server.test" }), false)).toMatchObject({
    origin: "https://server.test",
  });
  expect(resolveConnectionTarget(values({ origin: "" }), false)).toEqual({
    error: "Enter a server address, like 192.168.1.20:4096 or https://opencode.example.com.",
  });
  expect(resolveConnectionTarget(values({ origin: "http://server.test" }), false)).toEqual({
    error: httpNotAllowedMessage,
  });
  expect(
    resolveConnectionTarget(values({ allowHttp: true, origin: "http://localhost:4096" }), true),
  ).toEqual({
    error:
      "localhost points to this phone. Use your computer's network address, Tailscale address, or hostname.",
  });
  expect(
    resolveConnectionTarget(values({ allowHttp: true, origin: "http://localhost:4096" }), false),
  ).toMatchObject({ origin: "http://localhost:4096" });
  expect(resolveConnectionTarget(values({ username: "" }), false)).toEqual({
    error: "Enter a username and password.",
  });
  expect(resolveConnectionTarget(values({ authMode: "bearer", token: "" }), false)).toEqual({
    error: "Enter a bearer token.",
  });
  expect(resolveConnectionTarget(values({ authMode: "none" }), false)).toEqual({
    credential: undefined,
    origin: "https://server.test",
  });
});

test("summarizes a server check", () => {
  jest.spyOn(Date, "now").mockReturnValue(1234);
  const diagnostic = connectionDiagnostic({ pid: 42, urls: ["a", "b"], version: "1.0.0" }, 3);
  jest.restoreAllMocks();

  expect(diagnostic).toEqual({
    advertisedUrls: 2,
    checkedAtMs: 1234,
    pid: 42,
    sessions: 3,
    version: "1.0.0",
  });
});

test("builds the save request from the checked target", () => {
  const credential = { mode: "bearer", schemaVersion: 1, token: "token" } as const;
  expect(
    connectionSaveRequest(
      values({ name: "  Server  " }),
      { credential, origin: "https://server.test" },
      checked,
      "id",
    ),
  ).toEqual({
    credential,
    draft: {
      allowDevelopmentHttp: false,
      authMode: "basic",
      baseUrl: "https://server.test",
      id: "id",
      name: "Server",
    },
    health: { checkedAtMs: 1234, pid: 42, version: "1.0.0" },
  });
  expect(
    connectionSaveRequest(
      values({ name: " " }),
      { credential: undefined, origin: `https://${"a".repeat(90)}.test` },
      checked,
      undefined,
    ),
  ).toEqual({
    draft: {
      allowDevelopmentHttp: false,
      authMode: "basic",
      baseUrl: `https://${"a".repeat(90)}.test`,
      name: "a".repeat(80),
    },
    health: { checkedAtMs: 1234, pid: 42, version: "1.0.0" },
  });
});

test("adds authorization only when a credential exists", () => {
  expect(authorizationOption(undefined)).toEqual({});
  expect(authorizationOption({ mode: "bearer", schemaVersion: 1, token: "token" })).toEqual({
    authorization: "Bearer token",
  });
});

test("labels the connect button for its current step", () => {
  expect(connectButtonLabel(true, true, "id")).toBe("Connecting…");
  expect(connectButtonLabel(false, true, "id")).toBe("Saving…");
  expect(connectButtonLabel(false, false, "id")).toBe("Save changes");
  expect(connectButtonLabel(false, false, undefined)).toBe("Connect");
});

test("reads credentials from the form fields", () => {
  expect(credentialFromInput("none", "", "")).toBeUndefined();
  expect(credentialFromInput("bearer", "", "token")).toEqual({
    mode: "bearer",
    schemaVersion: 1,
    token: "token",
  });
  expect(credentialFromInput("bearer", "", "")).toBe("MISSING");
  expect(credentialFromInput("basic", "user", "")).toBe("MISSING");
  expect(credentialFromInput("basic", "", "pw")).toBe("MISSING");
  expect(credentialFromInput("basic", "user", "pw")).toEqual({
    mode: "basic",
    password: "pw",
    schemaVersion: 1,
    username: "user",
  });
});

test.each([
  ["http://localhost:4096", true],
  ["http://LOCALHOST", true],
  ["http://127.0.0.1:4096", true],
  ["http://[::1]:4096", true],
  ["http://100.64.0.10:4096", false],
])("treats %s as loopback: %s", (origin, loopback) => {
  expect(isLoopbackHost(origin)).toBe(loopback);
});

test.each([
  ["not an error", "The connection could not be saved."],
  [new Error("INVALID_CONNECTION_NAME"), "Enter a connection name between 1 and 80 characters."],
  [new Error("CREDENTIAL_TOO_LARGE"), "The credential is too large to store."],
  [
    new Error("SECURE_STORE_UNAVAILABLE"),
    "Secure credential storage is not available on this device.",
  ],
  [new Error("OTHER"), "The connection could not be saved."],
])("explains profile error %#", (error, message) => {
  expect(profileErrorMessage(error)).toBe(message);
});

test.each([
  [
    "not an error",
    "Enter a server address, like 192.168.1.20:4096 or https://opencode.example.com.",
  ],
  [new Error("UNSUPPORTED_PROTOCOL"), "Use an address that starts with http:// or https://."],
  [
    new Error("EMBEDDED_CREDENTIALS"),
    "Enter the username and password in their own fields, not in the address.",
  ],
  [
    new Error("BASE_URL_MUST_BE_ORIGIN"),
    "Enter only the server address and port, with nothing after them.",
  ],
  [
    new Error("OTHER"),
    "Enter a server address, like 192.168.1.20:4096 or https://opencode.example.com.",
  ],
])("explains URL error %#", (error, message) => {
  expect(urlErrorMessage(error)).toBe(message);
});

test.each<[Parameters<typeof connectionErrorMessage>[0], string]>([
  ["UNAUTHORIZED", "The server rejected these credentials."],
  ["TIMEOUT", "The server did not respond within 10 seconds."],
  ["TLS", "The server's TLS certificate could not be verified."],
  ["INCOMPATIBLE", "The server does not expose the required OpenCode V2 API."],
  ["MALFORMED_RESPONSE", "The server returned an undecodable response."],
  ["UNSUPPORTED_CONTENT", "The server returned an unexpected content type."],
  ["SSE_TOO_LARGE", "The server returned an event larger than the client limit."],
  ["RESPONSE_TOO_LARGE", "The server returned JSON larger than the client limit."],
  ["UNSAFE_REDIRECT", "The server tried to redirect this request outside its approved origin."],
  ["UNREACHABLE", "The server could not be reached. Check its address, network, and TLS settings."],
])("explains %s connection failures", (kind, message) => {
  expect(connectionErrorMessage(kind)).toBe(message);
});

test.each([
  [new EventProbeError("NO_EVENT"), "No event arrived within 10 seconds."],
  [new EventProbeError("STREAM_ENDED"), "The event stream ended before its first event."],
  [
    new EventProbeError("CANCELLATION_IGNORED"),
    "AbortSignal did not stop the event stream within 3 seconds.",
  ],
  [
    { kind: "UNSUPPORTED_CONTENT" },
    "The server or this Expo runtime does not expose a readable event stream.",
  ],
  [{ kind: "MALFORMED_RESPONSE" }, "The event stream returned an undecodable frame."],
  [{ kind: "RESPONSE_TOO_LARGE" }, "The server returned JSON larger than the client limit."],
])("explains event probe failure %#", (error, message) => {
  expect(eventProbeErrorMessage(error)).toBe(message);
});

test.each([
  [new PtyProbeError("WEBSOCKET_UNAVAILABLE"), "This runtime does not provide WebSocket."],
  [
    new PtyProbeError("SOCKET_TIMEOUT"),
    "The PTY WebSocket did not return the probe marker within 5 seconds.",
  ],
  [
    new PtyProbeError("SOCKET_CLOSED"),
    "The PTY WebSocket closed before returning the probe marker.",
  ],
  [new PtyProbeError("SOCKET_ERROR"), "The PTY WebSocket connection failed."],
  [
    new PtyProbeError("OUTPUT_TOO_LARGE"),
    "The PTY returned more than 64 KiB before the probe marker.",
  ],
  [new PtyProbeError("CLEANUP_FAILED"), "The temporary PTY worked but could not be removed."],
  [{ _tag: "ForbiddenError" }, "The server rejected the PTY connect-ticket request."],
  [
    { _tag: "OtherError" },
    "The server could not be reached. Check its address, network, and TLS settings.",
  ],
  [{}, "The server could not be reached. Check its address, network, and TLS settings."],
  [null, "The server could not be reached. Check its address, network, and TLS settings."],
  ["failure", "The server could not be reached. Check its address, network, and TLS settings."],
])("explains PTY probe failure %#", (error, message) => {
  expect(ptyProbeErrorMessage(error)).toBe(message);
});

test("labels every runtime status", () => {
  expect(runtimeStatusLabel("connected")).toBe("Connected");
  expect(runtimeStatusLabel("unauthorized")).toBe("Authorization required");
});
