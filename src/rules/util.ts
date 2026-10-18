import { isPlainName } from "../engine/format.ts";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function quote(value: unknown): string {
  return JSON.stringify(value);
}

/** `currentText` for a name field: the name itself when it is plain, otherwise nothing (described). */
export function shownName(value: unknown): { currentText?: string } {
  return isPlainName(value) ? { currentText: JSON.stringify(value) } : {};
}
