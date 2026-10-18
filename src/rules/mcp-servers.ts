import type { RuleContext, ServerType } from "../engine/types.ts";
import { selectServerType } from "./mcp-server-type.ts";
import { isObject } from "./util.ts";

export interface McpServer {
  name: string;
  value: Record<string, unknown>;
  shape: ServerType;
}

/**
 * The servers of `mcp.json` that are objects and whose shape can be told, in file order. A server
 * whose shape can't be told is reported by `mcp-server-type` alone.
 */
export function mcpServers(ctx: RuleContext): McpServer[] {
  if (!ctx.parsed.ok || !isObject(ctx.parsed.value)) return [];
  const servers = ctx.parsed.value.mcpServers;
  if (!isObject(servers)) return [];
  const found: McpServer[] = [];
  for (const [name, value] of Object.entries(servers)) {
    if (!isObject(value)) continue;
    const shape = selectServerType(value);
    if (shape !== null) found.push({ name, value, shape });
  }
  return found;
}
