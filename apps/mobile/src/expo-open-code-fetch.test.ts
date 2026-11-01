import { beforeEach, expect, jest, test } from "@jest/globals";
import { fetch as expoFetch } from "expo/fetch";

import { boundedOpenCodeFetch, expoOpenCodeFetch } from "./expo-open-code-fetch";

type WrappedFetch = typeof globalThis.fetch & { kind: string; delegate: typeof globalThis.fetch };

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

jest.mock("@opencode2-mobile/opencode-adapter", () => {
  const wrap = (kind: string) => (delegate: typeof globalThis.fetch) =>
    Object.assign((input: RequestInfo | URL, init?: RequestInit) => delegate(input, init), {
      delegate,
      kind,
    });
  return {
    createBoundedOpenCodeFetch: wrap("bounded"),
    createRedirectSafeOpenCodeFetch: wrap("redirect-safe"),
  };
});

const mockedExpoFetch = expoFetch as unknown as jest.MockedFunction<typeof globalThis.fetch>;

beforeEach(() => {
  mockedExpoFetch.mockReset();
});

function rawExpoOpenCodeFetch() {
  const redirectSafe = (expoOpenCodeFetch as WrappedFetch).delegate as WrappedFetch;
  return redirectSafe.delegate;
}

test("bounds redirect-safe fetches for REST and Expo event transport", () => {
  const bounded = boundedOpenCodeFetch as WrappedFetch;
  const expoBounded = expoOpenCodeFetch as WrappedFetch;
  expect(bounded.kind).toBe("bounded");
  expect((bounded.delegate as WrappedFetch).kind).toBe("redirect-safe");
  expect((bounded.delegate as WrappedFetch).delegate).toBe(globalThis.fetch);
  expect(expoBounded.kind).toBe("bounded");
  expect((expoBounded.delegate as WrappedFetch).kind).toBe("redirect-safe");
  expect(rawExpoOpenCodeFetch()).not.toBe(globalThis.fetch);
});

test("forwards a bare string request without request options", async () => {
  const response = new Response("ok");
  mockedExpoFetch.mockResolvedValue(response);

  await expect(rawExpoOpenCodeFetch()("https://server.test/api/info")).resolves.toBe(response);

  expect(mockedExpoFetch).toHaveBeenCalledWith("https://server.test/api/info");
  expect(mockedExpoFetch.mock.calls[0]).toHaveLength(1);
});

test("converts URL and Request inputs to their URL strings", async () => {
  mockedExpoFetch.mockResolvedValue(new Response("ok"));

  await rawExpoOpenCodeFetch()(new URL("https://server.test/api/info?x=1"));
  await rawExpoOpenCodeFetch()(new Request("https://server.test/api/event"));

  expect(mockedExpoFetch.mock.calls).toEqual([
    ["https://server.test/api/info?x=1"],
    ["https://server.test/api/event"],
  ]);
});

test("omits empty request options", async () => {
  mockedExpoFetch.mockResolvedValue(new Response("ok"));

  await rawExpoOpenCodeFetch()("https://server.test/api/info", { body: null });
  await rawExpoOpenCodeFetch()("https://server.test/api/info", {});

  expect(mockedExpoFetch.mock.calls).toEqual([
    ["https://server.test/api/info", {}],
    ["https://server.test/api/info", {}],
  ]);
});

test("forwards only body, headers, method, redirect, and signal", async () => {
  mockedExpoFetch.mockResolvedValue(new Response("ok"));
  const controller = new AbortController();
  const headers = { authorization: "Basic secret", "content-type": "application/json" };

  await rawExpoOpenCodeFetch()("https://server.test/api/session", {
    body: '{"title":"x"}',
    cache: "no-store",
    credentials: "include",
    headers,
    method: "POST",
    mode: "cors",
    redirect: "manual",
    referrer: "https://other.test",
    signal: controller.signal,
  });

  expect(mockedExpoFetch).toHaveBeenCalledWith("https://server.test/api/session", {
    body: '{"title":"x"}',
    headers,
    method: "POST",
    redirect: "manual",
    signal: controller.signal,
  });
  const options = mockedExpoFetch.mock.calls[0]?.[1];
  expect(options?.headers).toBe(headers);
  expect(options?.signal).toBe(controller.signal);
});
