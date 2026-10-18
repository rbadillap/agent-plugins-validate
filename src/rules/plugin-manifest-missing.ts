import type { Problem, Rule, RuleContext } from "../engine/types.ts";

export const pluginManifestMissing: Rule = {
  id: "plugin-manifest-missing",
  level: "error",
  section: "4.1",
  effect:
    "Clients that follow the spec can't load a plugin without a plugin.json.",
  appliesTo: "mcp",
  check(ctx: RuleContext): Problem[] {
    if (ctx.sibling === undefined || ctx.sibling.present) return [];
    return [
      { path: [], current: undefined, fix: "add plugin.json next to mcp.json" },
    ];
  },
};
