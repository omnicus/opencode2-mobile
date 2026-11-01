import { expect, test } from "@jest/globals";

import { addressHostname, withInferredScheme } from "./server-address";

test.each([
  ["localhost:4096", "http://localhost:4096"],
  ["127.0.0.1:4096", "http://127.0.0.1:4096"],
  ["10.0.0.5", "http://10.0.0.5"],
  ["172.16.4.2:4096", "http://172.16.4.2:4096"],
  ["192.168.1.20:4096", "http://192.168.1.20:4096"],
  ["100.64.0.10:4096", "http://100.64.0.10:4096"],
  ["100.127.255.1", "http://100.127.255.1"],
  ["studio.local:4096", "http://studio.local:4096"],
  ["  opencode.example.com  ", "https://opencode.example.com"],
  ["172.32.0.1", "https://172.32.0.1"],
  ["100.128.0.1", "https://100.128.0.1"],
  ["devbox.tail1234.ts.net:4096", "https://devbox.tail1234.ts.net:4096"],
])("adds a scheme to %s", (input, expected) => {
  expect(withInferredScheme(input)).toBe(expected);
});

test("keeps an explicit scheme", () => {
  expect(withInferredScheme("http://opencode.example.com")).toBe("http://opencode.example.com");
  expect(withInferredScheme("https://192.168.1.20")).toBe("https://192.168.1.20");
  expect(withInferredScheme("")).toBe("");
});

test("reads the hostname from a bare or full address", () => {
  expect(addressHostname("192.168.1.20:4096")).toBe("192.168.1.20");
  expect(addressHostname("https://opencode.example.com")).toBe("opencode.example.com");
  expect(addressHostname("not a url")).toBeUndefined();
});
