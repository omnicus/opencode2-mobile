import "react-native-gesture-handler/jestSetup";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import { SessionTranscriptRow, TranscriptActivityGroup } from "./session-transcript";
import {
  attachmentImages,
  inlineImageUri,
  maxTranscriptImageLength,
  maxTranscriptImages,
  TranscriptImages,
  toolImages,
} from "./transcript-images";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  getOpenCodeShell: jest.fn(),
  getOpenCodeShellOutput: jest.fn(),
  isShellNotFoundError: jest.fn(() => false),
  maxShellOutputBytes: 64 * 1024,
}));

const png = "data:image/png;base64,iVBORw0KGgo=";

// Press feedback and delayed status labels schedule frames; keep them inside each test.
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  cleanup();
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

type AssistantMessage = Extract<SessionMessageInfo, { type: "assistant" }>;
type AssistantTool = Extract<AssistantMessage["content"][number], { type: "tool" }>;
type FileItem = { uri: string; mime: string; name?: string };

function readTool(id: string, [first, ...rest]: [FileItem, ...FileItem[]]): AssistantTool {
  const file = (item: FileItem) => ({ type: "file" as const, ...item });
  return {
    type: "tool",
    id,
    name: "read",
    time: { created: 1 },
    state: {
      status: "completed",
      input: { filePath: "/workspace/shot.png" },
      content: [file(first), ...rest.map(file)],
    },
  };
}

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return {
    agent: "build",
    content,
    id: "msg_assistant",
    model: { id: "model-1", providerID: "provider" },
    time: { created: 1, completed: 2 },
    type: "assistant",
  };
}

test("only bounded inline raster data URIs render", () => {
  expect(inlineImageUri(png, "image/png")).toBe(png);
  expect(inlineImageUri("data:image/jpeg;base64,/9j/", "image/jpeg")).toBeDefined();
  expect(inlineImageUri(png, "image/jpeg")).toBeUndefined();
  expect(inlineImageUri("data:image/svg+xml;base64,PHN2Zz4=", "image/svg+xml")).toBeUndefined();
  expect(inlineImageUri("https://example.test/shot.png", "image/png")).toBeUndefined();
  expect(inlineImageUri("file:///workspace/shot.png", "image/png")).toBeUndefined();
  expect(inlineImageUri("media:abc", "image/png")).toBeUndefined();
  expect(
    inlineImageUri(`${png}${"A".repeat(maxTranscriptImageLength)}`, "image/png"),
  ).toBeUndefined();
});

test("tool and attachment images are collected with stable keys and a cap", () => {
  const [first, ...rest] = Array.from({ length: maxTranscriptImages + 2 }, (_, index) => ({
    uri: png,
    mime: "image/png",
    name: `/workspace/shot-${index}.png`,
  }));
  if (!first) throw new Error("fixture");
  const tool = readTool("tool_read", [first, ...rest]);
  const images = toolImages([tool]);
  expect(images).toHaveLength(maxTranscriptImages);
  expect(images[0]).toEqual({ key: "tool_read:0", label: "shot-0.png", uri: png });
  expect(
    attachmentImages([
      { data: "iVBORw0KGgo=", mime: "image/png", name: "photo.png", source: { type: "inline" } },
      { data: "c2VjcmV0", mime: "text/plain", name: "note.txt", source: { type: "inline" } },
    ]),
  ).toEqual([{ key: "attachment:0", label: "photo.png", uri: png }]);
});

test("tapping an image opens a full-screen viewer that closes", () => {
  render(<TranscriptImages images={[{ key: "one", label: "shot.png", uri: png }]} />);
  expect(screen.queryByRole("button", { name: "Close image" })).toBeNull();
  fireEvent.press(screen.getByRole("imagebutton", { name: "shot.png" }));
  fireEvent.press(screen.getByRole("button", { name: "Close image" }));
  expect(screen.queryByRole("button", { name: "Close image" })).toBeNull();
});

test("the viewer zooms with a scroll view on iOS and a pinch gesture on Android", () => {
  const images = [{ key: "one", label: "shot.png", uri: png }];
  const view = render(<TranscriptImages images={images} />);
  fireEvent.press(screen.getByRole("imagebutton", { name: "shot.png" }));
  expect(screen.UNSAFE_queryAllByProps({ maximumZoomScale: 4 })).not.toHaveLength(0);
  view.unmount();

  jest.replaceProperty(Platform, "OS", "android");
  render(<TranscriptImages images={images} />);
  fireEvent.press(screen.getByRole("imagebutton", { name: "shot.png" }));
  expect(screen.UNSAFE_queryAllByProps({ maximumZoomScale: 4 })).toHaveLength(0);
  expect(screen.getAllByLabelText("shot.png")).toHaveLength(2);
  fireEvent.press(screen.getByRole("button", { name: "Close image" }));
  expect(screen.queryByRole("button", { name: "Close image" })).toBeNull();
});

test("collapsed tool activity keeps image results visible", () => {
  render(
    <TranscriptActivityGroup
      item={{
        type: "activity-group",
        id: "activity:msg_assistant",
        count: 1,
        running: false,
        messages: [
          assistant([readTool("tool_read", [{ uri: png, mime: "image/png", name: "shot.png" }])]),
        ],
      }}
      largeText={false}
      showReasoning
      onOpenDiff={jest.fn()}
      onOpenSubagent={jest.fn()}
    />,
  );
  expect(screen.getByRole("imagebutton", { name: "shot.png" })).toBeOnTheScreen();
});

test("tool images render once when nested rows are expanded", () => {
  render(
    <SessionTranscriptRow
      message={assistant([
        readTool("tool_one", [{ uri: png, mime: "image/png", name: "one.png" }]),
        readTool("tool_two", [{ uri: png, mime: "image/png", name: "two.png" }]),
      ])}
    />,
  );
  expect(screen.getAllByRole("imagebutton")).toHaveLength(2);
  fireEvent.press(screen.getByRole("button", { name: /Explored/ }));
  expect(screen.getAllByRole("imagebutton")).toHaveLength(2);
});

test("user image attachments render as images instead of file chips", () => {
  render(
    <SessionTranscriptRow
      message={{
        files: [
          {
            data: "iVBORw0KGgo=",
            mime: "image/png",
            name: "photo.png",
            source: { type: "inline" },
          },
          { data: "c2VjcmV0", mime: "text/plain", name: "note.txt", source: { type: "inline" } },
        ],
        id: "msg_user",
        text: "Look at this",
        time: { created: 1 },
        type: "user",
      }}
    />,
  );
  expect(screen.getByRole("imagebutton", { name: "photo.png" })).toBeOnTheScreen();
  expect(screen.queryByText("photo.png")).toBeNull();
  expect(screen.getByText("note.txt")).toBeOnTheScreen();
  expect(screen.getByLabelText("1 attachments")).toBeOnTheScreen();
});
