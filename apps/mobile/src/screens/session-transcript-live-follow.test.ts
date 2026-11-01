import { expect, test } from "@jest/globals";

import { resolveTranscriptLiveFollow } from "./session-transcript-live-follow";

test("pauses as soon as a user scroll starts", () => {
  expect(resolveTranscriptLiveFollow(true, { type: "user-scroll-begin" })).toBe(false);
});

test("stays paused throughout a user scroll session", () => {
  expect(
    resolveTranscriptLiveFollow(false, {
      isAtLiveEdge: true,
      type: "scroll",
      userScrollSessionActive: true,
    }),
  ).toBe(false);
  expect(
    resolveTranscriptLiveFollow(false, {
      isAtLiveEdge: false,
      type: "user-scroll-end",
      userScrollSessionActive: true,
    }),
  ).toBe(false);
});

test("re-arms only after a user settles at the live edge", () => {
  expect(
    resolveTranscriptLiveFollow(false, {
      isAtLiveEdge: true,
      type: "user-scroll-end",
      userScrollSessionActive: true,
    }),
  ).toBe(true);
});

test("does not mistake layout compensation for user scrolling", () => {
  expect(
    resolveTranscriptLiveFollow(true, {
      isAtLiveEdge: false,
      type: "scroll",
      userScrollSessionActive: false,
    }),
  ).toBe(true);
  expect(
    resolveTranscriptLiveFollow(false, {
      isAtLiveEdge: true,
      type: "scroll",
      userScrollSessionActive: false,
    }),
  ).toBe(false);
  expect(
    resolveTranscriptLiveFollow(true, {
      isAtLiveEdge: false,
      type: "user-scroll-end",
      userScrollSessionActive: false,
    }),
  ).toBe(true);
});

test("re-arms after an explicit jump to latest", () => {
  expect(resolveTranscriptLiveFollow(false, { type: "reset" })).toBe(true);
});
