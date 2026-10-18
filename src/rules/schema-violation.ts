import type { Rule } from "../engine/types.ts";

/**
 * Reported for a schema error that no other rule claims, so a manifest that breaks the schema never
 * passes silently. The `fix` still comes from the keyword's translator.
 *
 * This is a stable, public rule id like every other. Tests require every error from the fixtures of
 * the other rules to be claimed by one of them, so a `schema-violation` for a common mistake is a bug.
 */
export const schemaViolation: Rule = {
  id: "schema-violation",
  level: "error",
  section: "5.2",
  sections: { mcp: "7.2.1" },
  effect: "Clients that follow the spec reject the plugin or skip the entry.",
  effects: {
    mcp: "Clients that follow the spec turn off MCP or skip the server.",
  },
  appliesTo: "both",
  check: () => [],
};
