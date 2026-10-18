import type { Problem, Rule, SchemaError } from "../engine/types.ts";
import { shownName } from "./util.ts";

const STRING_FIELDS = [
  "version",
  "description",
  "homepage",
  "repository",
  "license",
];
const AUTHOR_FIELDS = ["name", "email", "url"];

const STRING = "use a string";
const KEYWORDS = 'use an array of strings, e.g. ["docs", "search"]';
const AUTHOR =
  'use an object with "name", "email" or "url" strings, e.g. {"name": "Jane"}';

/** Which metadata field an error is about, and what the fix is. */
function fixFor(error: SchemaError): string | undefined {
  const [field, child] = error.path;
  if (typeof field !== "string") return undefined;
  if (error.keyword === "type") {
    if (error.path.length === 1) {
      if (field === "version") return 'use a string, e.g. "1.0.0"';
      if (STRING_FIELDS.includes(field)) return STRING;
      if (field === "keywords") return KEYWORDS;
      if (field === "author") return AUTHOR;
    }
    if (error.path.length === 2) {
      if (field === "keywords" && typeof child === "number") {
        return STRING;
      }
      if (
        field === "author" &&
        typeof child === "string" &&
        AUTHOR_FIELDS.includes(child)
      ) {
        return STRING;
      }
    }
  }
  if (
    error.keyword === "additionalProperties" &&
    field === "author" &&
    error.path.length === 2
  ) {
    return 'remove this field; an author has only "name", "email" and "url"';
  }
  return undefined;
}

/** Owns type errors in the metadata fields, and fields in `author` that the spec doesn't define. */
export const fieldType: Rule = {
  id: "field-type",
  level: "error",
  section: "5.4",
  effect:
    "Clients that follow the spec reject the plugin and load none of its components.",
  appliesTo: "plugin",
  check(): Problem[] {
    return [];
  },
  claim(error: SchemaError): Problem | undefined {
    const fix = fixFor(error);
    return fix === undefined
      ? undefined
      : {
          path: error.path,
          current: error.value,
          // Keywords are names, so one that is plain is shown.
          ...(error.path[0] === "keywords" ? shownName(error.value) : {}),
          fix,
        };
  },
};
