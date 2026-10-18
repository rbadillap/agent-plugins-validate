import assert from "node:assert/strict";
import { test } from "node:test";
import { rules } from "../rules/index.ts";
import { canonicalSchema } from "../rules/schema-version.ts";
import { loadFixtures, MINIMAL_PLUGIN } from "../testing/fixtures.ts";
import { check, inspect } from "./check.ts";
import type { PluginInput } from "./types.ts";

// Only the gates: no rule claims a schema error, so the fallback is what answers.
const gatesOnly = rules.filter((rule) => rule.gate);

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

test("no fixture produces schema-violation", () => {
  for (const fixture of [...fixtures.pass, ...fixtures.fail]) {
    for (const finding of check(fixture.input).findings) {
      assert.notEqual(finding.rule, "schema-violation", fixture.name);
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
  const inspection = inspect(input, undefined, gatesOnly);
  assert.equal(inspection.claims.length, 1);
  assert.deepEqual(inspection.claims[0]?.claimedBy, []);
  const [finding] = inspection.result.findings;
  assert.equal(finding?.rule, "schema-violation");
  assert.equal(finding?.field, "name");
  assert.equal(finding?.current, "5");
  assert.equal(finding?.fix, 'use "5"');
});

test("the oneOf example gives exactly one finding", () => {
  const text = `{
  "$schema": "${canonicalSchema("1.0.0", "mcp")}",
  "mcpServers": {
    "docs": { "type": "http", "url": "https://docs.example.com/mcp" }
  }
}`;
  const { findings } = check({
    root: "",
    plugin: MINIMAL_PLUGIN,
    mcp: { path: "mcp.json", text },
  });
  assert.deepEqual(findings, [
    {
      rule: "mcp-server-type",
      level: "error",
      file: "mcp.json",
      field: "mcpServers.docs.type",
      current: '"http"',
      fix: 'use "streamable-http"',
      spec: "https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md#721-discovery-and-configuration",
      line: 4,
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
    plugin: MINIMAL_PLUGIN,
    mcp: { path: "mcp.json", text },
  }).findings;
  assert.equal(finding?.field, "mcpServers.broken");
  assert.equal(finding?.current, '"node server.js"');
  assert.equal(finding?.fix, 'use an object with "type"');
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
  const findings = check(
    {
      root: "",
      plugin: { path: "plugin.json", text: JSON.stringify(plugin) },
      mcp: { path: "mcp.json", text: JSON.stringify(mcp) },
    },
    undefined,
    gatesOnly,
  ).findings.map((f) => `${f.field} ${f.fix}`);
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
  const [finding] = check(
    { root: "", plugin: { path: "plugin.json", text } },
    undefined,
    gatesOnly,
  ).findings;
  assert.equal(finding?.field, "name");
  assert.equal(finding?.current, "(missing)");
  assert.equal(
    finding?.fix,
    'add "name" as a non-empty string that contains only lowercase letters, digits, hyphens and periods, starts and ends with a letter or digit, and has no "--" or ".."',
  );
});

test("a byte order mark gets its own fix", () => {
  const text = `\uFEFF{ "name": "x" }`;
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

test("a type error deeper than a server's own type field is not mistaken for the server type", () => {
  const text = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "mcp"),
    mcpServers: { a: { type: "stdio", command: "./x", env: { type: 1 } } },
  });
  const inspection = inspect({
    root: "",
    plugin: MINIMAL_PLUGIN,
    mcp: { path: "mcp.json", text },
  });
  assert.deepEqual(
    inspection.claims.map((c) => c.claimedBy),
    [["mcp-server-fields"]],
  );
});

test("every finding from the fixtures has a line", () => {
  for (const fixture of fixtures.fail) {
    for (const finding of check(fixture.input).findings) {
      assert.equal(typeof finding.line, "number", fixture.name);
      assert.ok((finding.line ?? 0) >= 1, fixture.name);
    }
  }
});
