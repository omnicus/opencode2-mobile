import { expect, test } from "@jest/globals";

import { permissionActionExplanation, permissionActionHeading } from "./permission-presentation";

test("explains documented V2 built-in permission actions", () => {
  expect(permissionActionExplanation("shell")).toContain("raw command");
  expect(permissionActionExplanation("external_directory")).toContain("outside");
  expect(permissionActionExplanation("subagent")).toContain("subagent");
});

test("does not invent explanations for plugin permission actions", () => {
  expect(permissionActionExplanation("custom_server_tool")).toBeUndefined();
});

test("labels built-in actions in plain words with resource counts", () => {
  expect(permissionActionHeading("edit", 3)).toEqual({ icon: "edit-3", label: "Edit 3 files" });
  expect(permissionActionHeading("edit", 1)?.label).toBe("Edit 1 file");
  expect(permissionActionHeading("edit", 0)?.label).toBe("Edit files");
  expect(permissionActionHeading("read", 2)?.label).toBe("Read 2 files");
  expect(permissionActionHeading("shell", 1)?.label).toBe("Run shell command");
  expect(permissionActionHeading("custom_server_tool", 1)).toBeUndefined();
});
