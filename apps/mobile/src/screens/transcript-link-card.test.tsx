import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import {
  describeTranscriptLink,
  parseTranscriptLink,
  TranscriptLinkCard,
} from "./transcript-link-card";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

test.each([
  "file:///private",
  "javascript:alert(1)",
  "opencode://session",
  "https://user:secret@example.test",
  "not a URL",
  `https://example.test/${"x".repeat(4096)}`,
])("does not make unsafe or unbounded URL actionable: %s", (url) => {
  expect(parseTranscriptLink(url)).toBeUndefined();
});

test("recognizes GitHub PRs without implying remote status or fetching metadata", () => {
  expect(describeTranscriptLink(new URL("https://github.com/team/repo/pull/57"))).toEqual({
    title: "team/repo #57",
    kind: "Pull request",
    icon: "git-pull-request",
  });
  expect(
    describeTranscriptLink(new URL("https://github.com.evil.test/team/repo/pull/57")).kind,
  ).toBe("External link");
});

test("opens the exact destination and exposes copy through link options", async () => {
  const href = "https://github.com/team/repo/pull/57?tab=files#discussion";
  const open = jest.fn();
  const view = render(<TranscriptLinkCard href={href} onOpenLink={open} />);
  try {
    const card = screen.getByRole("link", { name: "Pull request: team/repo #57" });
    expect(card).toHaveStyle({ minHeight: 48 });
    fireEvent.press(card);
    expect(open).toHaveBeenCalledWith(href);
    fireEvent(card, "longPress");
    expect(screen.getByRole("button", { name: "Open link" })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(href));
    expect(screen.queryByText(/Merged|Draft|Open pull request/)).toBeNull();
  } finally {
    view.unmount();
  }
});

test("screen readers can open options without a long press", () => {
  const view = render(
    <TranscriptLinkCard href="https://example.test/docs" onOpenLink={jest.fn()} />,
  );
  try {
    fireEvent(
      screen.getByRole("link", { name: "External link: example.test/docs" }),
      "accessibilityAction",
      { nativeEvent: { actionName: "options" } },
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeOnTheScreen();
  } finally {
    view.unmount();
  }
});

test("insecure and loopback links show their scheme and device-local destination", () => {
  const view = render(
    <TranscriptLinkCard href="http://localhost:3000/auth" onOpenLink={jest.fn()} />,
  );
  try {
    expect(
      screen.getByText("External link · http://localhost:3000 · This device"),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Link options for localhost:3000/auth" }));
    expect(screen.getByRole("button", { name: "Copy link" })).toBeOnTheScreen();
  } finally {
    view.unmount();
  }
});
