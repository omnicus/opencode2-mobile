import { attentionAccessibilityValue, freshnessDescription } from "./attention-labels";

test("maps freshness states to plain words", () => {
  expect(freshnessDescription("current")).toBe("up to date");
  expect(freshnessDescription("reconciling")).toBe("checking");
  expect(freshnessDescription("stale")).toBe("may be out of date");
});

test("describes the request count and incomplete coverage", () => {
  expect(attentionAccessibilityValue(1, { completeness: "complete", freshness: "current" })).toBe(
    "1 request needs you, up to date",
  );
  expect(attentionAccessibilityValue(3, { completeness: "incomplete", freshness: "stale" })).toBe(
    "3 requests need you, may be out of date, some projects not checked",
  );
});
