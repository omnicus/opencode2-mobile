import { expect, jest, test } from "@jest/globals";
import type { LocationRef, OpenCodeClient } from "@opencode2-mobile/opencode-adapter";

import { loadOpenCodeSessionTreeIds } from "./session-deletion";

type MockPage = ReturnType<typeof page>;

const mockListSessions = jest.fn<(...args: unknown[]) => Promise<MockPage>>();

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  listOpenCodeSessions: (...args: unknown[]) => mockListSessions(...args),
}));

const location = { directory: "/workspace" } satisfies LocationRef;
const client = {} as OpenCodeClient;

test("loads every page of the recursive server child tree", async () => {
  mockListSessions.mockImplementation(async (...args: unknown[]) => {
    const input = args[2] as { cursor?: string; parentID: string };
    if (input.parentID === "ses_root" && !input.cursor) {
      return page([session("ses_child_a", "ses_root")], "next");
    }
    if (input.parentID === "ses_root" && input.cursor === "next") {
      return page([session("ses_child_b", "ses_root")]);
    }
    if (input.parentID === "ses_child_a") {
      return page([session("ses_grandchild", "ses_child_a")]);
    }
    return page([]);
  });

  await expect(
    loadOpenCodeSessionTreeIds(client, location, "ses_root", new AbortController().signal),
  ).resolves.toEqual(["ses_root", "ses_child_a", "ses_child_b", "ses_grandchild"]);
  expect(mockListSessions).toHaveBeenCalledTimes(5);
});

test("rejects a child response that does not match the requested parent", async () => {
  mockListSessions.mockResolvedValue(page([session("ses_child", "ses_other")]));

  await expect(
    loadOpenCodeSessionTreeIds(client, location, "ses_root", new AbortController().signal),
  ).rejects.toThrow("MALFORMED_SESSION_CHILD_LIST");
});

function page(data: ReturnType<typeof session>[], next?: string) {
  return { cursor: { next: next ?? null, previous: null }, data };
}

function session(id: string, parentID: string) {
  return { id, parentID };
}
