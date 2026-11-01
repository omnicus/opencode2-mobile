import { expect, test } from "@jest/globals";
import {
  canSaveSessionName,
  sessionActionReady,
  sessionArchiveLabel,
  sessionSheetSize,
  sessionSheetTitles,
} from "./session-action-sheet-model";

test("sizes the confirmation pages compactly and the editors as pages", () => {
  expect(sessionSheetSize("menu")).toBe("compact");
  expect(sessionSheetSize("delete")).toBe("compact");
  expect(sessionSheetSize("rename")).toBe("page");
  expect(sessionSheetSize("devtools")).toBe("page");
  expect(sessionSheetTitles.delete).toBe("Delete session?");
});

test("an archived session offers Unarchive, any other offers Archive", () => {
  expect(sessionArchiveLabel(false)).toBe("Archive");
  expect(sessionArchiveLabel(true)).toBe("Unarchive");
});

test("a name is savable only when connected, non-blank and changed", () => {
  expect(canSaveSessionName(true, " Next ", "Original")).toBe(true);
  expect(canSaveSessionName(false, "Next", "Original")).toBe(false);
  expect(canSaveSessionName(true, "   ", "Original")).toBe(false);
  expect(canSaveSessionName(true, " Original ", "Original")).toBe(false);
  expect(canSaveSessionName(true, "Next", undefined)).toBe(true);
});

test("remote actions need a connection and a rename needs a name", () => {
  const ready = { connected: true, title: "Name" };
  expect(sessionActionReady("archive", ready)).toBe(true);
  expect(sessionActionReady("archive", { ...ready, title: "" })).toBe(true);
  expect(sessionActionReady("archive", { ...ready, connected: false })).toBe(false);
  expect(sessionActionReady("delete", ready)).toBe(true);
  expect(sessionActionReady("delete", { connected: false, title: "" })).toBe(false);
  expect(sessionActionReady("delete", { ...ready, title: "" })).toBe(true);
  expect(sessionActionReady("rename", ready)).toBe(true);
  expect(sessionActionReady("rename", { ...ready, title: "   " })).toBe(false);
  expect(sessionActionReady("rename", { ...ready, connected: false })).toBe(false);
});
