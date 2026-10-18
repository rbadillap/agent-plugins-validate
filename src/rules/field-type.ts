import type { Problem, Rule, SchemaError } from "../engine/types.ts";
import { quote } from "./util.ts";

const STRING_FIELDS = [
  "version",
  "description",
  "homepage",
  "repository",
  "license",
];
const AUTHOR_FIELDS = ["name", "email", "url"];

function stringFix(value: unknown): string {
  return typeof value === "number" || typeof value === "boolean"
    ? `use ${quote(String(value))}`
    : "use a string";
}

function keywordsFix(value: unknown): string {
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    if (items.length > 0) return `use [${items.map(quote).join(", ")}]`;
  }
  return 'use an array of strings, e.g. ["docs"]';
}

function authorFix(value: unknown): string {
  return typeof value === "string"
    ? `use {"name": ${quote(value)}}`
    : 'use an object with "name", "email" or "url"';
}

/** Which metadata field an error is about, and what the fix is. */
function fixFor(error: SchemaError): string | undefined {
  const [field, child] = error.path;
  if (typeof field !== "string") return undefined;
  if (error.keyword === "type") {
    if (error.path.length === 1) {
      if (STRING_FIELDS.includes(field)) return stringFix(error.value);
      if (field === "keywords") return keywordsFix(error.value);
      if (field === "author") return authorFix(error.value);
    }
    if (error.path.length === 2) {
      if (field === "keywords" && typeof child === "number") {
        return stringFix(error.value);
      }
      if (
        field === "author" &&
        typeof child === "string" &&
        AUTHOR_FIELDS.includes(child)
      ) {
        return stringFix(error.value);
      }
    }
  }
  if (
    error.keyword === "additionalProperties" &&
    field === "author" &&
    error.path.length === 2
  ) {
    return `remove ${quote(child)}`;
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
      : { path: error.path, current: error.value, fix };
  },
};
