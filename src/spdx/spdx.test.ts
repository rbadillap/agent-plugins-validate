import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parseExpression } from "./expression.ts";
import { LICENSE_IDS, SPDX_LIST_VERSION } from "./list.ts";

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

// The files in a list folder that are not data, and so are not in SHA256SUMS.
const NOT_DATA = new Set(["SHA256SUMS", "LICENSE", "NOTICE.md"]);

test("the SPDX list matches its SHA256SUMS, and every data file is listed", () => {
  const folder = new URL(
    `../../data/spdx/${SPDX_LIST_VERSION}/`,
    import.meta.url,
  );
  const listed = new Map<string, string>();
  for (const line of readFileSync(new URL("SHA256SUMS", folder), "utf8")
    .split("\n")
    .filter((line) => line !== "")) {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    assert.ok(match !== null, `malformed SHA256SUMS line: ${line}`);
    listed.set(match[2] as string, match[1] as string);
  }
  const data = readdirSync(folder).filter((name) => !NOT_DATA.has(name));
  assert.deepEqual(data.sort(), [...listed.keys()].sort());
  for (const [name, sum] of listed) {
    const actual = createHash("sha256")
      .update(readFileSync(new URL(name, folder)))
      .digest("hex");
    assert.equal(actual, sum, name);
  }
});
