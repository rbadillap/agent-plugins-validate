import type {
  Claim,
  Problem,
  Rule,
  SchemaError,
  ServerType,
} from "../engine/types.ts";
import { shownName } from "./util.ts";

export const SERVER_TYPES: readonly ServerType[] = [
  "stdio",
  "streamable-http",
  "sse",
];

const ALL_TYPES = '"stdio", "streamable-http" or "sse"';

// Matched case-insensitively after removing "-", "_" and spaces. This is the only copy of the table.
const TYPE_TABLE: ReadonlyMap<string, ServerType> = new Map([
  ["http", "streamable-http"],
  ["streamablehttp", "streamable-http"],
  ["streamable", "streamable-http"],
  ["httpstream", "streamable-http"],
  ["stdio", "stdio"],
  ["local", "stdio"],
  ["command", "stdio"],
  ["process", "stdio"],
  ["sse", "sse"],
  ["httpsse", "sse"],
  ["eventsource", "sse"],
]);

export function isServerType(value: unknown): value is ServerType {
  return SERVER_TYPES.some((type) => type === value);
}

/** The server type a written `type` stands for, when it is in the table. */
export function normalizeServerType(value: unknown): ServerType | undefined {
  if (typeof value !== "string") return undefined;
  return TYPE_TABLE.get(value.toLowerCase().replace(/[-_ ]/g, ""));
}

/**
 * The shape the author meant, in order: an exact `type`, a `type` in the table, then whichever of
 * `command` and `url` is the only one present. Null when there is nothing to infer from.
 */
export function selectServerType(
  server: Record<string, unknown>,
): ServerType | null {
  if (isServerType(server.type)) return server.type;
  const fromTable = normalizeServerType(server.type);
  if (fromTable !== undefined) return fromTable;
  const hasCommand = Object.hasOwn(server, "command");
  const hasUrl = Object.hasOwn(server, "url");
  if (hasCommand && !hasUrl) return "stdio";
  if (hasUrl && !hasCommand) return "streamable-http";
  return null;
}

function fixFor(written: unknown, branch: ServerType | null): string {
  if (written === undefined) {
    return branch === null
      ? `add "type": one of ${ALL_TYPES}`
      : `add "type": "${branch}"`;
  }
  const normalized = normalizeServerType(written);
  return normalized === undefined ? `use ${ALL_TYPES}` : `use "${normalized}"`;
}

export const mcpServerType: Rule = {
  id: "mcp-server-type",
  level: "error",
  section: "7.2.1",
  effect: "Clients that follow the spec skip this server until it's fixed.",
  appliesTo: "mcp",
  check(): Problem[] {
    return [];
  },
  claim(error: SchemaError): Claim | undefined {
    const server = error.server;
    if (
      server === undefined ||
      typeof server.value !== "object" ||
      server.value === null
    ) {
      return undefined;
    }
    const last = error.path[error.path.length - 1];
    const typeField =
      error.path.length === 3 &&
      last === "type" &&
      ["const", "required", "enum"].includes(error.keyword);
    const noBranch = error.keyword === "oneOf" && error.path.length === 2;
    if (!typeField && !noBranch) return undefined;
    const written = (server.value as Record<string, unknown>).type;
    // `transport` instead of `type` is a rename. When the shape could be inferred, mcp-server-fields
    // reports it on the `transport` field, so this rule stays silent; when it couldn't, nothing else
    // would report anything, so this rule reports the rename itself.
    const object = server.value as Record<string, unknown>;
    if (written === undefined && Object.hasOwn(object, "transport")) {
      if (server.branch !== null) return "drop";
      return {
        path: [...error.path.slice(0, 2), "transport"],
        current: object.transport,
        ...shownName(object.transport),
        fix: 'rename "transport" to "type"',
      };
    }
    return {
      path: [...error.path.slice(0, 2), "type"],
      current: written,
      ...shownName(written),
      fix: fixFor(written, server.branch),
    };
  },
};
