import type { Claim, Problem, Rule, SchemaError } from "../engine/types.ts";

/** Owns every error about the presence, type and emptiness of `name`. */
export const requiredFields: Rule = {
  id: "required-fields",
  level: "error",
  section: "5.3",
  effect:
    "Clients that follow the spec reject the plugin and load none of its components.",
  appliesTo: "plugin",
  check(): Problem[] {
    return [];
  },
  claim(error: SchemaError): Claim | undefined {
    if (error.path.length !== 1 || error.path[0] !== "name") return undefined;
    if (error.keyword === "pattern") {
      // An empty name also fails the pattern. The empty name is reported once, as a required field.
      return error.value === "" ? "drop" : undefined;
    }
    if (!["required", "type", "minLength"].includes(error.keyword)) {
      return undefined;
    }
    return {
      path: ["name"],
      current: error.value,
      fix:
        error.keyword === "required"
          ? 'add "name": "my-plugin"'
          : 'use a name of 1–64 characters, e.g. "my-plugin"',
    };
  },
};
