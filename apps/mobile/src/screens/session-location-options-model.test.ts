import { expect, jest, test } from "@jest/globals";
import type { McpServer } from "@opencode2-mobile/opencode-adapter";
import {
  branchCopyLabels,
  mcpChangesAllowed,
  mcpManagementUnsupported,
  mcpServerRowState,
} from "./session-location-options-model";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  classifyOpenCodeError: (error: unknown) =>
    error instanceof Error && error.message === "unsupported" ? "INCOMPATIBLE" : "UNKNOWN",
}));

function server(status: McpServer["status"]["status"]) {
  return { name: "docs", status: { status } } as McpServer;
}

test("labels the branch copy states", () => {
  expect(branchCopyLabels).toEqual({
    idle: "Copy branch name",
    copied: "Copied",
    error: "Try copying again",
  });
});

test("only incompatible failures mark MCP management unsupported", () => {
  const ok = { isError: false, error: null };
  const unsupported = { isError: true, error: new Error("unsupported") };
  expect(mcpManagementUnsupported(ok, ok)).toBe(false);
  expect(mcpManagementUnsupported(unsupported, ok)).toBe(true);
  expect(mcpManagementUnsupported(ok, unsupported)).toBe(true);
  expect(mcpManagementUnsupported({ isError: true, error: new Error("network") }, ok)).toBe(false);
  expect(mcpManagementUnsupported({ isError: false, error: new Error("unsupported") }, ok)).toBe(
    false,
  );
});

test("allows changes once a server list is loaded and nothing blocks them", () => {
  const servers = [server("connected")];
  expect(mcpChangesAllowed(true, servers, false, false)).toBe(true);
  expect(mcpChangesAllowed(true, [], false, false)).toBe(true);
  expect(mcpChangesAllowed(false, servers, false, false)).toBe(false);
  expect(mcpChangesAllowed(true, undefined, false, false)).toBe(false);
  expect(mcpChangesAllowed(true, servers, true, false)).toBe(false);
  expect(mcpChangesAllowed(true, servers, false, true)).toBe(false);
});

test("describes each server status and a pending change to it", () => {
  expect(mcpServerRowState(server("connected"), undefined)).toEqual({
    enabled: true,
    checked: true,
    pending: false,
    status: "Connected",
  });
  expect(mcpServerRowState(server("pending"), undefined).status).toBe("Connecting");
  expect(mcpServerRowState(server("failed"), undefined).status).toBe("Connection failed");
  expect(mcpServerRowState(server("needs_auth"), undefined).status).toBe("Needs authentication");
  expect(mcpServerRowState(server("disabled"), { server: "other", connect: true })).toEqual({
    enabled: false,
    checked: false,
    pending: false,
    status: "Disconnected",
  });
  expect(mcpServerRowState(server("disabled"), { server: "docs", connect: true })).toEqual({
    enabled: false,
    checked: true,
    pending: true,
    status: "Connecting",
  });
  expect(mcpServerRowState(server("connected"), { server: "docs", connect: false })).toEqual({
    enabled: true,
    checked: false,
    pending: true,
    status: "Disconnecting",
  });
});
