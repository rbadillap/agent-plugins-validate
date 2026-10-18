import type { Problem, Rule, SchemaError } from "../engine/types.ts";
import { quote } from "./util.ts";

/** Owns the `env` entries named like the variables the client sets itself. */
export const mcpEnvReserved: Rule = {
  id: "mcp-env-reserved",
  level: "error",
  section: "9.2",
  effect: "Clients that follow the spec skip this server until it's fixed.",
  appliesTo: "mcp",
  check(): Problem[] {
    return [];
  },
  claim(error: SchemaError): Problem | undefined {
    if (
      error.server === undefined ||
      error.keyword !== "not" ||
      error.path.length !== 4 ||
      error.path[2] !== "env"
    ) {
      return undefined;
    }
    return {
      path: error.path,
      current: error.value,
      fix: `remove ${quote(error.path[3])}; clients set it`,
    };
  },
};
