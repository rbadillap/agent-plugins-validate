import type {
  Problem,
  Rule,
  SchemaError,
  ServerType,
} from "../engine/types.ts";
import { quote } from "./util.ts";

const STDIO_FIELDS = ["command", "args", "env", "cwd"];
const HTTP_FIELDS = ["url", "headers"];
const HTTP_SECTION = "Streamable HTTP and legacy HTTP+SSE";

function sectionFor(branch: ServerType | null): string {
  if (branch === "stdio") return "stdio";
  return branch === null ? "7.2.1" : HTTP_SECTION;
}

function valueFix(value: unknown): string {
  return typeof value === "number" || typeof value === "boolean"
    ? `use ${quote(String(value))}`
    : "use a string";
}

function missingFix(field: string): string {
  return field === "command"
    ? 'add "command": "./bin/server"'
    : 'add "url": "https://example.com/mcp"';
}

/** What to do about a field that this server's shape doesn't have. */
function extraFieldFix(field: string, branch: ServerType | null): string {
  if (field === "transport") return 'rename "transport" to "type"';
  const remove = `remove ${quote(field)}`;
  if (branch === "stdio" && HTTP_FIELDS.includes(field)) {
    return field === "url"
      ? `${remove}; stdio servers use "command"`
      : `${remove}; only streamable-http and sse servers have it`;
  }
  if (branch !== null && branch !== "stdio" && STDIO_FIELDS.includes(field)) {
    return field === "command"
      ? `${remove}; HTTP servers use "url"`
      : `${remove}; only stdio servers have it`;
  }
  return remove;
}

/** The fix for a value of the wrong type, by where it is in the server. */
function typeFix(
  path: SchemaError["path"],
  value: unknown,
): string | undefined {
  const field = path[2];
  if (path.length === 3) {
    switch (field) {
      case "command":
        return 'use a string, e.g. "./bin/server"';
      case "url":
        return 'use a string, e.g. "https://example.com/mcp"';
      case "cwd":
        return 'use a string, e.g. "./data"';
      case "args": {
        if (typeof value === "string") {
          const items = value.split(/\s+/).filter((item) => item !== "");
          if (items.length > 0) return `use [${items.map(quote).join(", ")}]`;
        }
        return 'use an array of strings, e.g. ["--port", "3000"]';
      }
      case "env":
        return 'use an object of strings, e.g. {"PORT": "3000"}';
      case "headers":
        return 'use an object of strings, e.g. {"X-Tenant": "public-tenant"}';
    }
    return undefined;
  }
  if (path.length === 4 && ["args", "env", "headers"].includes(String(field))) {
    return valueFix(value);
  }
  return undefined;
}

/** Owns the fields of each server: what is required, what has the wrong type, what doesn't belong. */
export const mcpServerFields: Rule = {
  id: "mcp-server-fields",
  level: "error",
  section: "7.2.1",
  effect: "Clients that follow the spec skip this server until it's fixed.",
  appliesTo: "mcp",
  check(): Problem[] {
    return [];
  },
  claim(error: SchemaError): Problem | undefined {
    const server = error.server;
    if (server === undefined) return undefined;
    const branch = server.branch;
    const section = sectionFor(branch);
    const problem = (fix: string): Problem => ({
      path: error.path,
      current: error.value,
      fix,
      section,
    });

    if (error.path.length === 2 && error.keyword === "type") {
      return { ...problem('use an object with "type"'), section: "7.2.1" };
    }
    if (error.path.length < 3) return undefined;
    const field = String(error.path[2]);

    if (error.keyword === "required" && error.path.length === 3) {
      return field === "command" || field === "url"
        ? problem(missingFix(field))
        : undefined;
    }
    if (error.keyword === "additionalProperties" && error.path.length === 3) {
      return problem(extraFieldFix(field, branch));
    }
    if (error.keyword === "type") {
      const fix = typeFix(error.path, error.value);
      return fix === undefined ? undefined : problem(fix);
    }
    return undefined;
  },
};
