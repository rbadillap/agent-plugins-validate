import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** The pattern the gate uses for an area, from the workflow itself. */
function areaPattern(name: string): RegExp {
  const gate = readFileSync(
    new URL("../.github/workflows/gate.yml", import.meta.url),
    "utf8",
  );
  const line = gate
    .split("\n")
    .find((l) => l.trim().startsWith(`area ${name} '`));
  assert.ok(line, `no area ${name} in gate.yml`);
  const quoted = /area \w+ '(.*)'\s*$/.exec(line)?.[1];
  assert.ok(quoted);
  return new RegExp(quoted);
}

test("the code area runs for action.yml, the bundle and the sources, and not for the README", () => {
  const code = areaPattern("code");
  for (const file of [
    "action.yml",
    "dist/index.js",
    "src/main.ts",
    "fixtures/self-check/pass/plugin.json",
    "Makefile",
    ".github/actions/setup/action.yml",
    ".github/workflows/test-code.yml",
  ]) {
    assert.ok(code.test(file), file);
  }
  for (const file of [
    "README.md",
    "docs/ci.md",
    ".github/dependabot.yml",
    "action.yaml.bak",
  ]) {
    assert.ok(!code.test(file), file);
  }
});
