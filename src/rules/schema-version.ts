import type { FileKind, Problem, Rule, RuleContext } from "../engine/types.ts";

const CANONICAL =
  /^https:\/\/agent-plugins\.org\/schemas\/([^/]+)\/(?:plugin|mcp)\.schema\.json$/;

// The shape of a schema identifier. A value of this shape holds nothing but a version, so it may be
// shown; any other value is described.
const SCHEMA_SHAPE =
  /^https?:\/\/agent-plugins\.org\/schemas\/\d+\.\d+\.\d+\/(?:plugin|mcp)\.schema\.json$/;

export function canonicalSchema(version: string, kind: FileKind): string {
  return `https://agent-plugins.org/schemas/${version}/${kind}.schema.json`;
}

/** The version a file declares in `$schema`, when it is canonical for this kind of file and supported. */
export function declaredVersion(
  value: unknown,
  kind: FileKind,
  supported: readonly string[],
): string | null {
  if (typeof value !== "object" || value === null) return null;
  const schema = (value as { $schema?: unknown }).$schema;
  return (
    supported.find((version) => schema === canonicalSchema(version, kind)) ??
    null
  );
}

function fixFor(
  declared: unknown,
  kind: FileKind,
  supported: readonly string[],
): string {
  const latest = supported[0];
  if (latest === undefined) return "use a supported $schema";
  if (declared === undefined) {
    return `add "$schema": "${canonicalSchema(latest, kind)}"`;
  }
  const match = CANONICAL.exec(
    typeof declared === "string"
      ? declared.replace(/^http:\/\//, "https://")
      : "",
  );
  const version = match?.[1];
  if (version !== undefined && supported.includes(version)) {
    return `use "${canonicalSchema(version, kind)}"`;
  }
  if (version !== undefined) {
    return `use "${canonicalSchema(latest, kind)}"; this Action supports Agent Plugins ${supported.join(", ")}`;
  }
  return `use "${canonicalSchema(latest, kind)}"`;
}

export const schemaVersion: Rule = {
  id: "schema-version",
  level: "error",
  section: "5.2",
  sections: { mcp: "7.2.1" },
  effect:
    "Clients that follow the spec reject the plugin when they don't recognize this version.",
  effects: {
    mcp: "Clients that follow the spec turn off MCP for this plugin.",
  },
  appliesTo: "both",
  gate: true,
  check(ctx: RuleContext): Problem[] {
    if (!ctx.parsed.ok) return [];
    if (
      declaredVersion(ctx.parsed.value, ctx.kind, ctx.supportedVersions) !==
      null
    )
      return [];
    const declared = (ctx.parsed.value as { $schema?: unknown }).$schema;
    return [
      {
        path: ["$schema"],
        current: declared,
        ...(typeof declared === "string" && SCHEMA_SHAPE.test(declared)
          ? { currentText: JSON.stringify(declared) }
          : {}),
        fix: fixFor(declared, ctx.kind, ctx.supportedVersions),
      },
    ];
  },
};
