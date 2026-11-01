import { expect, test } from "@jest/globals";

import { liveEdgeGlideStep, resolveTranscriptLiveFollow } from "./session-transcript-live-follow";

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

function glide(offset: number, velocity = 0, frames = 120) {
  const positions: number[] = [];
  let state = { offset, velocity };
  for (let frame = 0; frame < frames && (frame === 0 || state.offset > 0); frame += 1) {
    state = liveEdgeGlideStep(state.offset, state.velocity, 1000 / 60);
    positions.push(state.offset);
  }
  return { positions, state };
}

test("one line glides like the OpenCode app: eased start, about 160 pt/s, 0.3 s settle", () => {
  const { positions } = glide(22);
  const speeds = positions.map(
    (position, index) => (index === 0 ? 22 : positions[index - 1]!) - position,
  );
  // Settles exactly on the edge without overshooting.
  expect(positions.at(-1)).toBe(0);
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions.length * (1000 / 60)).toBeGreaterThan(220);
  expect(positions.length * (1000 / 60)).toBeLessThan(360);
  // Starts slower than it peaks, then eases out.
  const peak = Math.max(...speeds);
  expect(speeds[0]).toBeLessThan(peak);
  expect(peak * 60).toBeGreaterThan(130);
  expect(peak * 60).toBeLessThan(190);
});

test("a line arriving mid-glide keeps the motion going instead of restarting from rest", () => {
  const { state } = glide(22, 0, 6);
  expect(state.velocity).toBeLessThan(0);
  // The list compensates for the new line by adding its height to the remaining distance.
  const resumed = liveEdgeGlideStep(state.offset + 22, state.velocity, 1000 / 60);
  const fromRest = liveEdgeGlideStep(state.offset + 22, 0, 1000 / 60);
  expect(state.offset + 22 - resumed.offset).toBeGreaterThan(state.offset + 22 - fromRest.offset);
  expect(resumed.velocity).toBeLessThan(0);
});

test("long frame gaps stay stable", () => {
  const step = liveEdgeGlideStep(300, 0, 64);
  expect(step.offset).toBeGreaterThan(0);
  expect(step.offset).toBeLessThan(300);
  expect(liveEdgeGlideStep(0.4, 0, 16)).toEqual({ offset: 0, velocity: 0 });
});
