import type { Claim, Problem, Rule, SchemaError } from "../engine/types.ts";
import { shownName } from "./util.ts";

/** Owns the character, start/end, repetition and length rules of a non-empty `name`. */
export const pluginName: Rule = {
  id: "plugin-name",
  level: "error",
  section: "5.5",
  effect:
    "Clients that follow the spec reject the plugin and load none of its components.",
  appliesTo: "plugin",
  check(): Problem[] {
    return [];
  },
  claim(error: SchemaError): Claim | undefined {
    if (error.path.length !== 1 || error.path[0] !== "name") return undefined;
    const name = error.value;
    if (typeof name !== "string" || name === "") return undefined;
    if (error.keyword !== "pattern" && error.keyword !== "maxLength") {
      return undefined;
    }
    // A name that breaks both the pattern and the length gets one finding, from the pattern error.
    const pattern = error.parentSchema?.pattern;
    if (
      error.keyword === "maxLength" &&
      typeof pattern === "string" &&
      !new RegExp(pattern, "u").test(name)
    ) {
      return "drop";
    }
    return {
      path: ["name"],
      current: name,
      ...shownName(name),
      fix: 'use lowercase kebab-case of 1–64 characters (a-z, 0-9, "-" and "."), starting and ending with a letter or digit, e.g. "my-plugin"',
    };
  },
};
