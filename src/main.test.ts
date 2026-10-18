import assert from "node:assert/strict";
import { test } from "node:test";

test("the test runner runs TypeScript sources", () => {
  assert.equal(1 + 1, 2);
});
