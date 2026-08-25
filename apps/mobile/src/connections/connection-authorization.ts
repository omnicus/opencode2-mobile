import { Base64 } from "js-base64";

import type { ConnectionCredential } from "./connection-profile";

export function connectionAuthorizationHeader(credential: ConnectionCredential) {
  if (credential.mode === "bearer") return `Bearer ${credential.token}`;
  return `Basic ${Base64.encode(`${credential.username}:${credential.password}`)}`;
}
