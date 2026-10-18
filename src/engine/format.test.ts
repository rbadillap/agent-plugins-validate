import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldPath, formatCurrent, truncate } from "./format.ts";

test("fieldPath joins keys with dots", () => {
  assert.equal(
    fieldPath(["mcpServers", "docs", "type"]),
    "mcpServers.docs.type",
  );
});

test("fieldPath writes array items as [n]", () => {
  assert.equal(fieldPath(["keywords", 0]), "keywords[0]");
  assert.equal(fieldPath(["a", 1, "b"]), "a[1].b");
});

test("fieldPath brackets keys that aren't plain identifiers", () => {
  assert.equal(
    fieldPath(["extensions", "com.example.client"]),
    'extensions["com.example.client"]',
  );
  assert.equal(
    fieldPath(["mcpServers", "my server", "type"]),
    'mcpServers["my server"].type',
  );
  assert.equal(fieldPath(["mcpServers", "", "type"]), 'mcpServers[""].type');
});

test("fieldPath keeps $schema and hyphenated keys plain", () => {
  assert.equal(fieldPath(["$schema"]), "$schema");
  assert.equal(
    fieldPath(["mcpServers", "local-validator"]),
    "mcpServers.local-validator",
  );
});

test("fieldPath names the whole document (root)", () => {
  assert.equal(fieldPath([]), "(root)");
});

test("formatCurrent writes JSON", () => {
  assert.equal(formatCurrent("http"), '"http"');
  assert.equal(formatCurrent(3000), "3000");
  assert.equal(formatCurrent(["a"]), '["a"]');
  assert.equal(formatCurrent(null), "null");
});

test("formatCurrent writes (missing) for a missing value", () => {
  assert.equal(formatCurrent(undefined), "(missing)");
});

test("formatCurrent cuts values over 80 characters", () => {
  const long = formatCurrent("x".repeat(200));
  assert.equal(long.length, 81);
  assert.ok(long.endsWith("…"));
  const exact = `"${"x".repeat(78)}"`;
  assert.equal(exact.length, 80);
  assert.equal(formatCurrent("x".repeat(78)), exact);
});

test("truncate doesn't split a surrogate pair", () => {
  const text = `${"x".repeat(79)}😀tail`;
  const cut = truncate(text);
  assert.equal(cut, `${"x".repeat(79)}…`);
  assert.doesNotMatch(cut, /[\ud800-\udbff](?![\udc00-\udfff])/);
});

test("truncate leaves short text alone", () => {
  assert.equal(truncate("short"), "short");
});
