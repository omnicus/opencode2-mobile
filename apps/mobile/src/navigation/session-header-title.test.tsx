import { expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { palette } from "../theme";
import { headerSessionTitle, SessionHeaderTitle } from "./session-header-title";

test("names the project under the session title", () => {
  const view = render(<SessionHeaderTitle subtitle="orbit-api" title="Fix token refresh" />);
  expect(screen.getByRole("header", { name: "Fix token refresh" })).toBeOnTheScreen();
  expect(screen.getByText("orbit-api")).toHaveStyle({ color: palette.dim });
  view.rerender(<SessionHeaderTitle title="Fix token refresh" />);
  expect(screen.queryByText("orbit-api")).toBeNull();
});

test("drops the subagent suffix the subtitle already states", () => {
  expect(headerSessionTitle("Review composer (@review subagent)")).toBe("Review composer");
  expect(headerSessionTitle("Fix token refresh")).toBe("Fix token refresh");
  expect(headerSessionTitle("  ")).toBe("Untitled session");
  expect(headerSessionTitle(undefined)).toBe("Untitled session");
});
