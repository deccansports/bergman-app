import assert from "node:assert/strict";
import test from "node:test";

import { resolveBottomSheetWindowHeight } from "./bottomSheetLayout";

test("keeps the pre-keyboard Android window height while an inline sheet is open", () => {
  assert.equal(resolveBottomSheetWindowHeight(420, 800, true), 800);
});

test("accepts window growth and unlocked layout changes", () => {
  assert.equal(resolveBottomSheetWindowHeight(900, 800, true), 900);
  assert.equal(resolveBottomSheetWindowHeight(420, 800, false), 420);
});
