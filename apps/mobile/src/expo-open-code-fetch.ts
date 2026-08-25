import {
  createBoundedOpenCodeFetch,
  createRedirectSafeOpenCodeFetch,
} from "@opencode2-mobile/opencode-adapter";
import { fetch as expoFetch } from "expo/fetch";

export const boundedOpenCodeFetch = createBoundedOpenCodeFetch(
  createRedirectSafeOpenCodeFetch(globalThis.fetch),
);

const rawExpoOpenCodeFetch: typeof globalThis.fetch = (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!init) return expoFetch(url);

  return expoFetch(url, {
    ...(init.body === null || init.body === undefined ? {} : { body: init.body }),
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.method ? { method: init.method } : {}),
    ...(init.redirect ? { redirect: init.redirect } : {}),
    ...(init.signal ? { signal: init.signal } : {}),
  });
};

export const expoOpenCodeFetch = createBoundedOpenCodeFetch(
  createRedirectSafeOpenCodeFetch(rawExpoOpenCodeFetch),
);
