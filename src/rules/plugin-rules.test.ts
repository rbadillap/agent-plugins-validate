import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "../engine/check.ts";
import { suggestName } from "./plugin-name.ts";
import { canonicalSchema } from "./schema-version.ts";

const NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function checkPlugin(manifest: Record<string, unknown>) {
  const text = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "plugin"),
    ...manifest,
  });
  return check({ root: "", plugin: { path: "plugin.json", text } }).findings;
}

test("a manifest with an unknown field and nothing else has only warnings", () => {
  const findings = checkPlugin({ name: "example-plugin", skills: [] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.rule, "unknown-field");
  assert.equal(findings[0]?.level, "warning");
  assert.ok(findings.every((finding) => finding.level !== "error"));
});

test("the empty name is reported once", () => {
  const findings = checkPlugin({ name: "" });
  assert.deepEqual(
    findings.map((finding) => finding.rule),
    ["required-fields"],
  );
});

test("a name that is too long and also invalid is reported once, by plugin-name", () => {
  const findings = checkPlugin({ name: "A".repeat(80) });
  assert.deepEqual(
    findings.map((finding) => finding.rule),
    ["plugin-name"],
  );
});

test("a name that is only too long is reported by plugin-name with the cut name", () => {
  const [finding] = checkPlugin({ name: "a".repeat(70) });
  assert.equal(finding?.rule, "plugin-name");
  assert.equal(finding?.fix, `use "${"a".repeat(64)}"`);
});

test("suggested names are always valid, or there is no suggestion", () => {
  const samples = [
    "My Plugin",
    "-tools",
    "acme..tools",
    "A--B",
    "x_y_z",
    "ÄÖÜ",
    "a.-.b",
    "...",
    "  spaced  ",
    "UPPER.case-Mixed",
    `${"ab-".repeat(30)}`,
    `${"a".repeat(63)}-b`,
    `${"a".repeat(63)}..b`,
    "🙂plugin🙂",
  ];
  for (const sample of samples) {
    const suggestion = suggestName(sample);
    if (suggestion !== null) {
      assert.match(suggestion, NAME_PATTERN, sample);
      assert.ok(suggestion.length <= 64, sample);
    }
  }
  assert.equal(suggestName("___"), null);
});

test("the spec's valid names pass and its invalid names fail", () => {
  for (const name of ["my-plugin", "acme.tools", "lint3r", "a"]) {
    assert.deepEqual(checkPlugin({ name }), [], name);
  }
  for (const name of [
    "My-Plugin",
    "-start",
    "has--double",
    "too.many..dots",
    "",
  ]) {
    const findings = checkPlugin({ name });
    assert.equal(findings.length, 1, name);
    assert.equal(findings[0]?.level, "error", name);
  }
});

test("a clean manifest with every metadata field has no findings", () => {
  assert.deepEqual(
    checkPlugin({
      name: "example-plugin",
      version: "1.0.0",
      author: { name: "A" },
      keywords: ["a"],
      extensions: { "com.example.client": {} },
    }),
    [],
  );
});
