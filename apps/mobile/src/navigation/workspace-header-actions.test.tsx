import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { palette } from "../theme";
import { SessionAttentionMarker, WorkspaceHeaderActions } from "./workspace-header-actions";

jest.mock("@expo/vector-icons/Feather", () => () => null);
jest.mock("../state/workspace-selection-context", () => ({ useWorkspaceSelection: jest.fn() }));

test("keeps attention and workspace options available in the native header", () => {
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "incomplete", freshness: "reconciling" },
    pendingCount: 3,
  } as never);
  const navigate = jest.fn();
  render(<WorkspaceHeaderActions navigate={navigate} />);
  expect(screen.queryByText("3+")).toBeNull();
  expect(screen.queryByText("More")).toBeNull();
  expect(
    screen.getByTestId("workspace-attention-indicator", { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Workspace options" }).props.accessibilityValue.text,
  ).toContain("3 known requests");

  fireEvent.press(screen.getByRole("button", { name: "Workspace options" }));
  fireEvent.press(screen.getByRole("button", { name: "Needs you, 3" }));
  expect(navigate).toHaveBeenCalledWith("Pending");

  fireEvent.press(screen.getByRole("button", { name: "Workspace options" }));
  fireEvent.press(screen.getByRole("button", { name: "Followed projects" }));
  expect(navigate).toHaveBeenCalledWith("FollowedProjects");
});

test("current complete coverage without requests has no attention indicator", () => {
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete", freshness: "current" },
    pendingCount: 0,
  } as never);
  render(<WorkspaceHeaderActions navigate={jest.fn()} />);
  expect(
    screen.queryByTestId("workspace-attention-indicator", { includeHiddenElements: true }),
  ).toBeNull();
});

test("moves Needs you into the menu when there are no known requests", () => {
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "incomplete", freshness: "reconciling" },
    pendingCount: 0,
  } as never);
  const navigate = jest.fn();
  render(<WorkspaceHeaderActions navigate={navigate} />);

  expect(screen.queryByText("0+")).toBeNull();
  expect(
    screen.getByTestId("workspace-attention-indicator", { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", {
      name: "0 known requests. Attention coverage incomplete, reconciling.",
    }),
  ).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Workspace options" }));
  fireEvent.press(screen.getByRole("button", { name: "Needs you, syncing" }));
  expect(navigate).toHaveBeenCalledWith("Pending");
});

test("session attention is a small circle rather than an approval-list action", () => {
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete", freshness: "current" },
    pendingCount: 1,
  } as never);
  const view = render(<SessionAttentionMarker />);
  expect(
    screen.getByTestId("session-attention-marker", { includeHiddenElements: true }),
  ).toHaveStyle({ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.warm, left: 6 });
  expect(screen.queryByRole("button", { name: "Needs you" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Workspace options" })).toBeNull();
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete", freshness: "current" },
    pendingCount: 0,
  } as never);
  view.rerender(<SessionAttentionMarker />);
  expect(
    screen.queryByTestId("session-attention-marker", { includeHiddenElements: true }),
  ).toBeNull();
});
