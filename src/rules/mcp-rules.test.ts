import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { check } from "../engine/check.ts";
import { createRegistry } from "../engine/registry.ts";
import { MINIMAL_PLUGIN } from "../testing/fixtures.ts";
import { canonicalSchema } from "./schema-version.ts";

function vendored(file: string, version: string): object {
  const text = readFileSync(
    new URL(`../../schemas/1.0.0/${file}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(text.replaceAll("1.0.0", version));
}

// A test-only second version, made in memory. Nothing like it is ever put in schemas/.
const registry = createRegistry({
  "1.0.0": {
    plugin: vendored("plugin.schema.json", "1.0.0"),
    mcp: vendored("mcp.schema.json", "1.0.0"),
  },
  "2.0.0": {
    plugin: vendored("plugin.schema.json", "2.0.0"),
    mcp: vendored("mcp.schema.json", "2.0.0"),
  },
});

function manifests(pluginVersion: string, mcpVersion: string) {
  return {
    root: "",
    plugin: {
      path: "plugin.json",
      text: JSON.stringify({
        $schema: canonicalSchema(pluginVersion, "plugin"),
        name: "example-plugin",
      }),
    },
    mcp: {
      path: "mcp.json",
      text: JSON.stringify({
        $schema: canonicalSchema(mcpVersion, "mcp"),
        mcpServers: {},
      }),
    },
  };
}

test("mcp.json on another supported version than plugin.json is a mismatch", () => {
  const { findings } = check(manifests("1.0.0", "2.0.0"), registry);
  assert.deepEqual(
    findings.map((f) => [f.rule, f.file, f.field, f.current, f.fix]),
    [
      [
        "mcp-version-match",
        "mcp.json",
        "$schema",
        '"https://agent-plugins.org/schemas/2.0.0/mcp.schema.json"',
        'use the same version as plugin.json: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"',
      ],
    ],
  );
  assert.equal(findings[0]?.level, "error");
  assert.equal(findings[0]?.line, 1);
});

test("the same version in both files is not a mismatch", () => {
  assert.deepEqual(check(manifests("2.0.0", "2.0.0"), registry).findings, []);
  assert.deepEqual(check(manifests("1.0.0", "1.0.0"), registry).findings, []);
});

test("the mismatch rule stays silent when one file already has a schema-version finding", () => {
  const pluginUnsupported = check(
    manifests("3.0.0", "2.0.0"),
    registry,
  ).findings;
  assert.deepEqual(
    pluginUnsupported.map((f) => [f.rule, f.file]),
    [["schema-version", "plugin.json"]],
  );
  const mcpUnsupported = check(manifests("1.0.0", "3.0.0"), registry).findings;
  assert.deepEqual(
    mcpUnsupported.map((f) => [f.rule, f.file]),
    [["schema-version", "mcp.json"]],
  );
});

test("with only 1.0.0 vendored, a mismatch can't happen", () => {
  const findings = check(manifests("1.0.0", "2.0.0")).findings;
  assert.deepEqual(
    findings.map((f) => f.rule),
    ["schema-version"],
  );
});

test("an empty mcpServers object is valid", () => {
  const { findings } = check({
    root: "",
    plugin: MINIMAL_PLUGIN,
    mcp: {
      path: "mcp.json",
      text: JSON.stringify({
        $schema: canonicalSchema("1.0.0", "mcp"),
        mcpServers: {},
      }),
    },
  });
  assert.deepEqual(findings, []);
});

test("an mcp.json without a plugin.json is reported, and plugin.json alone is not", () => {
  const text = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "mcp"),
    mcpServers: {},
  });
  const orphan = check({ root: "", mcp: { path: "mcp.json", text } }).findings;
  assert.deepEqual(
    orphan.map((f) => [f.rule, f.level, f.fix]),
    [["plugin-manifest-missing", "error", "add plugin.json next to mcp.json"]],
  );
  assert.deepEqual(check({ root: "", plugin: MINIMAL_PLUGIN }).findings, []);
});
