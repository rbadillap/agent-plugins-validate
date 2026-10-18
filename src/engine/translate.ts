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

/**
 * What each pattern in the vendored schemas asks for, in words. A test requires an entry for every
 * pattern in every vendored schema, so a new spec version can't print a raw regular expression.
 */
export const PATTERN_WORDS: Readonly<Record<string, string>> = {
  "^(?!.*(?:--|\\.\\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$":
    'contains only lowercase letters, digits, hyphens and periods, starts and ends with a letter or digit, and has no "--" or ".."',
  "^(?:\\./|\\$\\{PLUGIN_ROOT\\}(?:/|$)|\\$\\{PLUGIN_DATA\\}(?:/|$))":
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the spec's placeholders, written as text
    'starts with "./", "${PLUGIN_ROOT}" or "${PLUGIN_DATA}"',
};

function patternWords(pattern: unknown): string {
  return (
    PATTERN_WORDS[String(pattern)] ?? `matches the pattern ${String(pattern)}`
  );
}

/** What a valid value looks like, for a property that is missing. */
function describeValue(schema: unknown): string {
  if (typeof schema !== "object" || schema === null) return "a valid value";
  const s = schema as {
    const?: unknown;
    type?: unknown;
    minLength?: unknown;
    pattern?: unknown;
  };
  if ("const" in s) return quote(s.const);
  let noun: string;
  switch (s.type) {
    case "string":
      noun = Number(s.minLength) >= 1 ? "a non-empty string" : "a string";
      break;
    case "array":
      noun = "an array";
      break;
    case "boolean":
      noun = "a boolean";
      break;
    case "number":
    case "integer":
      noun = "a number";
      break;
    case "object":
      noun = "an object";
      break;
    default:
      noun = "a valid value";
  }
  return s.pattern === undefined
    ? noun
    : `${noun} that ${patternWords(s.pattern)}`;
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
    const value = describeValue(properties?.[name]);
    // A constant is written out; anything else is described.
    const joiner = value.startsWith('"') ? ": " : " as ";
    return same(error, `add ${quote(name)}${joiner}${value}`);
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
      `use a value that ${patternWords(error.params.pattern)}`,
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
