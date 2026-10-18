import type { Rule } from "../engine/types.ts";
import { jsonSyntax } from "./json-syntax.ts";
import { mcpServerType } from "./mcp-server-type.ts";
import { schemaVersion } from "./schema-version.ts";

/** Every rule. Gates come first, in the order they run. */
export const rules: readonly Rule[] = [
  jsonSyntax,
  schemaVersion,
  mcpServerType,
];
