import type { Problem, Rule } from "../engine/types.ts";

/**
 * `mcp.json` resolves outside its plugin root, or isn't a regular file. The engine reports it for a
 * file that discovery couldn't hand over; this rule has no check of its own. A client treats MCP as
 * invalid for the plugin (§4.1, §6.2).
 */
export const mcpComponentLocation: Rule = {
  id: "mcp-component-location",
  level: "error",
  section: "6.2",
  effect: "Clients that follow the spec turn off MCP for this plugin.",
  appliesTo: "mcp",
  check(): Problem[] {
    return [];
  },
};
