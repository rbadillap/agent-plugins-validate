/**
 * A key that looks like a pasted `NAME=value` or `Name: value`. `separator` is the first "=" or ":"
 * in it. `name` is the part before it, when that part matches `plain`: only then is it safe to
 * repeat. The part after the separator is never returned, because it may be a secret.
 */
export function pastedPair(
  key: string,
  plain: RegExp,
): { separator: string; name?: string } | null {
  const index = key.search(/[=:]/);
  if (index === -1) return null;
  const separator = key.charAt(index);
  const name = key.slice(0, index).trim();
  return plain.test(name) ? { separator, name } : { separator };
}

/** `current` for such a key: its size and the separator, never its text. */
export function pastedKeyText(key: string, separator: string): string {
  return `name (${key.length} chars) with ${JSON.stringify(separator)}`;
}
