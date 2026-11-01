import { expect, test } from "@jest/globals";

import {
  liveEdgeGlideMs,
  liveEdgeGlideOffset,
  resolveTranscriptLiveFollow,
} from "./session-transcript-live-follow";

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

test("the live-edge glide eases to the edge and settles exactly on it", () => {
  let offset = 25;
  const steps: number[] = [];
  for (let frame = 0; frame < 60 && offset > 0; frame += 1) {
    const next = liveEdgeGlideOffset(offset, 16);
    steps.push(offset - next);
    offset = next;
  }
  expect(offset).toBe(0);
  // Each frame moves less than the one before: no restart, no overshoot.
  for (let index = 1; index < steps.length - 1; index += 1) {
    expect(steps[index]).toBeLessThan(steps[index - 1] as number);
  }
  expect(liveEdgeGlideOffset(25, liveEdgeGlideMs)).toBeCloseTo(25 / Math.E);
  expect(liveEdgeGlideOffset(0.4, 16)).toBe(0);
  expect(liveEdgeGlideOffset(10, -5)).toBe(10);
});

test("a line arriving mid-glide speeds the glide up instead of restarting it", () => {
  const before = 12;
  const stepBefore = before - liveEdgeGlideOffset(before, 16);
  // Native position compensation adds the new line's height to the remaining distance.
  const after = before + 25;
  const stepAfter = after - liveEdgeGlideOffset(after, 16);
  expect(stepAfter).toBeGreaterThan(stepBefore);
});
