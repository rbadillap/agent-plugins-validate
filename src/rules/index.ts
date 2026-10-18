import type { FileKind, Rule } from "../engine/types.ts";
import { extensionsNamespace } from "./extensions-namespace.ts";
import { extensionsType } from "./extensions-type.ts";
import { fieldType } from "./field-type.ts";
import { jsonSyntax } from "./json-syntax.ts";
import { mcpCommand } from "./mcp-command.ts";
import { mcpCwd } from "./mcp-cwd.ts";
import { mcpEnvName } from "./mcp-env-name.ts";
import { mcpEnvReserved } from "./mcp-env-reserved.ts";
import { mcpHeaders } from "./mcp-headers.ts";
import { mcpServerFields } from "./mcp-server-fields.ts";
import { mcpServerType } from "./mcp-server-type.ts";
import { mcpTopLevel } from "./mcp-top-level.ts";
import { mcpUrl } from "./mcp-url.ts";
import { mcpVersionMatch } from "./mcp-version-match.ts";
import { pluginManifestMissing } from "./plugin-manifest-missing.ts";
import { pluginName } from "./plugin-name.ts";
import { requiredFields } from "./required-fields.ts";
import { schemaVersion } from "./schema-version.ts";
import { schemaViolation } from "./schema-violation.ts";
import { unknownField } from "./unknown-field.ts";
import { versionSemver } from "./version-semver.ts";

export { schemaViolation };

/** Every rule. Gates come first, in the order they run. `schema-violation` comes last. */
export const rules: readonly Rule[] = [
  jsonSyntax,
  schemaVersion,
  requiredFields,
  pluginName,
  fieldType,
  unknownField,
  extensionsType,
  extensionsNamespace,
  versionSemver,
  mcpTopLevel,
  mcpVersionMatch,
  pluginManifestMissing,
  mcpServerType,
  mcpServerFields,
  mcpEnvReserved,
  mcpEnvName,
  mcpCommand,
  mcpCwd,
  mcpUrl,
  mcpHeaders,
  schemaViolation,
];

/** A rule by its id, for reporters. Includes `schema-violation`. */
export function ruleById(id: string): Rule | undefined {
  return rules.find((rule) => rule.id === id);
}

export function ruleSection(rule: Rule, kind: FileKind): string {
  return rule.sections?.[kind] ?? rule.section;
}

export function ruleEffect(rule: Rule, kind: FileKind): string {
  return rule.effects?.[kind] ?? rule.effect;
}
