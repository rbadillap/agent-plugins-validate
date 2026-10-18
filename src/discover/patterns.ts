// The `manifests` input: parsing and validating its lines. Pure: no filesystem.

export const MANIFEST_NAMES: readonly string[] = ["plugin.json", "mcp.json"];
export const DEFAULT_MANIFESTS = "plugin.json\nmcp.json";

export interface PatternLine {
  /** The 1-based line number in the input, as the author wrote it. */
  number: number;
  text: string;
}

/** The lines of the input that count: trimmed, without blank lines and `#` comments. */
export function parseLines(input: string): PatternLine[] {
  const lines: PatternLine[] = [];
  input.split(/\r?\n/).forEach((raw, index) => {
    const text = raw.trim();
    if (text !== "" && !text.startsWith("#")) {
      lines.push({ number: index + 1, text });
    }
  });
  return lines;
}

export function isDefaultInput(input: string): boolean {
  const lines = parseLines(input).map((line) => line.text);
  return lines.join("\n") === DEFAULT_MANIFESTS;
}

/** A glob segment (`*`, `?`, `[...]` and literals) as a regular expression. */
function segmentPattern(segment: string): RegExp {
  let source = "";
  for (let i = 0; i < segment.length; i++) {
    const c = segment.charAt(i);
    if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "[") {
      const end = segment.indexOf("]", i + 1);
      if (end === -1) {
        source += "\\[";
      } else {
        const body = segment.slice(i + 1, end);
        const negated = body.startsWith("^") || body.startsWith("!");
        const inner = (negated ? body.slice(1) : body).replace(
          /[\\\]^]/g,
          "\\$&",
        );
        source += `[${negated ? "^" : ""}${inner}]`;
        i = end;
      }
    } else {
      source += c.replace(/[.+^${}()|\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** True when the last segment of a pattern can match `plugin.json` or `mcp.json`. */
export function canMatchManifest(pattern: string): boolean {
  const last = pattern.split("/").pop() ?? "";
  if (last === "**") return true;
  const regex = segmentPattern(last);
  return MANIFEST_NAMES.some((name) => regex.test(name));
}

/**
 * True when a segment could match "." or ".." through a class or an escape: `[.][.]`, `.[.]`,
 * `[.].`. The textual check for ".." doesn't see those, and Node's glob returns "../" for them.
 * The plain "." segment (as in `./plugin.json`) is fine, and `*` and `**` never match a dot name.
 */
export function matchesDotSegment(text: string): boolean {
  return text.split("/").some((segment) => {
    if (segment === ".") return false;
    if (!segment.includes("[") && !segment.includes(".")) return false;
    const regex = segmentPattern(segment);
    return regex.test(".") || regex.test("..");
  });
}

/**
 * Why a line can't be used, or null when it is fine. Every check is on the text, before any
 * filesystem access. Anything that could expand into `..` is refused, not sanitized.
 */
export function rejectReason(text: string): string | null {
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text)) {
    return 'is an absolute path. Use a path relative to the repository root, e.g. "plugins/a/plugin.json".';
  }
  if (text.includes("..")) {
    return 'leaves the repository. Use a path inside it, e.g. "shared/plugin.json".';
  }
  if (matchesDotSegment(text)) {
    return 'could match "." or "..", which leaves the repository. Use plain folder names, e.g. "plugins/a/plugin.json".';
  }
  if (text.includes("\\")) {
    return 'uses a backslash. Separate folders with "/", e.g. "plugins/a/plugin.json".';
  }
  if (/[{}()!]/.test(text)) {
    return "uses { } ( ) or !, which are not supported. Use *, **, ? and [...] only.";
  }
  if (!canMatchManifest(text)) {
    return "can't match plugin.json or mcp.json. End the pattern with plugin.json, mcp.json or a pattern such as *.json.";
  }
  return null;
}
