import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { check } from "../engine/check.ts";
import { canonicalSchema } from "./schema-version.ts";
import { LICENSE_IDS, parseExpression, SPDX_LIST_VERSION } from "./spdx.ts";

function checkLicense(license: unknown) {
  const text = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "plugin"),
    name: "example-plugin",
    license,
  });
  return check({ root: "", plugin: { path: "plugin.json", text } }).findings;
}

test("the examples in the issue get the fix in its table, as a notice", () => {
  for (const [license, fix] of [
    ["Apache 2", 'use "Apache-2.0"'],
    ["mit", 'use "MIT"'],
    ["GPLv3", 'use "GPL-3.0-only" or "GPL-3.0-or-later"'],
  ] as const) {
    const findings = checkLicense(license);
    assert.deepEqual(
      findings.map((finding) => [finding.rule, finding.level, finding.fix]),
      [["license-spdx", "notice", fix]],
      license,
    );
  }
});

test("SPDX expressions of known ids pass", () => {
  for (const license of [
    "MIT",
    "MIT OR Apache-2.0",
    "GPL-2.0-only WITH Classpath-exception-2.0",
    "LicenseRef-Proprietary",
    "DocumentRef-example:LicenseRef-Example-1",
    "(MIT OR ISC) AND BSD-3-Clause",
    "MIT and ISC",
    "GPL-2.0-or-later with Bison-exception-2.2",
    "Apache-2.0+",
    "GPL-2.0-only WITH AdditionRef-Example",
    // Deprecated ids are still on the list.
    "GPL-2.0",
    "GPL-2.0+",
  ]) {
    assert.deepEqual(checkLicense(license), [], license);
  }
});

test("a license that isn't a string is a field-type error, not a notice", () => {
  assert.deepEqual(
    checkLicense(true).map((finding) => finding.rule),
    ["field-type"],
  );
});

test("the fix never repeats the license, and current only describes it", () => {
  for (const license of [
    "Apache 2",
    "mit OR apache-2.0",
    "Secret-Token-Example",
    "See LICENSE file",
    "MIT AND Example-License",
  ]) {
    const [finding] = checkLicense(license);
    assert.equal(finding?.rule, "license-spdx", license);
    assert.equal(finding?.current, `string (${license.length} chars)`);
    assert.ok(!finding?.fix.includes(license), license);
  }
  const [finding] = checkLicense("MIT AND Secret-Token-Example");
  assert.ok(!finding?.fix.includes("Secret"));
});

test("well-known spellings and wrong case get the id from the list", () => {
  for (const [license, fix] of [
    ["MIT License", 'use "MIT"'],
    ["The MIT License", 'use "MIT"'],
    ["Apache License, Version 2.0", 'use "Apache-2.0"'],
    ["apache-2.0", 'use "Apache-2.0"'],
    ["BSD 3 Clause", 'use "BSD-3-Clause"'],
    ["GPL 2.0 or later", 'use "GPL-2.0-or-later"'],
    [" MIT", 'use "MIT"'],
    // A deprecated id in the wrong case is fixed to the current ids, not to the deprecated one.
    ["gpl-2.0", 'use "GPL-2.0-only" or "GPL-2.0-or-later"'],
  ] as const) {
    assert.equal(checkLicense(license)[0]?.fix, fix, license);
  }
});

test("in an expression, each term to change is named by its position", () => {
  for (const [license, fix] of [
    [
      "mit OR apache-2.0",
      'use "MIT" for the 1st term, and "Apache-2.0" for the 2nd term',
    ],
    [
      "MIT AND Example-License",
      'use an SPDX License List id or a "LicenseRef-" id for the 2nd term',
    ],
    [
      "GPL-2.0-only WITH classpath-exception-2.0",
      'use "Classpath-exception-2.0" for the 2nd term',
    ],
    [
      "GPL-2.0-only WITH Example-exception",
      "use an exception id from the SPDX License List for the 2nd term",
    ],
  ] as const) {
    assert.equal(checkLicense(license)[0]?.fix, fix, license);
  }
});

test("text that isn't an expression gets a generic example", () => {
  for (const license of ["", "See LICENSE file", "MIT Or ISC", "MIT OR"]) {
    assert.equal(
      checkLicense(license)[0]?.fix,
      'use an SPDX license expression, e.g. "MIT" or "MIT OR Apache-2.0"',
      license,
    );
  }
});

test("a license-spdx finding is only ever a notice", () => {
  for (const license of ["Apache 2", "", "x".repeat(500), "(".repeat(100)]) {
    const findings = checkLicense(license);
    assert.equal(findings.length, 1, license);
    assert.ok(findings.every((finding) => finding.level === "notice"));
  }
});

test("the parser follows the SPDX expression grammar", () => {
  const valid = [
    "MIT",
    "MIT+",
    "LicenseRef-a.b-1",
    "DocumentRef-x:LicenseRef-y",
    "A OR B AND C",
    "(A OR B) AND C",
    "A WITH E",
    "(A WITH E) OR B",
    "A with E or B and C",
    "((A))",
  ];
  const invalid = [
    "",
    " MIT",
    "MIT ",
    "MIT +",
    "A Or B",
    "A OR",
    "OR A",
    "A B",
    "(A",
    "A)",
    "()",
    "(A) WITH E",
    "A WITH E WITH F",
    "A WITH (E)",
    "A/B",
  ];
  for (const text of valid) assert.ok(parseExpression(text).ok, text);
  for (const text of invalid) assert.ok(!parseExpression(text).ok, text);
});

test("the parser reports ids by kind and position, and not refs", () => {
  assert.deepEqual(parseExpression("LicenseRef-x OR (A+ AND B WITH E)"), {
    ok: true,
    terms: 4,
    ids: [
      { kind: "license", id: "A", term: 1 },
      { kind: "license", id: "B", term: 2 },
      { kind: "exception", id: "E", term: 3 },
    ],
  });
});

test("deep nesting is refused, not parsed until the stack runs out", () => {
  const deep = `${"(".repeat(100_000)}MIT${")".repeat(100_000)}`;
  assert.equal(parseExpression(deep).ok, false);
});

test("the list in use is the one vendored in data/spdx/", () => {
  const folders = readdirSync(new URL("../../data/spdx/", import.meta.url));
  assert.deepEqual(folders, [SPDX_LIST_VERSION]);
  assert.ok(LICENSE_IDS.has("MIT"));
});
