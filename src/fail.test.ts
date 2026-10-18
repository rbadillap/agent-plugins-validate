import assert from "node:assert/strict";
import { test } from "node:test";
test("fails on purpose", () => assert.equal(1, 2));
