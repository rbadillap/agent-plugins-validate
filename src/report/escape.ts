// Escaping for the surfaces a finding is written to. Everything that comes from a repository (a
// path, a field, a value) goes through one of these before it reaches a surface.

/** Workflow-command data: `%`, CR and LF. */
export function escapeData(text: string): string {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Workflow-command properties: the same, plus `:` and `,`. */
export function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * Text as an inline Markdown code span. The fence is longer than any run of backticks in the text,
 * so nothing inside can end the span. Code spans don't render HTML, links or @mentions. A pipe
 * would end a table cell, and a newline would end the row, so they are replaced.
 */
export function codeSpan(text: string): string {
  const flat = text
    .replace(/\r\n|\r|\n|\u2028|\u2029/g, "↵")
    .replace(/\|/g, "\\|");
  const longest = Math.max(
    0,
    ...(flat.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  const pad =
    flat.startsWith("`") || flat.endsWith("`") || flat === "" ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

/** Plain text that is ours (not from a repository), made safe for Markdown anyway. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_{}[\]<>#+!|~]/g, "\\$&")
    .replace(/@/g, "&#64;")
    .replace(/\r\n|\r|\n/g, " ");
}

/**
 * A fix as Markdown: every double-quoted piece (an example value) becomes a code span, and the rest
 * is escaped.
 */
export function renderFix(fix: string): string {
  let out = "";
  let last = 0;
  for (const match of fix.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    out += escapeMarkdown(fix.slice(last, match.index));
    out += codeSpan(match[0]);
    last = match.index + match[0].length;
  }
  return out + escapeMarkdown(fix.slice(last));
}
