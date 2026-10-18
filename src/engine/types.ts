export type Level = "error" | "warning" | "notice";

export type FileKind = "plugin" | "mcp";

export type PathPart = string | number;

export type ServerType = "stdio" | "streamable-http" | "sse";

export interface Finding {
  rule: string;
  level: Level;
  file: string;
  field: string;
  current: string;
  fix: string;
  spec: string;
  line?: number;
}

export interface PluginInput {
  root: string;
  plugin?: { path: string; text: string };
  mcp?: { path: string; text: string };
}

export interface CheckResult {
  findings: Finding[];
  files: { file: string; kind: FileKind; specVersion: string | null }[];
}

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/** A problem found by a rule. The engine turns it into a Finding. */
export interface Problem {
  path: PathPart[];
  /** The value as written. `undefined` means the value is missing. */
  current: unknown;
  /** Replaces the formatted `current` when the value can't be shown as JSON, e.g. a file that isn't JSON. */
  currentText?: string;
  fix: string;
  /** Overrides the rule's section, for a rule whose findings cite different sections. */
  section?: string;
}

/** A JSON Schema error, normalized so that `path` names the offending value itself. */
export interface SchemaError {
  keyword: string;
  /** Where the offending value is. For `required` this is the missing property. */
  path: PathPart[];
  /** Schema location relative to the schema document root, e.g. `#/$defs/stdioServer/required`. */
  schemaPath: string;
  params: Record<string, unknown>;
  /** The offending value, or `undefined` when it is missing. */
  value: unknown;
  /** The schema object that holds the failing keyword. */
  parentSchema: Record<string, unknown> | undefined;
  /** Set for errors found inside one entry of `mcpServers`. */
  server?: { name: string; value: unknown; branch: ServerType | null };
}

/** What a rule reports for a schema error it owns. `"drop"` owns the error and reports nothing for it. */
export type Claim = Problem | "drop";

export interface RuleContext {
  kind: FileKind;
  file: string;
  text: string;
  parsed: ParseResult;
  /** The declared spec version when this Action supports it, otherwise null. */
  specVersion: string | null;
  supportedVersions: readonly string[];
  /** For `mcp.json`: what is known about the `plugin.json` that goes with it. */
  sibling?: { present: boolean; specVersion: string | null };
}

export interface Rule {
  id: string;
  level: Level;
  /** Section id in the specification, e.g. "7.2.1". */
  section: string;
  /** Overrides `section` for one kind of file. */
  sections?: Partial<Record<FileKind, string>>;
  /** Plain-language consequence, shown by the reporters. */
  effect: string;
  /** Overrides `effect` for one kind of file. */
  effects?: Partial<Record<FileKind, string>>;
  appliesTo: FileKind | "both";
  /** A gate runs before the schema and stops the checks of that file when it finds a problem. */
  gate?: true;
  /** Semantic checks the schema can't express. */
  check(ctx: RuleContext): Problem[];
  /** Takes ownership of a schema error, and says what to report for it. */
  claim?(error: SchemaError, ctx: RuleContext): Claim | undefined;
}
