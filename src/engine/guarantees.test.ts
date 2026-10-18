import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ruleById, ruleEffect, ruleSection, rules } from "../rules/index.ts";
import { slug, specUrl } from "./spec.ts";
import {
  PATTERN_WORDS,
  STRUCTURAL_KEYWORDS,
  translators,
} from "./translate.ts";
import { vendoredRegistry } from "./vendored.ts";

const srcDir = new URL("../", import.meta.url);
const schemasDir = new URL("../../schemas/", import.meta.url);

function sourcesOf(folder: string): { name: string; text: string }[] {
  const dir = new URL(`${folder}/`, srcDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({
      name: `src/${folder}/${name}`,
      text: readFileSync(new URL(name, dir), "utf8"),
    }));
}

test("the engine and the rules import nothing that does IO and don't read the environment", () => {
  const forbidden = [
    /(?:from|import)\s*["'](?:node:)?(?:fs|fs\/promises|net|http|https|http2|dns|child_process|tls|dgram|worker_threads|os)["']/,
    /\bprocess\./,
    /\bfetch\s*\(/,
    /\bDate\.now\b|\bnew Date\b|\bMath\.random\b/,
    /\bimport\s*\(/,
    /\brequire\s*\(/,
  ];
  const files = [...sourcesOf("engine"), ...sourcesOf("rules")];
  assert.ok(files.length > 0);
  for (const { name, text } of files) {
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(text), `${name} matches ${pattern}`);
    }
  }
});

test("the default registry has exactly the versions vendored in schemas/", () => {
  const folders = readdirSync(schemasDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.deepEqual([...vendoredRegistry().versions].sort(), folders.sort());
});

/** Every keyword that appears in a schema, wherever a subschema can be. */
function keywordsIn(schema: unknown, found = new Set<string>()): Set<string> {
  if (typeof schema !== "object" || schema === null) return found;
  if (Array.isArray(schema)) {
    for (const item of schema) keywordsIn(item, found);
    return found;
  }
  const node = schema as Record<string, unknown>;
  for (const [keyword, value] of Object.entries(node)) {
    found.add(keyword);
    if (keyword === "properties" || keyword === "$defs") {
      for (const sub of Object.values(value as Record<string, unknown>))
        keywordsIn(sub, found);
    } else if (
      [
        "items",
        "additionalProperties",
        "propertyNames",
        "not",
        "oneOf",
      ].includes(keyword)
    ) {
      keywordsIn(value, found);
    }
  }
  return found;
}

test("every keyword in the vendored schemas has a translator", () => {
  const versions = readdirSync(schemasDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.ok(versions.length > 0);
  for (const version of versions) {
    const dir = new URL(`${version}/`, schemasDir);
    for (const file of readdirSync(dir).filter((f) =>
      f.endsWith(".schema.json"),
    )) {
      const schema = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
      for (const keyword of keywordsIn(schema)) {
        if (STRUCTURAL_KEYWORDS.includes(keyword)) continue;
        assert.ok(
          keyword in translators,
          `schemas/${version}/${file} uses "${keyword}" without a translator`,
        );
      }
    }
  }
});

test("the structural keywords are not translated", () => {
  for (const keyword of STRUCTURAL_KEYWORDS) {
    assert.ok(!(keyword in translators), keyword);
  }
});

test("rule ids are unique kebab-case", () => {
  const ids = rules.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z]+(?:-[a-z]+)*$/);
});

test("every rule section exists in the specification", () => {
  for (const rule of rules) {
    for (const kind of ["plugin", "mcp"] as const) {
      if (rule.appliesTo !== "both" && rule.appliesTo !== kind) continue;
      assert.match(
        specUrl("1.0.0", ruleSection(rule, kind)),
        /\/v1\.0\.0\/spec\/1\.0\.0\.md#/,
      );
    }
  }
});

test("section anchors match the ones the specification's own links use", () => {
  const base =
    "https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md";
  assert.equal(
    specUrl("1.0.0", "7.2.1"),
    `${base}#721-discovery-and-configuration`,
  );
  assert.equal(specUrl("1.0.0", "5.2"), `${base}#52-manifest-object`);
  assert.equal(specUrl("1.0.0", "10.2"), `${base}#102-plugin-versions`);
  assert.equal(specUrl("1.0.0", "7.2.2"), `${base}#722-loading-rules`);
  assert.equal(specUrl("1.0.0", "8"), `${base}#8-client-extensions`);
  assert.equal(specUrl("1.0.0", "stdio"), `${base}#stdio`);
  assert.equal(
    specUrl("1.0.0", "Streamable HTTP and legacy HTTP+SSE"),
    `${base}#streamable-http-and-legacy-httpsse`,
  );
});

test("specUrl throws for a section that doesn't exist", () => {
  assert.throws(() => specUrl("1.0.0", "99.9"));
});

test("slug follows GitHub's anchor rules", () => {
  assert.equal(
    slug("Appendix A: Conformance Checklist"),
    "appendix-a-conformance-checklist",
  );
  assert.equal(
    slug("7.2.1 Discovery and configuration"),
    "721-discovery-and-configuration",
  );
});

test("every pattern in the vendored schemas is described in words", () => {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === "pattern" && typeof value === "string") found.add(value);
        else visit(value);
      }
    }
  };
  for (const version of readdirSync(schemasDir, { withFileTypes: true })) {
    if (!version.isDirectory()) continue;
    const dir = new URL(`${version.name}/`, schemasDir);
    for (const file of readdirSync(dir).filter((f) =>
      f.endsWith(".schema.json"),
    )) {
      visit(JSON.parse(readFileSync(new URL(file, dir), "utf8")));
    }
  }
  assert.ok(found.size > 0);
  for (const pattern of found) assert.ok(pattern in PATTERN_WORDS, pattern);
});

test("rules are found by id, including schema-violation, with their effect", () => {
  for (const rule of rules) assert.equal(ruleById(rule.id), rule);
  const violation = ruleById("schema-violation");
  assert.ok(violation);
  assert.match(ruleEffect(violation, "mcp"), /MCP/);
  assert.match(ruleEffect(violation, "plugin"), /reject the plugin/);
  assert.equal(ruleById("nope"), undefined);
});

test("only src/discover, the reporters and the tests read files, and the engine never does", () => {
  const allowed = ["discover", "report", "github", "testing"];
  const folders = readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !allowed.includes(entry.name))
    .map((entry) => entry.name);
  assert.ok(folders.includes("engine") && folders.includes("rules"));
  const reading = /(?:from|import)\s*["'](?:node:)?(?:fs|fs\/promises)["']/;
  for (const folder of folders) {
    for (const { name, text } of sourcesOf(folder)) {
      assert.ok(!reading.test(text), `${name} reads files`);
    }
  }
});
