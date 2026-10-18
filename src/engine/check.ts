import type { ErrorObject } from "ajv/dist/2020.js";
import {
  rules as allRules,
  ruleSection,
  schemaViolation,
} from "../rules/index.ts";
import { selectServerType } from "../rules/mcp-server-type.ts";
import { declaredVersion } from "../rules/schema-version.ts";
import { fieldPath, formatCurrent, truncate } from "./format.ts";
import type { Locator, Position } from "./locate.ts";
import { createLocator, locateParseError } from "./locate.ts";
import type { CompiledSchemas, SchemaRegistry } from "./registry.ts";
import { SERVER_DEFS } from "./registry.ts";
import { specUrl } from "./spec.ts";
import { translators } from "./translate.ts";
import type {
  CheckResult,
  Claim,
  FileKind,
  Finding,
  ParseResult,
  PathPart,
  PluginInput,
  Problem,
  Rule,
  RuleContext,
  SchemaError,
  ServerType,
} from "./types.ts";
import { vendoredRegistry } from "./vendored.ts";

export interface ClaimRecord {
  error: SchemaError;
  /** Ids of the rules that claimed the error. A healthy error has exactly one. */
  claimedBy: string[];
}

export interface Inspection {
  result: CheckResult;
  claims: ClaimRecord[];
}

function parseJson(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The supported version a file declares, or null when it can't be read or isn't supported. */
function declaredVersionOf(
  text: string,
  kind: FileKind,
  supported: readonly string[],
): string | null {
  const parsed = parseJson(text);
  return parsed.ok ? declaredVersion(parsed.value, kind, supported) : null;
}

function appliesTo(rule: Rule, kind: FileKind): boolean {
  return rule.appliesTo === "both" || rule.appliesTo === kind;
}

/** Turns a JSON pointer into keys and indexes, using the data to tell the two apart. */
function walk(
  data: unknown,
  pointer: string,
): { path: PathPart[]; value: unknown } {
  const path: PathPart[] = [];
  let value = data;
  if (pointer === "") return { path, value };
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(value)) {
      path.push(Number(key));
      value = value[Number(key)];
    } else {
      path.push(key);
      value = isObject(value) ? value[key] : undefined;
    }
  }
  return { path, value };
}

interface Scope {
  data: unknown;
  pathPrefix: PathPart[];
  schemaPrefix: string;
  server?: SchemaError["server"];
}

function normalize(error: ErrorObject, scope: Scope): SchemaError | null {
  // `propertyNames` repeats the error of the forbidden key, which is reported on its own.
  if (error.keyword === "propertyNames") return null;
  const where = walk(scope.data, error.instancePath);
  let path = where.path;
  let value = where.value;
  const params = error.params as Record<string, unknown>;
  if (error.keyword === "required") {
    path = [...path, String(params.missingProperty)];
    value = undefined;
  } else if (error.keyword === "additionalProperties") {
    const name = String(params.additionalProperty);
    path = [...path, name];
    value = isObject(where.value) ? where.value[name] : undefined;
  } else if (
    error.keyword === "not" &&
    typeof error.propertyName === "string"
  ) {
    path = [...path, error.propertyName];
    value = error.propertyName;
  }
  const schemaPath = `${scope.schemaPrefix}${error.schemaPath.slice(1)}`;
  const normalized: SchemaError = {
    keyword: error.keyword,
    path: [...scope.pathPrefix, ...path],
    schemaPath,
    params,
    value,
    parentSchema: error.parentSchema as Record<string, unknown> | undefined,
  };
  if (scope.server !== undefined) normalized.server = scope.server;
  return normalized;
}

function serverErrors(
  compiled: CompiledSchemas,
  document: unknown,
): SchemaError[] {
  if (!isObject(document) || !isObject(document.mcpServers)) return [];
  const errors: SchemaError[] = [];
  for (const [name, value] of Object.entries(document.mcpServers)) {
    const pathPrefix: PathPart[] = ["mcpServers", name];
    const branch = isObject(value) ? selectServerType(value) : null;
    const server = { name, value, branch };
    if (isObject(value) && branch === null) {
      // Nothing says which shape was meant, so the only problem to report is the missing `type`.
      errors.push({
        keyword: "oneOf",
        path: pathPrefix,
        schemaPath: "#/$defs/server/oneOf",
        params: {},
        value,
        parentSchema: undefined,
        server,
      });
      continue;
    }
    // A server that isn't an object is checked against the first shape, which reports its type.
    const shape: ServerType = branch ?? "stdio";
    const validate = compiled.servers[shape];
    validate(value);
    for (const error of validate.errors ?? []) {
      const normalized = normalize(error, {
        data: value,
        pathPrefix,
        schemaPrefix: `#/$defs/${SERVER_DEFS[shape]}`,
        server,
      });
      if (normalized !== null) errors.push(normalized);
    }
  }
  return errors;
}

function schemaErrors(
  kind: FileKind,
  compiled: CompiledSchemas,
  document: unknown,
): SchemaError[] {
  const validate = kind === "plugin" ? compiled.plugin : compiled.mcp;
  validate(document);
  const scope: Scope = { data: document, pathPrefix: [], schemaPrefix: "#" };
  const errors: SchemaError[] = [];
  for (const error of validate.errors ?? []) {
    // Errors inside one server entry are replaced by the ones from its own shape (see serverErrors).
    if (kind === "mcp" && error.instancePath.startsWith("/mcpServers/"))
      continue;
    const normalized = normalize(error, scope);
    if (normalized !== null) errors.push(normalized);
  }
  if (kind === "mcp") errors.push(...serverErrors(compiled, document));
  return errors;
}

function toFinding(
  rule: Rule,
  kind: FileKind,
  file: string,
  version: string,
  problem: Problem,
  position: Position | undefined,
): Finding {
  const finding: Finding = {
    rule: rule.id,
    level: rule.level,
    file,
    field: fieldPath(problem.path),
    current:
      problem.currentText === undefined
        ? formatCurrent(problem.current)
        : truncate(problem.currentText),
    fix: problem.fix,
    spec: specUrl(version, ruleSection(rule, kind)),
  };
  if (position !== undefined) finding.line = position.line;
  return finding;
}

function claimFor(
  error: SchemaError,
  ctx: RuleContext,
  rules: readonly Rule[],
): { rule: Rule; claim: Claim; by: string[] } {
  const claimed: { rule: Rule; claim: Claim }[] = [];
  for (const rule of rules) {
    if (rule.claim === undefined || !appliesTo(rule, ctx.kind)) continue;
    const claim = rule.claim(error, ctx);
    if (claim !== undefined) claimed.push({ rule, claim });
  }
  const first = claimed[0];
  if (first !== undefined)
    return { ...first, by: claimed.map((c) => c.rule.id) };
  const translate = translators[error.keyword];
  const translation = translate?.(error) ?? {
    path: error.path,
    current: error.value,
    fix: "use a value the specification allows",
  };
  return { rule: schemaViolation, claim: translation, by: [] };
}

function compareFindings(a: Finding, b: Finding): number {
  const keys: [string | number, string | number][] = [
    [a.file, b.file],
    [a.line ?? 0, b.line ?? 0],
    [a.rule, b.rule],
    [a.field, b.field],
  ];
  for (const [x, y] of keys) {
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function checkFile(
  kind: FileKind,
  entry: { path: string; text: string },
  registry: SchemaRegistry,
  rules: readonly Rule[],
  sibling: RuleContext["sibling"],
  out: Inspection,
): void {
  const parsed = parseJson(entry.text);
  const newest = registry.versions[0];
  if (newest === undefined)
    throw new Error("The schema registry has no versions");
  let locator: Locator | undefined;
  const emit = (rule: Rule, version: string, problem: Problem): void => {
    let position: Position | undefined;
    if (!parsed.ok) {
      position = locateParseError(entry.text, parsed.message);
    } else {
      locator ??= createLocator(entry.text);
      position = locator(problem.path);
    }
    out.result.findings.push(
      toFinding(rule, kind, entry.path, version, problem, position),
    );
  };
  const base: RuleContext = {
    kind,
    file: entry.path,
    text: entry.text,
    parsed,
    specVersion: null,
    supportedVersions: registry.versions,
    ...(sibling === undefined ? {} : { sibling }),
  };

  for (const gate of rules.filter(
    (rule) => rule.gate && appliesTo(rule, kind),
  )) {
    const problems = gate.check(base);
    if (problems.length > 0) {
      for (const problem of problems) emit(gate, newest, problem);
      out.result.files.push({ file: entry.path, kind, specVersion: null });
      return;
    }
  }

  const version = parsed.ok
    ? declaredVersion(parsed.value, kind, registry.versions)
    : null;
  const compiled = version === null ? undefined : registry.get(version);
  if (version === null || compiled === undefined || !parsed.ok) {
    throw new Error("A file passed the gates without a supported version");
  }
  out.result.files.push({ file: entry.path, kind, specVersion: version });
  const ctx: RuleContext = { ...base, specVersion: version };

  for (const error of schemaErrors(kind, compiled, parsed.value)) {
    const { rule, claim, by } = claimFor(error, ctx, rules);
    out.claims.push({ error, claimedBy: by });
    if (claim !== "drop") emit(rule, version, claim);
  }

  for (const rule of rules) {
    if (rule.gate || !appliesTo(rule, kind)) continue;
    for (const problem of rule.check(ctx)) emit(rule, version, problem);
  }
}

/** Like `check`, and also says which rule claimed each schema error. Used by tests. */
export function inspect(
  input: PluginInput,
  registry: SchemaRegistry = vendoredRegistry(),
  rules: readonly Rule[] = allRules,
): Inspection {
  const out: Inspection = { result: { findings: [], files: [] }, claims: [] };
  if (input.plugin !== undefined)
    checkFile("plugin", input.plugin, registry, rules, undefined, out);
  if (input.mcp !== undefined) {
    const sibling = {
      present: input.plugin !== undefined,
      specVersion:
        input.plugin === undefined
          ? null
          : declaredVersionOf(input.plugin.text, "plugin", registry.versions),
    };
    checkFile("mcp", input.mcp, registry, rules, sibling, out);
  }
  out.result.findings.sort(compareFindings);
  return out;
}

/** Pure: the same input always gives the same findings. No filesystem, environment, network or clock. */
export function check(
  input: PluginInput,
  registry?: SchemaRegistry,
  rules?: readonly Rule[],
): CheckResult {
  return inspect(input, registry, rules).result;
}
