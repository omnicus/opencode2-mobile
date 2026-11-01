import { expect, test } from "@jest/globals";

import {
  moveFollowedProject,
  orderProjects,
  projectLabel,
  sortProjectIDs,
  toggleFollowedProject,
} from "./followed-projects-screen-model";

const projects = ["a", "b", "c", "d", "e"].map((id) => ({ canonical: `/${id}`, id }));

test("sorts followed projects in follow order before the rest in server order", () => {
  expect(sortProjectIDs(projects, ["d", "missing", "b"])).toEqual(["d", "b", "a", "c", "e"]);
  expect(sortProjectIDs(projects, [])).toEqual(["a", "b", "c", "d", "e"]);
});

test("keeps opening slots, fills followed slots in saved order, and appends new projects", () => {
  const ids = (ordered: { id: string }[]) => ordered.map(({ id }) => id);
  expect(ids(orderProjects(projects, ["b"], []))).toEqual(["a", "b", "c", "d", "e"]);
  expect(ids(orderProjects(projects, ["b", "d"], ["b", "a", "c", "d", "e"]))).toEqual([
    "b",
    "a",
    "c",
    "d",
    "e",
  ]);
  expect(ids(orderProjects(projects, ["d", "b"], ["b", "a", "c", "d", "e"]))).toEqual([
    "d",
    "a",
    "c",
    "b",
    "e",
  ]);
  expect(
    ids(orderProjects([...projects, { canonical: "/f", id: "f" }], ["a"], ["gone", "e", "a"])),
  ).toEqual(["e", "a", "b", "c", "d", "f"]);
});

test("toggles a project by appending or removing only that ID", () => {
  expect(toggleFollowedProject(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  expect(toggleFollowedProject(["a", "b", "c"], "b")).toEqual(["a", "c"]);
});

test("swaps a followed project with its neighbour and ignores moves past either end", () => {
  expect(moveFollowedProject(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
  expect(moveFollowedProject(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  expect(moveFollowedProject(["a", "b", "c"], "a", -1)).toBeUndefined();
  expect(moveFollowedProject(["a", "b", "c"], "c", 1)).toBeUndefined();
  expect(moveFollowedProject(["a", "b"], "missing", 1)).toBeUndefined();
  expect(moveFollowedProject(["a", ""], "a", 1)).toBeUndefined();
});

test("labels a project by name, then last path segment, then ID", () => {
  expect(projectLabel({ canonical: "/work/app", id: "p1", name: " Named " })).toBe("Named");
  expect(projectLabel({ canonical: "C:\\work\\app\\", id: "p1", name: "  " })).toBe("app");
  expect(projectLabel({ canonical: "/", id: "p1" })).toBe("p1");
});
