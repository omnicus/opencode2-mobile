import { afterEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { createElement as mockCreateElement } from "react";
import { View as MockView, Platform, Text } from "react-native";
import { TranscriptMarkdown } from "../screens/transcript-markdown";
import { SelectableTranscriptText, selectionRuns } from "./selectable-transcript-text";

jest.mock("expo", () => ({
  requireOptionalNativeModule: () => ({}),
  requireNativeView: () => (props: object) =>
    mockCreateElement(MockView, { ...props, testID: "native-selection" }),
}));

afterEach(() => {
  jest.restoreAllMocks();
});

test("builds attributed runs with nested formatting, dynamic type and safe link callbacks", () => {
  const open = jest.fn();
  const { runs, actions } = selectionRuns(
    <>
      Normal{" "}
      <Text style={{ fontWeight: "700" }}>
        bold <Text style={{ fontStyle: "italic" }}>nested</Text>
      </Text>
      <Text onPress={open}>link</Text>
    </>,
    { color: "#ffffff", fontSize: 18, lineHeight: 27 },
    1.5,
  );
  expect(runs.map((run) => run.text).join("")).toBe("Normal bold nestedlink");
  expect(runs[0]).toMatchObject({ fontSize: 27, lineHeight: 40.5, bold: false, link: false });
  expect(runs.find((run) => run.text === "nested")).toMatchObject({ bold: true, italic: true });
  expect(runs.find((run) => run.text === "link")).toMatchObject({ link: true });
  actions[runs.findIndex((run) => run.link)]?.();
  expect(open).toHaveBeenCalledTimes(1);
});

test("the Markdown call site supplies actual inline content to the iOS view", () => {
  const open = jest.fn();
  render(
    <TranscriptMarkdown
      style={{ fontSize: 17 }}
      onOpenLink={open}
      text="Hello **bold** and [Docs](https://example.test/docs)."
    />,
  );
  const view = screen.getByTestId("native-selection");
  const runs = view.props.runs as ReturnType<typeof selectionRuns>["runs"];
  expect(runs.map((run) => run.text).join("")).toBe("Hello bold and Docs.");
  expect(runs.find((run) => run.text === "bold")?.bold).toBe(true);
  fireEvent(view, "link", { nativeEvent: { index: runs.findIndex((run) => run.link) } });
  expect(open).toHaveBeenCalledWith("https://example.test/docs");
  fireEvent(view, "measure", { nativeEvent: { width: 320, height: 78 } });
  expect(view).toHaveStyle({ height: 78 });
});

test("Android retains its native selectable Text renderer", () => {
  jest.replaceProperty(Platform, "OS", "android");
  render(<SelectableTranscriptText>Mark part of this text</SelectableTranscriptText>);
  expect(screen.queryByTestId("native-selection")).toBeNull();
  expect(screen.getByText("Mark part of this text")).toHaveProp("selectable", true);
});
