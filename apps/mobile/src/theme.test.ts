import { expect, test } from "@jest/globals";

import { typography, usesLargeTextLayout } from "./theme";

test("switches to accessibility layouts at the shared font-scale threshold", () => {
  expect(usesLargeTextLayout(1.29)).toBe(false);
  expect(usesLargeTextLayout(1.3)).toBe(true);
  expect(usesLargeTextLayout(3.143)).toBe(true);
});

test("chat text is larger without changing general UI typography", () => {
  expect(typography.chatBody).toEqual({ fontSize: 16, lineHeight: 24 });
  expect(typography.body).toEqual({ fontSize: 15, lineHeight: 22 });
  expect(typography.caption.fontSize).toBe(12);
});
