import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { FollowedProjectsScreen } from "./followed-projects-screen";

jest.mock("../state/workspace-selection-context", () => ({ useWorkspaceSelection: jest.fn() }));
jest.mock("./app-shell", () => ({
  ShellFrame: ({ children }: { children: ReactNode }) => children,
}));

test("follows, unfollows, and reorders only local project IDs", () => {
  const setFollowedProjectIds = jest.fn(async () => undefined);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    followedProjectIds: ["project-b", "project-a", "project-missing"],
    preferencesLoading: false,
    preferencesSaving: false,
    projects: [
      {
        canonical: "/a",
        id: "project-a",
        name: "Alpha",
        sandboxes: [],
        time: { created: 1, updated: 1 },
      },
      {
        canonical: "/b",
        id: "project-b",
        name: "Beta",
        sandboxes: [],
        time: { created: 1, updated: 1 },
      },
      {
        canonical: "/c",
        id: "project-c",
        name: "Gamma",
        sandboxes: [],
        time: { created: 1, updated: 1 },
      },
    ],
    projectsError: false,
    projectsLoading: false,
    setFollowedProjectIds,
    unavailableProjectIds: ["project-missing"],
  } as never);

  render(
    <FollowedProjectsScreen
      navigation={{ navigate: jest.fn() } as never}
      route={{ key: "followed", name: "FollowedProjects" }}
    />,
  );

  fireEvent.press(screen.getByRole("checkbox", { name: "Gamma, Not followed" }));
  expect(setFollowedProjectIds).toHaveBeenCalledWith([
    "project-b",
    "project-a",
    "project-missing",
    "project-c",
  ]);

  fireEvent.press(screen.getByRole("button", { name: "Move Alpha earlier" }));
  expect(setFollowedProjectIds).toHaveBeenCalledWith(["project-a", "project-b", "project-missing"]);

  fireEvent.press(screen.getByRole("button", { name: "Unfollow unavailable project" }));
  expect(setFollowedProjectIds).toHaveBeenCalledWith(["project-b", "project-a"]);
});
