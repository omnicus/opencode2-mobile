import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { TranscriptMarkdown } from "./transcript-markdown";

const body = { fontSize: 17, lineHeight: 26 };

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

test("copies only the selected code block, preserving indentation and newlines", async () => {
  render(
    <TranscriptMarkdown
      style={body}
      onOpenLink={jest.fn()}
      text={"Intro\n\n```ts\n  first();\n\n  second();\n```\n\n```sh\necho other\n```"}
    />,
  );
  const copy = screen.getAllByRole("button", { name: "Copy code" })[0];
  if (!copy) throw new Error("Missing code copy action");
  fireEvent.press(copy);
  await waitFor(() =>
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith("  first();\n\n  second();\n"),
  );
  expect(screen.getByText("  first();\n\n  second();", { exact: true })).toHaveProp(
    "selectable",
    true,
  );
});

test("keeps emphasis local to its nested content and paragraph", () => {
  render(
    <TranscriptMarkdown
      style={body}
      onOpenLink={jest.fn()}
      text={
        "Use **`IMAGE_TAG`** to select this image.\n\nNormal paragraph with *emphasis* and ~~old~~ text."
      }
    />,
  );
  expect(screen.getByText("IMAGE_TAG")).toHaveStyle({ fontWeight: "700" });
  expect(screen.getByText(" to select this image.")).not.toHaveStyle({ fontWeight: "700" });
  expect(screen.getByText("Normal paragraph with ")).not.toHaveStyle({ fontWeight: "700" });
  expect(screen.getByText("emphasis")).toHaveStyle({ fontStyle: "italic" });
  expect(screen.getByText("old")).toHaveStyle({ textDecorationLine: "line-through" });
});

test("renders headings, nested lists, blockquotes, entities and escaped markers", () => {
  render(
    <TranscriptMarkdown
      style={body}
      onOpenLink={jest.fn()}
      text={
        "## Summary\n\n3. First\n   - Nested\n4. Second\n\n> Quoted &amp; safe\n\n\\*literal\\*"
      }
    />,
  );
  expect(screen.getByRole("header", { name: "Summary" })).toBeOnTheScreen();
  expect(screen.getByText("3.")).toBeOnTheScreen();
  expect(screen.getByText("4.")).toBeOnTheScreen();
  expect(screen.getByText("Nested")).toBeOnTheScreen();
  expect(screen.getByText("Quoted & safe")).toBeOnTheScreen();
  expect(screen.getByText("*literal*")).toBeOnTheScreen();
});

test("renders escaped table pipes, code, alignment and streamed rows", () => {
  const header = "| Change | Needed |\n|:---|---:|\n";
  const props = { style: body, onOpenLink: jest.fn() };
  const view = render(<TranscriptMarkdown {...props} text={`${header}| A \\| B | **No** |`} />);
  expect(screen.getByText("A | B")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Needed" })).toHaveStyle({ textAlign: "right" });
  expect(screen.getByText("No")).toHaveStyle({ fontWeight: "700" });
  view.rerender(
    <TranscriptMarkdown
      {...props}
      text={`${header}| A \\| B | **No** |\n| Runtime | \`ARGS\` |`}
    />,
  );
  expect(screen.getByText("ARGS")).toBeOnTheScreen();
  expect(screen.queryByText(/:---/)).toBeNull();
});

test("wide tables scroll without squeezing columns or truncating text", () => {
  render(
    <TranscriptMarkdown
      style={body}
      onOpenLink={jest.fn()}
      text={"| A | B | C | D |\n|---|---|---|---|\n| One | Two | Three | Long final cell |"}
    />,
  );
  expect(screen.getByLabelText("Markdown table")).toHaveProp("horizontal", true);
  expect(screen.getByText("Long final cell")).toBeOnTheScreen();
});

test("only HTTP links are actionable and remote images remain text", () => {
  const open = jest.fn();
  render(
    <TranscriptMarkdown
      style={body}
      onOpenLink={open}
      text={
        "[**Docs**](https://example.test/docs) [Local](file:///private/file) [Script](javascript:alert(1)) ![Remote image](https://example.test/image.png) <script>literal</script> `https://code.test`"
      }
    />,
  );
  fireEvent.press(screen.getByRole("link", { name: "Docs" }));
  expect(open).toHaveBeenCalledWith("https://example.test/docs");
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByText("Remote image")).toBeOnTheScreen();
  expect(screen.queryByRole("image")).toBeNull();
});
