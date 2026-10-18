import type { PathPart, SchemaError } from "./types.ts";

/** What to report for a schema error when no rule has more to say about it. */
export interface Translation {
  path: PathPart[];
  current: unknown;
  fix: string;
}

type Translator = (error: SchemaError) => Translation;

/**
 * Keywords that structure a schema but never fail on their own. A test walks the vendored schemas
 * and requires every other keyword to have a translator.
 */
export const STRUCTURAL_KEYWORDS: readonly string[] = [
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "properties",
  "items",
  "title",
  "description",
];

function quote(value: unknown): string {
  return JSON.stringify(value);
}

function joinOr(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function list(values: readonly unknown[]): string {
  return joinOr(values.map(quote));
}

function article(noun: string): string {
  return /^[aeiou]/.test(noun) ? `an ${noun}` : `a ${noun}`;
}

function typeFix(expected: readonly string[], value: unknown): string {
  if (
    expected.includes("string") &&
    (typeof value === "number" || typeof value === "boolean")
  ) {
    return `use ${quote(String(value))}`;
  }
  return `use ${joinOr(expected.map(article))}`;
}

function placeholder(schema: unknown): string {
  if (typeof schema !== "object" || schema === null) return "{}";
  const s = schema as { const?: unknown; type?: unknown };
  if ("const" in s) return quote(s.const);
  switch (s.type) {
    case "string":
      return '""';
    case "array":
      return "[]";
    case "boolean":
      return "false";
    case "number":
    case "integer":
      return "0";
    default:
      return "{}";
  }
}

function lastKey(error: SchemaError): string {
  const last = error.path[error.path.length - 1];
  return String(last ?? "");
}

const same = (error: SchemaError, fix: string): Translation => ({
  path: error.path,
  current: error.value,
  fix,
});

export const translators: Record<string, Translator> = {
  type(error) {
    const expected = [error.params.type].flat().map(String);
    return same(error, typeFix(expected, error.value));
  },
  const(error) {
    return same(error, `use ${quote(error.params.allowedValue)}`);
  },
  enum(error) {
    const allowed = Array.isArray(error.params.allowedValues)
      ? error.params.allowedValues
      : [];
    return same(error, `use ${list(allowed)}`);
  },
  required(error) {
    const properties = error.parentSchema?.properties as
      | Record<string, unknown>
      | undefined;
    const name = lastKey(error);
    return same(
      error,
      `add ${quote(name)}: ${placeholder(properties?.[name])}`,
    );
  },
  additionalProperties(error) {
    return same(error, `remove ${quote(lastKey(error))}`);
  },
  minLength(error) {
    const limit = Number(error.params.limit);
    return same(
      error,
      limit <= 1
        ? "use a non-empty string"
        : `use at least ${limit} characters`,
    );
  },
  maxLength(error) {
    return same(error, `use at most ${Number(error.params.limit)} characters`);
  },
  pattern(error) {
    return same(
      error,
      `use a value that matches ${String(error.params.pattern)}`,
    );
  },
  propertyNames(error) {
    return same(error, `remove ${quote(lastKey(error))}`);
  },
  not(error) {
    // `not` fails inside `propertyNames` when a key is forbidden.
    if (
      typeof error.value === "string" &&
      error.schemaPath.includes("/propertyNames/")
    ) {
      return same(error, `remove ${quote(error.value)}`);
    }
    return same(error, "use a different value");
  },
  oneOf(error) {
    return same(error, "use one of the shapes the specification allows");
  },
};
