import type { AttentionCoverage } from "../state/followed-projects-context";

// Screen readers should hear plain words, never the internal freshness states.
export function freshnessDescription(freshness: AttentionCoverage["freshness"]) {
  if (freshness === "current") return "up to date";
  if (freshness === "reconciling") return "checking";
  return "may be out of date";
}

export function attentionAccessibilityValue(
  count: number,
  coverage: Pick<AttentionCoverage, "completeness" | "freshness">,
) {
  const requests = `${count} ${count === 1 ? "request needs" : "requests need"} you`;
  const incomplete = coverage.completeness === "incomplete" ? ", some projects not checked" : "";
  return `${requests}, ${freshnessDescription(coverage.freshness)}${incomplete}`;
}
