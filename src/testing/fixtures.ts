import { readdirSync, readFileSync } from "node:fs";
import type { Finding, PluginInput } from "../engine/types.ts";

export interface Fixture {
  name: string;
  input: PluginInput;
  /** The findings a `fail` fixture must produce. Empty for a `pass` fixture. */
  expected: Finding[];
}

const fixturesDir = new URL("../../fixtures/", import.meta.url);

const COMPANION_PLUGIN = JSON.stringify({
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "example-plugin",
});

/** A valid `plugin.json`, for tests that are about an `mcp.json`. */
export const MINIMAL_PLUGIN = { path: "plugin.json", text: COMPANION_PLUGIN };

/**
 * Loads `fixtures/<rule-id>/{pass,fail}/*.json`. The kind of a fixture is in its name:
 * - `x.plugin.json` is a `plugin.json`;
 * - `x.mcp.json` is an `mcp.json`, checked with a minimal valid `plugin.json` beside it;
 * - `x.mcp-only.json` is an `mcp.json` with no `plugin.json`.
 * A failing fixture has a sibling `x.<kind>.expected.json` with the exact findings.
 */
export function loadFixtures(): { pass: Fixture[]; fail: Fixture[] } {
  const loaded = { pass: [] as Fixture[], fail: [] as Fixture[] };
  for (const rule of readdirSync(fixturesDir)) {
    for (const outcome of ["pass", "fail"] as const) {
      const dir = new URL(`${rule}/${outcome}/`, fixturesDir);
      for (const file of readdirSync(dir)) {
        const match = /^(.+)\.(plugin|mcp|mcp-only)\.json$/.exec(file);
        if (match === null || file.endsWith(".expected.json")) continue;
        const [, base = "", kind = ""] = match;
        const text = readFileSync(new URL(file, dir), "utf8");
        let input: PluginInput;
        if (kind === "plugin") {
          input = { root: "", plugin: { path: "plugin.json", text } };
        } else if (kind === "mcp") {
          input = {
            root: "",
            plugin: MINIMAL_PLUGIN,
            mcp: { path: "mcp.json", text },
          };
        } else {
          input = { root: "", mcp: { path: "mcp.json", text } };
        }
        const expectedFile = new URL(`${base}.${kind}.expected.json`, dir);
        loaded[outcome].push({
          name: `${rule}/${outcome}/${file}`,
          input,
          expected:
            outcome === "fail"
              ? JSON.parse(readFileSync(expectedFile, "utf8"))
              : [],
        });
      }
    }
  }
  return loaded;
}
