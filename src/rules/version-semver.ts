import type { Problem, Rule, RuleContext } from "../engine/types.ts";
import { isObject } from "./util.ts";

// The regular expression published in the Semantic Versioning 2.0.0 specification.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Strips a leading "v" and pads "1" or "1.2" with ".0", when that makes a valid version. */
export function suggestVersion(version: string): string | null {
  const candidate = version.trim().replace(/^v/i, "");
  const padded = /^\d+(?:\.\d+)?$/.test(candidate)
    ? `${candidate}${".0".repeat(candidate.includes(".") ? 1 : 2)}`
    : candidate;
  return SEMVER.test(padded) && padded !== version ? padded : null;
}

export const versionSemver: Rule = {
  id: "version-semver",
  level: "notice",
  section: "10.2",
  effect:
    "The spec recommends Semantic Versioning. Clients use the version for update checks and cache freshness.",
  appliesTo: "plugin",
  check(ctx: RuleContext): Problem[] {
    if (!ctx.parsed.ok || !isObject(ctx.parsed.value)) return [];
    const version = ctx.parsed.value.version;
    // A version that isn't a string is a type error, reported by field-type.
    if (typeof version !== "string" || SEMVER.test(version)) return [];
    const suggestion = suggestVersion(version);
    return [
      {
        path: ["version"],
        current: version,
        fix:
          suggestion === null
            ? 'use a version like "1.0.0"'
            : `use ${JSON.stringify(suggestion)}`,
      },
    ];
  },
};
