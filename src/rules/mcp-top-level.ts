import type {
  Claim,
  Problem,
  Rule,
  RuleContext,
  SchemaError,
} from "../engine/types.ts";
import { isObject, quote } from "./util.ts";

/** The one other top-level field that holds an object, when `mcpServers` is missing. */
function renameCandidate(ctx: RuleContext): string | undefined {
  if (!ctx.parsed.ok || !isObject(ctx.parsed.value)) return undefined;
  const document = ctx.parsed.value;
  if (Object.hasOwn(document, "mcpServers")) return undefined;
  const candidates = Object.entries(document).filter(
    ([key, value]) => key !== "$schema" && isObject(value),
  );
  const [only] = candidates;
  return candidates.length === 1 && only !== undefined ? only[0] : undefined;
}

/** Owns the top-level shape of `mcp.json`: `mcpServers`, and fields the spec doesn't allow. */
export const mcpTopLevel: Rule = {
  id: "mcp-top-level",
  level: "error",
  section: "7.2.1",
  effect: "Clients that follow the spec turn off MCP for this plugin.",
  appliesTo: "mcp",
  check(): Problem[] {
    return [];
  },
  claim(error: SchemaError, ctx: RuleContext): Claim | undefined {
    if (error.path[0] === "mcpServers" && error.path.length === 1) {
      if (error.keyword === "required") {
        // A misnamed field is reported once, on the field itself.
        if (renameCandidate(ctx) !== undefined) return "drop";
        return {
          path: ["mcpServers"],
          current: undefined,
          fix: 'add "mcpServers": {}',
        };
      }
      if (error.keyword === "type") {
        return {
          path: ["mcpServers"],
          current: error.value,
          fix: "use an object keyed by server name",
        };
      }
      return undefined;
    }
    if (error.keyword === "additionalProperties" && error.path.length === 1) {
      const field = String(error.path[0]);
      return {
        path: error.path,
        current: error.value,
        fix:
          renameCandidate(ctx) === field
            ? `rename ${quote(field)} to "mcpServers"`
            : `remove ${quote(field)}`,
      };
    }
    return undefined;
  },
};
