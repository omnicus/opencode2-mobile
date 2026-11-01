import { expect, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { projectAvatarPalette } from "../theme";
import {
  maxProjectAvatarImageLength,
  ProjectAvatar,
  projectAvatarColor,
  projectAvatarImageUri,
  projectAvatarLetter,
} from "./project-avatar";

const png = "data:image/png;base64,iVBORw0KGgo=";

test("maps desktop color keys and aliases, and falls back to gray", () => {
  for (const key of Object.keys(projectAvatarPalette.colors)) {
    expect(projectAvatarColor(key)).toBe(key);
  }
  expect(projectAvatarColor("mint")).toBe("cyan");
  expect(projectAvatarColor("lime")).toBe("green");
  expect(projectAvatarColor(undefined)).toBe("gray");
  expect(projectAvatarColor("")).toBe("gray");
  expect(projectAvatarColor("teal")).toBe("gray");
  expect(projectAvatarColor("constructor")).toBe("gray");
});

test("uses an override before the url, and no image once a color is chosen", () => {
  expect(projectAvatarImageUri({ override: png, url: "data:image/gif;base64,R0lG" })).toBe(png);
  expect(projectAvatarImageUri({ url: png })).toBe(png);
  expect(projectAvatarImageUri({ color: "blue", override: png, url: png })).toBeUndefined();
  expect(projectAvatarImageUri(undefined)).toBeUndefined();
});

test("renders only bounded inline png, jpeg, gif, and webp images", () => {
  for (const type of ["png", "jpeg", "gif", "webp", "PNG"]) {
    expect(projectAvatarImageUri({ url: `data:image/${type};base64,AAAA` })).toBeDefined();
  }
  expect(projectAvatarImageUri({ url: "https://example.com/icon.png" })).toBeUndefined();
  expect(projectAvatarImageUri({ url: "http://example.com/icon.png" })).toBeUndefined();
  expect(projectAvatarImageUri({ url: "data:image/svg+xml;base64,PHN2Zz4=" })).toBeUndefined();
  expect(projectAvatarImageUri({ url: "data:image/png,raw" })).toBeUndefined();
  const oversized = `data:image/png;base64,${"A".repeat(maxProjectAvatarImageLength)}`;
  expect(projectAvatarImageUri({ url: oversized })).toBeUndefined();
});

test("uses the first grapheme of the name, uppercased", () => {
  expect(projectAvatarLetter("opencode")).toBe("O");
  expect(projectAvatarLetter("  émile")).toBe("É");
  expect(projectAvatarLetter("🚀 launch")).toBe("🚀");
  expect(projectAvatarLetter("")).toBe("");
});

test("draws a colored letter, hidden from screen readers", () => {
  render(<ProjectAvatar icon={{ color: "mint" }} name="mobile" />);
  const avatar = screen.getByTestId("project-avatar", { includeHiddenElements: true });
  expect(avatar).toHaveProp("accessible", false);
  expect(screen.getByTestId("project-avatar-letter", { includeHiddenElements: true })).toHaveStyle({
    backgroundColor: projectAvatarPalette.colors.cyan.fill,
    borderColor: projectAvatarPalette.colors.cyan.border,
    borderRadius: 5,
    height: 20,
    width: 20,
  });
  expect(screen.getByText("M", { includeHiddenElements: true })).toHaveStyle({
    color: projectAvatarPalette.foreground,
  });
  expect(screen.queryByTestId("project-avatar-image", { includeHiddenElements: true })).toBeNull();
});

test("shows an inline image and falls back to the letter if it fails to decode", () => {
  render(<ProjectAvatar icon={{ override: png }} name="mobile" />);
  const image = screen.getByTestId("project-avatar-image", { includeHiddenElements: true });
  expect(image.props.source).toEqual({ uri: png });
  fireEvent(image, "error");
  expect(screen.getByText("M", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId("project-avatar-letter", { includeHiddenElements: true })).toHaveStyle({
    backgroundColor: projectAvatarPalette.colors.gray.fill,
  });
});

test("never renders a network image", () => {
  render(<ProjectAvatar icon={{ url: "https://example.com/icon.png" }} name="web" />);
  expect(screen.queryByTestId("project-avatar-image", { includeHiddenElements: true })).toBeNull();
  expect(screen.getByText("W", { includeHiddenElements: true })).toBeTruthy();
});
