import type { Problem, Rule, RuleContext } from "../engine/types.ts";
import { isObject } from "./util.ts";

// The regular expression published in the Semantic Versioning 2.0.0 specification.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

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
    return [
      {
        path: ["version"],
        current: version,
        fix: 'use a Semantic Versioning version, MAJOR.MINOR.PATCH, e.g. "1.0.0"',
      },
    ];
  },
};
