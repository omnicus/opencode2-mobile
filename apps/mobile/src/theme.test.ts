import { expect, test } from "@jest/globals";

import { typeRamp, typography, usesLargeTextLayout } from "./theme";

test("switches to accessibility layouts at the shared font-scale threshold", () => {
  expect(usesLargeTextLayout(1.29)).toBe(false);
  expect(usesLargeTextLayout(1.3)).toBe(true);
  expect(usesLargeTextLayout(3.143)).toBe(true);
});

test("primary rows read at 17pt with smaller supporting text", () => {
  expect(typography.body).toEqual({ fontSize: 17, lineHeight: 22 });
  expect(typography.chatBody).toEqual({ fontSize: 17, lineHeight: 25 });
  expect(typography.chatActivity.fontSize).toBe(typography.body.fontSize);
  expect(typography.navTitle.fontSize).toBe(17);
  expect(typography.headline).toEqual({ fontSize: 17, lineHeight: 22, fontWeight: "600" });
  expect(typography.subheadline).toEqual({ fontSize: 15, lineHeight: 20 });
  expect(typography.footnote.fontSize).toBe(13);
  expect(typography.caption.fontSize).toBe(12);
});

test("every text role except chat and code has a dynamic type ramp", () => {
  const roles = Object.keys(typography).filter(
    (role) => !["chatBody", "chatActivity", "code"].includes(role),
  );
  expect(Object.keys(typeRamp).sort()).toEqual(roles.sort());
});
