import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { rules } from "./index.ts";

const text = readFileSync(
  new URL("../../docs/rules.md", import.meta.url),
  "utf8",
);

// A row of the tables: | `id` | level | ... |
const documented = new Map<string, string>();
for (const match of text.matchAll(/^\| `([a-z-]+)` \| (\w+) \|/gm)) {
  const [, id, level] = match;
  if (id !== undefined && level !== undefined) documented.set(id, level);
}

test("docs/rules.md lists every rule with its level", () => {
  for (const rule of rules) {
    assert.equal(documented.get(rule.id), rule.level, rule.id);
  }
});

test("docs/rules.md lists no rule that doesn't exist", () => {
  const known = new Set(rules.map((rule) => rule.id));
  for (const id of documented.keys()) {
    assert.ok(known.has(id), `${id} is documented but is not a rule`);
  }
});
