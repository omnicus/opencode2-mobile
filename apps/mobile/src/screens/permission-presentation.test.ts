import { expect, test } from "@jest/globals";

import { permissionActionExplanation } from "./permission-presentation";

test("explains documented V2 built-in permission actions", () => {
  expect(permissionActionExplanation("shell")).toContain("raw command");
  expect(permissionActionExplanation("external_directory")).toContain("outside");
  expect(permissionActionExplanation("subagent")).toContain("subagent");
});

test("does not invent explanations for plugin permission actions", () => {
  expect(permissionActionExplanation("custom_server_tool")).toBeUndefined();
});
