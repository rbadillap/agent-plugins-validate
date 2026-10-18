import type { Claim, Problem, Rule, SchemaError } from "../engine/types.ts";

const MAX_LENGTH = 64;

function trimEnds(name: string): string {
  return name.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

/**
 * The closest valid name: lowercase, every run of characters outside a-z, 0-9, "." and "-" turned
 * into "-", "--" and ".." collapsed, non-alphanumerics trimmed from both ends, cut to 64 characters.
 * Null when nothing is left.
 */
export function suggestName(name: string): string | null {
  let suggestion = name.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
  suggestion = suggestion.replace(/-{2,}/g, "-").replace(/\.{2,}/g, ".");
  suggestion = trimEnds(suggestion);
  suggestion = trimEnds(suggestion.slice(0, MAX_LENGTH));
  return suggestion === "" ? null : suggestion;
}

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
    const suggestion = suggestName(name);
    return {
      path: ["name"],
      current: name,
      fix:
        suggestion === null
          ? 'use a name like "my-plugin"'
          : `use ${JSON.stringify(suggestion)}`,
    };
  },
};
