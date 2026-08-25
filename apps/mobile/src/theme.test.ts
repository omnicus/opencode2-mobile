import { expect, test } from "@jest/globals";

import { usesLargeTextLayout } from "./theme";

test("switches to accessibility layouts at the shared font-scale threshold", () => {
  expect(usesLargeTextLayout(1.29)).toBe(false);
  expect(usesLargeTextLayout(1.3)).toBe(true);
  expect(usesLargeTextLayout(3.143)).toBe(true);
});
