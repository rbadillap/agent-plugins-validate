import assert from "node:assert/strict";
import { test } from "node:test";
import { describeValue, fieldPath, isPlainName, truncate } from "./format.ts";

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

test("fieldPath writes keys that are not plain as […]", () => {
  assert.equal(
    fieldPath(["mcpServers", "my server", "type"]),
    "mcpServers[…].type",
  );
  assert.equal(fieldPath(["mcpServers", "", "type"]), "mcpServers[…].type");
  assert.equal(
    fieldPath(["mcpServers", "outlook", "env", "A=b"]),
    "mcpServers.outlook.env[…]",
  );
  assert.equal(fieldPath(["mcpServers", "x".repeat(65)]), "mcpServers[…]");
  assert.equal(fieldPath(["a", "https://u:p@h"]), "a[…]");
});

test("fieldPath keeps plain keys, dots included, so namespaces read well", () => {
  assert.equal(
    fieldPath(["extensions", "com.example.client"]),
    "extensions.com.example.client",
  );
  assert.equal(
    fieldPath(["mcpServers", "x".repeat(64)]),
    `mcpServers.${"x".repeat(64)}`,
  );
});

test("isPlainName accepts short names and nothing that can hold more", () => {
  for (const name of ["poracode", "My-Plugin", "a.b_c", "x".repeat(64)]) {
    assert.ok(isPlainName(name), name);
  }
  for (const name of [
    "",
    "a b",
    "a:b",
    "a=b",
    "a@b",
    "a/b",
    "x".repeat(65),
    3,
    null,
  ]) {
    assert.ok(!isPlainName(name), String(name));
  }
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

test("describeValue describes free text and never repeats it", () => {
  assert.equal(describeValue("http"), "string (4 chars)");
  assert.equal(describeValue(""), "string (0 chars)");
  assert.equal(describeValue(["a", "b"]), "array (2 items)");
  assert.equal(describeValue({ a: 1 }), "object (1 keys)");
  const text = describeValue({ token: "s3cr3t", list: ["s3cr3t"] });
  assert.doesNotMatch(text, /s3cr3t|token/);
});

test("describeValue writes values that can't hold free text as they are", () => {
  assert.equal(describeValue(3000), "3000");
  assert.equal(describeValue(1.2), "1.2");
  assert.equal(describeValue(true), "true");
  assert.equal(describeValue(null), "null");
});

test("describeValue writes (missing) for a missing value", () => {
  assert.equal(describeValue(undefined), "(missing)");
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

test("truncate cuts text over 80 characters", () => {
  const long = truncate("x".repeat(200));
  assert.equal(long.length, 81);
  assert.ok(long.endsWith("…"));
  assert.equal(truncate("x".repeat(80)), "x".repeat(80));
});
