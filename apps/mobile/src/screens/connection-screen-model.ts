import {
  classifyOpenCodeError,
  EventProbeError,
  normalizeOpenCodeBaseUrl,
  PtyProbeError,
} from "@opencode2-mobile/opencode-adapter";
import { connectionAuthorizationHeader } from "../connections/connection-authorization";
import type {
  ConnectionAuthMode,
  ConnectionCredential,
  ConnectionProfile,
} from "../connections/connection-profile";
import { withInferredScheme } from "../connections/server-address";
import type { useConnectionRuntime } from "../state/connection-runtime-context";

export type Diagnostic = {
  advertisedUrls: number;
  checkedAtMs: number;
  pid: number;
  sessions: number;
  version: string;
};

export type StreamDiagnostic = {
  cancellation: true;
  eventType: string;
};

export type PtyDiagnostic = {
  cleanup: true;
  output: true;
  ticketExpiresIn: number;
};

export type ConnectionFormValues = {
  allowHttp: boolean;
  authMode: ConnectionAuthMode;
  name: string;
  origin: string;
  password: string;
  token: string;
  username: string;
};

export type ConnectionTarget = {
  credential: ConnectionCredential | undefined;
  origin: string;
};

export const httpNotAllowedMessage =
  "This address uses HTTP. Turn on Allow HTTP below or use https://.";

export const emptyConnectionFormValues: ConnectionFormValues = {
  allowHttp: false,
  authMode: "basic",
  name: "",
  origin: "",
  password: "",
  token: "",
  username: "",
};

export function profileFormValues(
  profile: ConnectionProfile,
  credential?: ConnectionCredential,
): ConnectionFormValues {
  return {
    allowHttp: profile.allowDevelopmentHttp,
    authMode: profile.authMode,
    name: profile.name,
    origin: profile.baseUrl,
    password: credential?.mode === "basic" ? credential.password : "",
    token: credential?.mode === "bearer" ? credential.token : "",
    username: credential?.mode === "basic" ? credential.username : "",
  };
}

export function formSecret(values: ConnectionFormValues) {
  if (values.authMode === "basic") return values.password;
  return values.authMode === "bearer" ? values.token : "";
}

export function resolveConnectionTarget(
  values: ConnectionFormValues,
  rejectLoopback: boolean,
): ConnectionTarget | { error: string } {
  let origin: string;
  try {
    origin = normalizeOpenCodeBaseUrl(withInferredScheme(values.origin));
  } catch (caught) {
    return { error: urlErrorMessage(caught) };
  }
  if (origin.startsWith("http:") && !values.allowHttp) {
    return { error: httpNotAllowedMessage };
  }
  if (rejectLoopback && isLoopbackHost(origin)) {
    return {
      error:
        "localhost points to this phone. Use your computer's network address, Tailscale address, or hostname.",
    };
  }
  const credential = credentialFromInput(values.authMode, values.username, formSecret(values));
  if (credential === "MISSING") {
    return {
      error:
        values.authMode === "basic" ? "Enter a username and password." : "Enter a bearer token.",
    };
  }
  return { credential, origin };
}

export function connectionDiagnostic(
  health: { pid: number; urls: readonly unknown[]; version: string },
  sessions: number,
): Diagnostic {
  return {
    advertisedUrls: health.urls.length,
    checkedAtMs: Date.now(),
    pid: health.pid,
    sessions,
    version: health.version,
  };
}

export function connectionSaveRequest(
  values: ConnectionFormValues,
  target: ConnectionTarget,
  checked: Diagnostic,
  editingProfileId: string | undefined,
) {
  return {
    ...(target.credential ? { credential: target.credential } : {}),
    draft: {
      allowDevelopmentHttp: values.allowHttp,
      authMode: values.authMode,
      baseUrl: target.origin,
      ...(editingProfileId ? { id: editingProfileId } : {}),
      name: values.name.trim() || new URL(target.origin).hostname.slice(0, 80),
    },
    health: {
      checkedAtMs: checked.checkedAtMs,
      pid: checked.pid,
      version: checked.version,
    },
  };
}

export function authorizationOption(credential: ConnectionCredential | undefined) {
  return credential ? { authorization: connectionAuthorizationHeader(credential) } : {};
}

export function connectButtonLabel(
  busy: boolean,
  saving: boolean,
  editingProfileId: string | undefined,
) {
  if (busy) return "Connecting…";
  if (saving) return "Saving…";
  return editingProfileId ? "Save changes" : "Connect";
}

export function credentialFromInput(
  mode: ConnectionAuthMode,
  username: string,
  secret: string,
): ConnectionCredential | "MISSING" | undefined {
  if (mode === "none") return undefined;
  if (mode === "bearer") return secret ? { mode, schemaVersion: 1, token: secret } : "MISSING";
  return username && secret ? { mode, password: secret, schemaVersion: 1, username } : "MISSING";
}

export function isLoopbackHost(origin: string) {
  const hostname = new URL(origin).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function profileErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "The connection could not be saved.";
  if (error.message === "INVALID_CONNECTION_NAME") {
    return "Enter a connection name between 1 and 80 characters.";
  }
  if (error.message === "CREDENTIAL_TOO_LARGE") return "The credential is too large to store.";
  if (error.message === "SECURE_STORE_UNAVAILABLE") {
    return "Secure credential storage is not available on this device.";
  }
  return "The connection could not be saved.";
}

export function runtimeStatusLabel(status: ReturnType<typeof useConnectionRuntime>["status"]) {
  return {
    connected: "Connected",
    connecting: "Connecting",
    idle: "No connection selected",
    incompatible: "Incompatible server",
    offline: "Device offline",
    reconnecting: "Reconnecting",
    stale: "Connection paused",
    unauthorized: "Authorization required",
  }[status];
}

export function urlErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : undefined;
  if (code === "UNSUPPORTED_PROTOCOL") {
    return "Use an address that starts with http:// or https://.";
  }
  if (code === "EMBEDDED_CREDENTIALS") {
    return "Enter the username and password in their own fields, not in the address.";
  }
  if (code === "BASE_URL_MUST_BE_ORIGIN") {
    return "Enter only the server address and port, with nothing after them.";
  }
  return "Enter a server address, like 192.168.1.20:4096 or https://opencode.example.com.";
}

export function connectionErrorMessage(kind: ReturnType<typeof classifyOpenCodeError>) {
  if (kind === "UNAUTHORIZED") return "The server rejected these credentials.";
  if (kind === "TIMEOUT") return "The server did not respond within 10 seconds.";
  if (kind === "TLS") return "The server's TLS certificate could not be verified.";
  if (kind === "INCOMPATIBLE") return "The server does not expose the required OpenCode V2 API.";
  if (kind === "MALFORMED_RESPONSE") return "The server returned an undecodable response.";
  if (kind === "UNSUPPORTED_CONTENT") return "The server returned an unexpected content type.";
  if (kind === "SSE_TOO_LARGE") return "The server returned an event larger than the client limit.";
  if (kind === "RESPONSE_TOO_LARGE")
    return "The server returned JSON larger than the client limit.";
  if (kind === "UNSAFE_REDIRECT") {
    return "The server tried to redirect this request outside its approved origin.";
  }
  return "The server could not be reached. Check its address, network, and TLS settings.";
}

export function eventProbeErrorMessage(error: unknown) {
  if (error instanceof EventProbeError) {
    if (error.reason === "NO_EVENT") return "No event arrived within 10 seconds.";
    if (error.reason === "STREAM_ENDED") return "The event stream ended before its first event.";
    return "AbortSignal did not stop the event stream within 3 seconds.";
  }

  const kind = classifyOpenCodeError(error);
  if (kind === "UNSUPPORTED_CONTENT") {
    return "The server or this Expo runtime does not expose a readable event stream.";
  }
  if (kind === "MALFORMED_RESPONSE") return "The event stream returned an undecodable frame.";
  return connectionErrorMessage(kind);
}

export function ptyProbeErrorMessage(error: unknown) {
  if (error instanceof PtyProbeError) {
    if (error.reason === "WEBSOCKET_UNAVAILABLE") return "This runtime does not provide WebSocket.";
    if (error.reason === "SOCKET_TIMEOUT") {
      return "The PTY WebSocket did not return the probe marker within 5 seconds.";
    }
    if (error.reason === "SOCKET_CLOSED") {
      return "The PTY WebSocket closed before returning the probe marker.";
    }
    if (error.reason === "SOCKET_ERROR") return "The PTY WebSocket connection failed.";
    if (error.reason === "OUTPUT_TOO_LARGE") {
      return "The PTY returned more than 64 KiB before the probe marker.";
    }
    return "The temporary PTY worked but could not be removed.";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "ForbiddenError"
  ) {
    return "The server rejected the PTY connect-ticket request.";
  }
  return connectionErrorMessage(classifyOpenCodeError(error));
}
