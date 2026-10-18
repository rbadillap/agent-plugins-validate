import type { Problem, Rule, SchemaError } from "../engine/types.ts";

/** Owns type errors of `extensions` itself and of the value of each namespace. */
export const extensionsType: Rule = {
  id: "extensions-type",
  level: "warning",
  section: "8.1",
  effect:
    "Clients that follow the spec report this field, ignore it and keep loading the plugin.",
  appliesTo: "plugin",
  check(): Problem[] {
    return [];
  },
  claim(error: SchemaError): Problem | undefined {
    if (error.keyword !== "type" || error.path[0] !== "extensions") {
      return undefined;
    }
    if (error.path.length === 1) {
      return {
        path: error.path,
        current: error.value,
        fix: 'use an object keyed by namespace, e.g. {"com.example.client": {}}',
      };
    }
    if (error.path.length === 2) {
      return {
        path: error.path,
        current: error.value,
        fix: "use an object, e.g. {}",
      };
    }
    return undefined;
  },
};
