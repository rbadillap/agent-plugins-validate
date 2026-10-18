import type { Problem, Rule, RuleContext } from "../engine/types.ts";
import { canonicalSchema } from "./schema-version.ts";

export const mcpVersionMatch: Rule = {
  id: "mcp-version-match",
  level: "error",
  section: "10.1",
  effect: "Clients that follow the spec turn off MCP for this plugin.",
  appliesTo: "mcp",
  check(ctx: RuleContext): Problem[] {
    // Only when both files declare a supported version: a file with a schema-version finding is
    // already reported, and a second finding would report the same mistake twice.
    const pluginVersion = ctx.sibling?.specVersion;
    if (ctx.specVersion === null || pluginVersion == null) return [];
    if (ctx.specVersion === pluginVersion) return [];
    return [
      {
        path: ["$schema"],
        current: canonicalSchema(ctx.specVersion, "mcp"),
        fix: `use the same version as plugin.json: ${JSON.stringify(canonicalSchema(pluginVersion, "mcp"))}`,
      },
    ];
  },
};
