import type { PathPart } from "./types.ts";

// A key is written in a field path only when it is plain: it can hold no more than a name. Any other
// key is written as "[…]", and `line` says where it is.
const PLAIN_KEY = /^[A-Za-z0-9_.$-]{1,64}$/;
// A name (a plugin, a namespace, a server, a header, a variable, a transport) may be shown in
// `current` when it is plain. The text of a value (a url, a command, an argument) never is.
const PLAIN_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_CURRENT = 80;

/** Object keys joined by `.`, array items as `[0]`, keys that are not plain as `[…]`, the whole document as `(root)`. */
export function fieldPath(path: readonly PathPart[]): string {
  if (path.length === 0) return "(root)";
  let out = "";
  for (const part of path) {
    if (typeof part === "number") {
      out += `[${part}]`;
    } else if (PLAIN_KEY.test(part)) {
      out += out === "" ? part : `.${part}`;
    } else {
      out += "[…]";
    }
  }
  return out;
}

/** Cuts text at 80 characters, without splitting a surrogate pair. */
export function truncate(text: string): string {
  if (text.length <= MAX_CURRENT) return text;
  let cut = text.slice(0, MAX_CURRENT);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * What a finding says about the value it is about. Free text (a string, an array, an object) is
 * described, never repeated: its content can hold anything, a secret included. Values that can't
 * hold free text (a number, a boolean, null) are written as they are.
 */
export function describeValue(value: unknown): string {
  if (value === undefined) return "(missing)";
  if (typeof value === "string") return `string (${value.length} chars)`;
  if (Array.isArray(value)) return `array (${value.length} items)`;
  if (typeof value === "object" && value !== null) {
    return `object (${Object.keys(value).length} keys)`;
  }
  return JSON.stringify(value) ?? "(missing)";
}

/** True when a string is a plain name: short, and made of letters, digits, `_`, `.` and `-`. */
export function isPlainName(value: unknown): value is string {
  return typeof value === "string" && PLAIN_NAME.test(value);
}
