import Feather from "@expo/vector-icons/Feather";
import { expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AccessibilityInfo, Platform, ScrollView } from "react-native";

import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { palette, projectAvatarPalette, typography } from "../theme";
import { navigateToSection } from "./app-shell";
import { FollowedProjectsScreen } from "./followed-projects-screen";

jest.mock("../state/workspace-selection-context", () => ({ useWorkspaceSelection: jest.fn() }));
let mockShellNavigate: ((section: string) => void) | undefined;
jest.mock("./app-shell", () => ({
  isTabletShell: () => false,
  navigateToSection: jest.fn(),
  ShellFrame: ({
    children,
    navigate,
  }: {
    children: ReactNode;
    navigate: (section: string) => void;
  }) => {
    mockShellNavigate = navigate;
    return children;
  },
}));

const projects = [
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
  {
    canonical: "/d",
    id: "project-d",
    name: "Delta",
    sandboxes: [],
    time: { created: 1, updated: 1 },
  },
];

function mockSelection(overrides: Record<string, unknown>) {
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    followedProjectIds: [],
    preferencesLoading: false,
    preferencesSaving: false,
    projects,
    projectsError: false,
    projectsLoading: false,
    refetch: jest.fn(),
    setFollowedProjectIds: jest.fn(async () => undefined),
    unavailableProjectIds: [],
    ...overrides,
  } as never);
}

function renderScreen() {
  return render(
    <FollowedProjectsScreen
      navigation={{ navigate: jest.fn() } as never}
      route={{ key: "followed", name: "FollowedProjects" }}
    />,
  );
}

function cardOf(name: string) {
  let node = screen.getByRole("checkbox", { name }).parent;
  while (node && typeof node.type !== "string") node = node.parent;
  return node;
}

function rowOrder() {
  return screen.getAllByRole("checkbox").map((row) => row.props.accessibilityLabel as string);
}

test.each(["projectsError", "empty"])("offers recovery for %s", (state) => {
  const refetch = jest.fn(async () => undefined);
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    followedProjectIds: [],
    preferencesLoading: false,
    projects: [],
    projectsError: state === "projectsError",
    projectsLoading: false,
    refetch,
    unavailableProjectIds: [],
  } as never);
  render(
    <FollowedProjectsScreen
      navigation={{ navigate: jest.fn() } as never}
      route={{ key: "followed", name: "FollowedProjects" }}
    />,
  );
  if (state === "empty") expect(screen.getByText("No server projects found")).toBeOnTheScreen();
  else
    expect(screen.getByRole("alert")).toHaveStyle({
      ...typography.subheadline,
      color: palette.danger,
    });
  fireEvent.press(
    screen.getByRole("button", {
      name: state === "empty" ? "Refresh projects" : "Retry loading projects",
    }),
  );
  expect(refetch).toHaveBeenCalledTimes(1);
});

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

  expect(screen.getByRole("checkbox", { name: "Gamma" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
  fireEvent.press(screen.getByRole("checkbox", { name: "Gamma" }));
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

test("keeps a tapped row in place while the screen is open", () => {
  mockSelection({ followedProjectIds: ["project-b"] });
  const view = renderScreen();
  expect(rowOrder()).toEqual(["Beta", "Alpha", "Gamma", "Delta"]);

  mockSelection({ followedProjectIds: ["project-b", "project-d"] });
  view.rerender(
    <FollowedProjectsScreen
      navigation={{ navigate: jest.fn() } as never}
      route={{ key: "followed", name: "FollowedProjects" }}
    />,
  );
  expect(rowOrder()).toEqual(["Beta", "Alpha", "Gamma", "Delta"]);
  expect(screen.getByRole("checkbox", { name: "Delta" })).toBeChecked();

  mockSelection({ followedProjectIds: ["project-d", "project-b"] });
  view.rerender(
    <FollowedProjectsScreen
      navigation={{ navigate: jest.fn() } as never}
      route={{ key: "followed", name: "FollowedProjects" }}
    />,
  );
  expect(rowOrder()).toEqual(["Delta", "Alpha", "Gamma", "Beta"]);
});

test("each project row shows its avatar beside the title", () => {
  mockSelection({
    projects: [{ ...projects[0], icon: { color: "lime" } }, ...projects.slice(1)],
  });
  renderScreen();
  const avatars = screen.getAllByTestId("project-avatar-letter", { includeHiddenElements: true });
  expect(avatars).toHaveLength(projects.length);
  expect(avatars[0]).toHaveStyle({ backgroundColor: projectAvatarPalette.colors.green.fill });
  expect(avatars[1]).toHaveStyle({ backgroundColor: projectAvatarPalette.colors.gray.fill });
  expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeOnTheScreen();
});

test("marks followed rows with a checked box and a signal border", () => {
  mockSelection({ followedProjectIds: ["project-a"] });
  renderScreen();
  expect(screen.queryByText(/✓|^Following$/)).toBeNull();
  expect(screen.queryByText("Not followed")).toBeNull();
  expect(screen.UNSAFE_getAllByType(Feather).map((icon) => icon.props.name)).toEqual([
    "check-square",
    "square",
    "square",
    "square",
  ]);
  expect(cardOf("Alpha")).toHaveStyle({ borderColor: palette.dim });
  expect(cardOf("Beta")).toHaveStyle({ borderColor: palette.border });
});

test("shows save progress and puts save errors at the top of the list", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
  announce.mockClear();
  mockSelection({ preferencesSaving: true });
  const view = renderScreen();
  expect(screen.getByLabelText("Saving")).toBeOnTheScreen();
  expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeDisabled();

  mockSelection({
    setFollowedProjectIds: jest.fn(async () => {
      throw new Error("write failed");
    }),
  });
  view.rerender(
    <FollowedProjectsScreen
      navigation={{ navigate: jest.fn() } as never}
      route={{ key: "followed", name: "FollowedProjects" }}
    />,
  );
  await act(async () => fireEvent.press(screen.getByRole("checkbox", { name: "Alpha" })));
  expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved/);
  expect(screen.UNSAFE_getByType(ScrollView).props.children[0].props.accessibilityRole).toBe(
    "alert",
  );
  expect(announce).toHaveBeenCalledWith(
    "The followed project selection could not be saved. Try again.",
  );
  jest.restoreAllMocks();
});

test.each(["preferencesLoading", "projectsLoading"])("shows a loading state while %s", (state) => {
  mockSelection({
    preferencesLoading: state === "preferencesLoading",
    projectsError: true,
    projectsLoading: state === "projectsLoading",
  });
  renderScreen();
  expect(screen.getByLabelText("Loading projects")).toBeOnTheScreen();
  expect(screen.getByText("Loading projects")).toBeOnTheScreen();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("bounds reordering at the ends and clears a failed save on the next attempt", async () => {
  const setFollowedProjectIds = jest
    .fn<(projectIDs: string[]) => Promise<void>>()
    .mockRejectedValueOnce(new Error("storage full"))
    .mockResolvedValue(undefined);
  mockSelection({
    followedProjectIds: ["project-a", "project-b"],
    projects: projects.slice(0, 2),
    setFollowedProjectIds,
  });
  renderScreen();

  expect(screen.getByRole("button", { name: "Move Alpha earlier" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Beta later" })).toBeDisabled();

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Move Alpha later" }));
  });
  expect(setFollowedProjectIds).toHaveBeenLastCalledWith(["project-b", "project-a"]);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The followed project selection could not be saved. Try again.",
  );

  await act(async () => {
    fireEvent.press(screen.getByRole("checkbox", { name: "Beta" }));
  });
  expect(setFollowedProjectIds).toHaveBeenLastCalledWith(["project-a"]);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("disables every follow action while a save is in flight", () => {
  mockSelection({
    followedProjectIds: ["project-a", "project-b", "project-missing"],
    preferencesSaving: true,
    projects: projects.slice(0, 2),
    unavailableProjectIds: ["project-missing"],
  });
  renderScreen();
  expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Beta earlier" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Alpha later" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Unfollow unavailable project" })).toBeDisabled();
});

test("hands shell section changes to the shared section navigation", () => {
  mockSelection({ preferencesLoading: true, projects: [] });
  const navigation = { navigate: jest.fn() };
  render(
    <FollowedProjectsScreen
      navigation={navigation as never}
      route={{ key: "followed", name: "FollowedProjects" }}
    />,
  );
  mockShellNavigate?.("Pending");
  expect(navigateToSection).toHaveBeenCalledWith(navigation, "Pending");
});
