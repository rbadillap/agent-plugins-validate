import type { Problem, Rule, SchemaError } from "../engine/types.ts";
import { quote } from "./util.ts";

/** Owns top-level fields of `plugin.json` that the spec doesn't define. */
export const unknownField: Rule = {
  id: "unknown-field",
  level: "warning",
  section: "5.2",
  effect:
    "Clients that follow the spec report this field, ignore it and keep loading the plugin.",
  appliesTo: "plugin",
  check(): Problem[] {
    return [];
  },
  claim(error: SchemaError): Problem | undefined {
    if (error.keyword !== "additionalProperties" || error.path.length !== 1) {
      return undefined;
    }
    return {
      path: error.path,
      current: error.value,
      fix: `remove ${quote(error.path[0])}; client data belongs under "extensions"`,
    };
  },
};
