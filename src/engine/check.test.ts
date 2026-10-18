import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalSchema } from "../rules/schema-version.ts";
import { check, inspect } from "./check.ts";
import type { PluginInput } from "./types.ts";

const fixturesDir = new URL("../../fixtures/", import.meta.url);

interface Fixture {
  name: string;
  input: PluginInput;
  expected: unknown;
}

function loadFixtures(): { pass: Fixture[]; fail: Fixture[] } {
  const loaded = { pass: [] as Fixture[], fail: [] as Fixture[] };
  for (const rule of readdirSync(fixturesDir)) {
    for (const outcome of ["pass", "fail"] as const) {
      const dir = new URL(`${rule}/${outcome}/`, fixturesDir);
      for (const file of readdirSync(dir)) {
        const match = /^(.+)\.(plugin|mcp)\.json$/.exec(file);
        if (match === null || file.endsWith(".expected.json")) continue;
        const text = readFileSync(new URL(file, dir), "utf8");
        const kind = match[2] === "plugin" ? "plugin" : "mcp";
        const entry = { path: `${kind}.json`, text };
        const input: PluginInput =
          kind === "plugin"
            ? { root: "", plugin: entry }
            : { root: "", mcp: entry };
        const expectedFile = new URL(`${match[1]}.${kind}.expected.json`, dir);
        const expected =
          outcome === "fail"
            ? JSON.parse(readFileSync(expectedFile, "utf8"))
            : [];
        loaded[outcome].push({
          name: `${rule}/${outcome}/${file}`,
          input,
          expected,
        });
      }
    }
  }
  return loaded;
}

const fixtures = loadFixtures();

test("there are pass and fail fixtures", () => {
  assert.ok(fixtures.pass.length > 0);
  assert.ok(fixtures.fail.length > 0);
});

for (const fixture of [...fixtures.pass, ...fixtures.fail]) {
  test(`fixture ${fixture.name}`, () => {
    assert.deepEqual(check(fixture.input).findings, fixture.expected);
  });
}

test("a fail fixture always reports something", () => {
  for (const fixture of fixtures.fail) {
    assert.ok(
      Array.isArray(fixture.expected) && fixture.expected.length > 0,
      fixture.name,
    );
  }
});

test("every schema error from the fixtures is claimed by exactly one rule", () => {
  for (const fixture of [...fixtures.pass, ...fixtures.fail]) {
    for (const { error, claimedBy } of inspect(fixture.input).claims) {
      assert.equal(
        claimedBy.length,
        1,
        `${fixture.name}: ${error.keyword} at ${error.schemaPath} is claimed by [${claimedBy}]`,
      );
    }
  }
});

test("a schema error no rule claims still gets a concrete finding", () => {
  const input: PluginInput = {
    root: "",
    plugin: {
      path: "plugin.json",
      text: JSON.stringify({
        $schema: canonicalSchema("1.0.0", "plugin"),
        name: 5,
      }),
    },
  };
  const inspection = inspect(input);
  assert.equal(inspection.claims.length, 1);
  assert.deepEqual(inspection.claims[0]?.claimedBy, []);
  const [finding] = inspection.result.findings;
  assert.equal(finding?.rule, "schema-violation");
  assert.equal(finding?.field, "name");
  assert.equal(finding?.current, "5");
  assert.equal(finding?.fix, 'use "5"');
});

test("the oneOf example gives exactly one finding", () => {
  const text = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "mcp"),
    mcpServers: { docs: { type: "http", url: "https://docs.example.com/mcp" } },
  });
  const { findings } = check({ root: "", mcp: { path: "mcp.json", text } });
  assert.deepEqual(findings, [
    {
      rule: "mcp-server-type",
      level: "error",
      file: "mcp.json",
      field: "mcpServers.docs.type",
      current: '"http"',
      fix: 'use "streamable-http"',
      spec: "https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md#721-discovery-and-configuration",
    },
  ]);
});

test("a server that isn't an object is checked against a shape and reported by field", () => {
  const text = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "mcp"),
    mcpServers: { broken: "node server.js" },
  });
  const [finding] = check({
    root: "",
    mcp: { path: "mcp.json", text },
  }).findings;
  assert.equal(finding?.field, "mcpServers.broken");
  assert.equal(finding?.current, '"node server.js"');
  assert.equal(finding?.fix, "use an object");
});

test("findings come back in a stable order, whatever the input order", () => {
  const plugin = { path: "plugin.json", text: "{" };
  const mcp = { path: "mcp.json", text: "[" };
  const files = check({ root: "", plugin, mcp }).findings.map((f) => f.file);
  assert.deepEqual(files, ["mcp.json", "plugin.json"]);
});

test("files report the declared spec version, or null", () => {
  const good = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "plugin"),
    name: "a",
  });
  const result = check({
    root: "",
    plugin: { path: "plugin.json", text: good },
    mcp: { path: "mcp.json", text: "{}" },
  });
  assert.deepEqual(result.files, [
    { file: "plugin.json", kind: "plugin", specVersion: "1.0.0" },
    { file: "mcp.json", kind: "mcp", specVersion: null },
  ]);
});

test("the same input gives the same findings", () => {
  const fixture = fixtures.fail[0];
  assert.ok(fixture);
  assert.deepEqual(check(fixture.input), check(fixture.input));
});

test("errors without an owner are translated, never shown in the validator's words", () => {
  const plugin = {
    $schema: canonicalSchema("1.0.0", "plugin"),
    name: "",
    version: 3,
    skills: [],
    author: "Jane",
  };
  const mcp = {
    $schema: canonicalSchema("1.0.0", "mcp"),
    mcpServers: {
      local: {
        type: "stdio",
        command: "",
        env: { PLUGIN_ROOT: "/x" },
        cwd: "data",
        url: "https://docs.example.com/mcp",
      },
    },
  };
  const findings = check({
    root: "",
    plugin: { path: "plugin.json", text: JSON.stringify(plugin) },
    mcp: { path: "mcp.json", text: JSON.stringify(mcp) },
  }).findings.map((f) => `${f.field} ${f.fix}`);
  assert.deepEqual(findings.sort(), [
    "author use an object",
    "mcpServers.local.command use a non-empty string",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the spec's placeholders, written as text
    'mcpServers.local.cwd use a value that starts with "./", "${PLUGIN_ROOT}" or "${PLUGIN_DATA}"',
    'mcpServers.local.env.PLUGIN_ROOT remove "PLUGIN_ROOT"',
    'mcpServers.local.url remove "url"',
    "name use a non-empty string",
    'name use a value that contains only lowercase letters, digits, hyphens and periods, starts and ends with a letter or digit, and has no "--" or ".."',
    'skills remove "skills"',
    'version use "3"',
  ]);
});

test("a missing required field is described, not filled with a value that would fail", () => {
  const text = JSON.stringify({ $schema: canonicalSchema("1.0.0", "plugin") });
  const [finding] = check({
    root: "",
    plugin: { path: "plugin.json", text },
  }).findings;
  assert.equal(finding?.field, "name");
  assert.equal(finding?.current, "(missing)");
  assert.equal(
    finding?.fix,
    'add "name" as a non-empty string that contains only lowercase letters, digits, hyphens and periods, starts and ends with a letter or digit, and has no "--" or ".."',
  );
});

test("a byte order mark gets its own fix", () => {
  const text = `﻿{ "name": "x" }`;
  const [finding] = check({
    root: "",
    plugin: { path: "plugin.json", text },
  }).findings;
  assert.equal(finding?.rule, "json-syntax");
  assert.equal(
    finding?.fix,
    "remove the byte order mark at the start of the file",
  );
});

test("a type error deeper than a server's own type field isn't claimed by mcp-server-type", () => {
  const text = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "mcp"),
    mcpServers: { a: { type: "stdio", command: "./x", env: { type: 1 } } },
  });
  const inspection = inspect({ root: "", mcp: { path: "mcp.json", text } });
  assert.deepEqual(
    inspection.claims.map((c) => c.claimedBy),
    [[]],
  );
});
