import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "../engine/check.ts";
import { canonicalSchema } from "./schema-version.ts";

const _NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

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
});

test("a name's fix is an instruction with a generic example, never the name", () => {
  for (const name of [
    "My Plugin",
    "-start",
    "acme..tools",
    "___",
    "x".repeat(70),
  ]) {
    const [finding] = checkPlugin({ name });
    assert.match(finding?.fix ?? "", /kebab-case.*e\.g\. "my-plugin"/, name);
    assert.ok(!(finding?.fix ?? "").includes(name), name);
    // A name that is plain is shown, as a name; any other text is described.
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
      assert.ok(!(finding?.current ?? "").includes(name), name);
    }
  }
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

test("a version that isn't Semantic Versioning is only a notice", () => {
  const findings = checkPlugin({ name: "example-plugin", version: "v1.2" });
  assert.deepEqual(
    findings.map((finding) => [finding.rule, finding.level, finding.fix]),
    [
      [
        "version-semver",
        "notice",
        'use a Semantic Versioning version, MAJOR.MINOR.PATCH, e.g. "1.0.0"',
      ],
    ],
  );
  assert.ok(findings.every((finding) => finding.level === "notice"));
});

test("a version that isn't a string is a field-type error, not a notice", () => {
  const findings = checkPlugin({ name: "example-plugin", version: 1.2 });
  assert.deepEqual(
    findings.map((finding) => finding.rule),
    ["field-type"],
  );
});

test("versions from the SemVer 2.0.0 grammar pass", () => {
  for (const version of [
    "0.0.0",
    "1.2.0",
    "1.0.0-alpha",
    "1.0.0-0.3.7",
    "1.0.0+20130313144700",
    "1.0.0-beta.1+build.5",
  ]) {
    assert.deepEqual(
      checkPlugin({ name: "example-plugin", version }),
      [],
      version,
    );
  }
});

test("a version's fix is an instruction with a generic example, never the version", () => {
  for (const version of ["v1.2", "1.0", "2", "2024-10-01", "01.2.3"]) {
    const [finding] = checkPlugin({ name: "example-plugin", version });
    assert.equal(finding?.rule, "version-semver", version);
    assert.equal(
      finding?.fix,
      'use a Semantic Versioning version, MAJOR.MINOR.PATCH, e.g. "1.0.0"',
    );
    assert.equal(finding?.current, `string (${version.length} chars)`);
  }
});
