import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { check } from "../engine/check.ts";
import { createRegistry } from "../engine/registry.ts";
import { loadFixtures, MINIMAL_PLUGIN } from "../testing/fixtures.ts";
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

function checkServers(servers: Record<string, unknown>) {
  const text = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "mcp"),
    mcpServers: servers,
  });
  return check({
    root: "",
    plugin: MINIMAL_PLUGIN,
    mcp: { path: "mcp.json", text },
  }).findings;
}

test("the type table maps every written form, ignoring case, '-', '_' and spaces", () => {
  const expected: [string, string][] = [
    ["http", "streamable-http"],
    ["HTTP", "streamable-http"],
    ["streamableHttp", "streamable-http"],
    ["streamable_http", "streamable-http"],
    ["Streamable HTTP", "streamable-http"],
    ["streamable", "streamable-http"],
    ["httpStream", "streamable-http"],
    ["STDIO", "stdio"],
    ["local", "stdio"],
    ["command", "stdio"],
    ["Process", "stdio"],
    ["SSE", "sse"],
    ["http-sse", "sse"],
    ["EventSource", "sse"],
  ];
  for (const [written, fix] of expected) {
    const body =
      fix === "stdio"
        ? { command: "./x" }
        : { url: "https://a.example.com/mcp" };
    const findings = checkServers({ s: { type: written, ...body } });
    assert.equal(findings.length, 1, written);
    assert.equal(findings[0]?.rule, "mcp-server-type", written);
    assert.equal(findings[0]?.fix, `use "${fix}"`, written);
  }
});

test("a type outside the table lists the three values", () => {
  const [finding] = checkServers({
    s: { type: "websocket", url: "https://a.example.com/mcp" },
  });
  assert.equal(finding?.rule, "mcp-server-type");
  assert.equal(finding?.fix, 'use "stdio", "streamable-http" or "sse"');
});

test("a type that isn't a string is reported as a type problem, once", () => {
  const findings = checkServers({ s: { type: 3, command: "./x" } });
  assert.deepEqual(
    findings.map((f) => [f.rule, f.field, f.current]),
    [["mcp-server-type", "mcpServers.s.type", "3"]],
  );
});

test("with both command and url and no type, only the type is reported", () => {
  const findings = checkServers({
    s: { command: "./x", url: "https://a.example.com/mcp" },
  });
  assert.deepEqual(
    findings.map((f) => [f.rule, f.field]),
    [["mcp-server-type", "mcpServers.s.type"]],
  );
});

test("reserved names are matched exactly", () => {
  const findings = checkServers({
    s: {
      type: "stdio",
      command: "./x",
      env: { PLUGIN_ROOT: "a", plugin_root: "b", PLUGIN_DATA: "c" },
    },
  });
  assert.deepEqual(
    findings.map((f) => [f.rule, f.field]),
    [
      ["mcp-env-reserved", "mcpServers.s.env.PLUGIN_DATA"],
      ["mcp-env-reserved", "mcpServers.s.env.PLUGIN_ROOT"],
    ],
  );
});

test("with two broken servers, each gets its own findings under its own name", () => {
  const findings = checkServers({
    first: { type: "stdio", command: "node", args: "a b" },
    "second one": { type: "sse", url: 5 },
  });
  assert.deepEqual(
    findings.map((f) => f.field),
    ["mcpServers.first.args", "mcpServers[…].url"],
  );
});

test("no finding from the MCP fixtures quotes the validator", () => {
  for (const fixture of loadFixtures().fail) {
    for (const finding of check(fixture.input).findings) {
      for (const text of [finding.fix, finding.current]) {
        assert.doesNotMatch(
          text,
          /must (match|be|have|NOT)|exactly one|should/i,
          fixture.name,
        );
      }
    }
  }
});

test("a server with transport and no type is never silently accepted", () => {
  const others: Record<string, unknown>[] = [
    {},
    { command: "node" },
    { url: "https://a.example.com/mcp" },
    { command: "node", url: "https://a.example.com/mcp" },
    { command: "node", args: [] },
    { args: [], headers: {} },
  ];
  for (const transport of ["stdio", "http", 5, null]) {
    for (const rest of others) {
      const findings = checkServers({ s: { transport, ...rest } });
      assert.ok(
        findings.some((f) => f.fix.includes('rename "transport" to "type"')),
        JSON.stringify({ transport, ...rest }),
      );
      // The rename is reported once.
      assert.equal(
        findings.filter((f) => f.fix.includes('rename "transport"')).length,
        1,
        JSON.stringify({ transport, ...rest }),
      );
    }
  }
});
