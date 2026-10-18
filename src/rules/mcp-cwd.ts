import type {
  Claim,
  Problem,
  Rule,
  RuleContext,
  SchemaError,
} from "../engine/types.ts";
import { mcpServers } from "./mcp-servers.ts";
import { escapes } from "./path-text.ts";
import { quote } from "./util.ts";

// biome-ignore lint/suspicious/noTemplateCurlyInString: the spec's placeholder, written as text
const ROOT = "${PLUGIN_ROOT}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: the spec's placeholder, written as text
const DATA = "${PLUGIN_DATA}";

/** The three forms the spec allows, with the directory each one is relative to. */
function baseOf(cwd: string): { prefix: string; rest: string } | null {
  if (cwd.startsWith("./")) return { prefix: "./", rest: cwd.slice(2) };
  for (const prefix of [ROOT, DATA]) {
    if (cwd === prefix) return { prefix, rest: "" };
    if (cwd.startsWith(`${prefix}/`)) {
      return { prefix, rest: cwd.slice(prefix.length + 1) };
    }
  }
  return null;
}

// The fixes are instructions with a generic example. They never repeat any part of the `cwd`,
// which is free text.
const FORM_FIX = `start the path with "./", ${quote(`${ROOT}/`)} or ${quote(`${DATA}/`)}, e.g. "./data"`;

/** A `cwd` in the right form that climbs out of the directory it starts in. */
function escapeFix(prefix: string): string {
  return prefix === DATA
    ? `keep the path inside the data directory: remove the ".." segments that climb out of it, e.g. ${quote(`${DATA}/cache`)}`
    : 'keep the path inside the plugin: remove the ".." segments that climb out of it, e.g. "./data"';
}

export const mcpCwd: Rule = {
  id: "mcp-cwd",
  level: "error",
  section: "stdio",
  effect: "Clients that follow the spec skip this server until it's fixed.",
  appliesTo: "mcp",
  check(ctx: RuleContext): Problem[] {
    const problems: Problem[] = [];
    for (const { name, value, shape } of mcpServers(ctx)) {
      const cwd = value.cwd;
      if (shape !== "stdio" || typeof cwd !== "string") continue;
      // A cwd in the wrong form is a schema error, claimed below.
      // A backslash separates path segments too, so it can't be used to climb out unseen.
      const base = baseOf(cwd.replaceAll("\\", "/"));
      if (base !== null && escapes(base.rest)) {
        problems.push({
          path: ["mcpServers", name, "cwd"],
          current: cwd,
          fix: escapeFix(base.prefix),
        });
      }
    }
    return problems;
  },
  claim(error: SchemaError): Claim | undefined {
    if (error.server === undefined || error.keyword !== "pattern") {
      return undefined;
    }
    if (error.path.length !== 3 || error.path[2] !== "cwd") return undefined;
    return {
      path: error.path,
      current: error.value,
      fix: FORM_FIX,
    };
  },
};
