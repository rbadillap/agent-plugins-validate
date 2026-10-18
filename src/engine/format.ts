import type { PathPart } from "./types.ts";

const PLAIN_KEY = /^[A-Za-z0-9_$-]+$/;
const MAX_CURRENT = 80;

/** Object keys joined by `.`, array items as `[0]`, odd keys as `["a.b"]`, the whole document as `(root)`. */
export function fieldPath(path: readonly PathPart[]): string {
  if (path.length === 0) return "(root)";
  let out = "";
  for (const part of path) {
    if (typeof part === "number") {
      out += `[${part}]`;
    } else if (PLAIN_KEY.test(part)) {
      out += out === "" ? part : `.${part}`;
    } else {
      out += `[${JSON.stringify(part)}]`;
    }
  }
  return out;
}

/** The value as JSON, cut at 80 characters. A missing value is `(missing)`. */
export function formatCurrent(value: unknown): string {
  if (value === undefined) return "(missing)";
  const text = JSON.stringify(value);
  if (text === undefined) return "(missing)";
  return text.length > MAX_CURRENT ? `${text.slice(0, MAX_CURRENT)}…` : text;
}
