import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { WorkspaceHeaderActions } from "./workspace-header-actions";

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

  fireEvent.press(screen.getByRole("button", { name: "Workspace options" }));
  fireEvent.press(screen.getByRole("button", { name: "Needs you, 3" }));
  expect(navigate).toHaveBeenCalledWith("Pending");

  fireEvent.press(screen.getByRole("button", { name: "Workspace options" }));
  fireEvent.press(screen.getByRole("button", { name: "Followed projects" }));
  expect(navigate).toHaveBeenCalledWith("FollowedProjects");
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
    screen.queryByRole("button", {
      name: "0 known requests. Attention coverage incomplete, reconciling.",
    }),
  ).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Workspace options" }));
  fireEvent.press(screen.getByRole("button", { name: "Needs you, syncing" }));
  expect(navigate).toHaveBeenCalledWith("Pending");
});
