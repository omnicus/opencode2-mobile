import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { palette } from "../theme";
import { SessionAttentionMarker, WorkspaceHeaderActions } from "./workspace-header-actions";

jest.mock("@expo/vector-icons/Feather", () => () => null);
jest.mock("../state/workspace-selection-context", () => ({ useWorkspaceSelection: jest.fn() }));

test("the gear opens Settings directly and carries the attention state", () => {
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "incomplete", freshness: "reconciling" },
    pendingCount: 3,
  } as never);
  const navigate = jest.fn();
  render(<WorkspaceHeaderActions navigate={navigate} />);
  expect(screen.queryByText("3+")).toBeNull();
  expect(
    screen.getByTestId("workspace-attention-indicator", { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  const settings = screen.getByRole("button", { name: "Settings" });
  expect(settings.props.accessibilityValue.text).toBe(
    "3 requests need you, checking, some projects not checked",
  );

  fireEvent.press(settings);
  expect(navigate).toHaveBeenCalledWith("Settings");
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Workspace options")).toBeNull();
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
  expect(screen.getByRole("button", { name: "Settings" }).props.accessibilityValue.text).toBe(
    "0 requests need you, up to date",
  );
});

test("shows an uncertain indicator while checking with no known requests", () => {
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "incomplete", freshness: "reconciling" },
    pendingCount: 0,
  } as never);
  render(<WorkspaceHeaderActions navigate={jest.fn()} />);
  expect(
    screen.getByTestId("workspace-attention-indicator", { includeHiddenElements: true }),
  ).toHaveStyle({ backgroundColor: palette.dim });
});

test("session attention is a small circle rather than an approval-list action", () => {
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete", freshness: "current" },
    pendingCount: 1,
  } as never);
  const view = render(<SessionAttentionMarker />);
  expect(
    screen.getByTestId("session-attention-marker", { includeHiddenElements: true }),
  ).toHaveStyle({ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.warm, right: 8 });
  expect(screen.queryByRole("button", { name: "Needs you" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  jest.mocked(useWorkspaceSelection).mockReturnValue({
    attentionCoverage: { completeness: "complete", freshness: "current" },
    pendingCount: 0,
  } as never);
  view.rerender(<SessionAttentionMarker />);
  expect(
    screen.queryByTestId("session-attention-marker", { includeHiddenElements: true }),
  ).toBeNull();
});
