import type { ConfigError } from "../discover/discover.ts";
import type { FileKind, Finding } from "../engine/types.ts";
import type { FileStatus, RunResult } from "./types.ts";

export interface Report {
  reportVersion: 1;
  action: { name: string; version: string };
  valid: boolean;
  counts: { error: number; warning: number; notice: number };
  files: {
    file: string;
    kind: FileKind;
    specVersion: string | null;
    status: FileStatus;
  }[];
  findings: Finding[];
  configErrors: ConfigError[];
}

export function countLevels(findings: readonly Finding[]): Report["counts"] {
  return {
    error: findings.filter((f) => f.level === "error").length,
    warning: findings.filter((f) => f.level === "warning").length,
    notice: findings.filter((f) => f.level === "notice").length,
  };
}

/** `valid` is true when no finding is an error and the workflow's own configuration is fine. */
export function isValid(result: RunResult): boolean {
  return (
    result.configErrors.length === 0 &&
    result.findings.every((f) => f.level !== "error")
  );
}

/** The JSON report: every finding as data, for scripts and agents. Documented in docs/report.md. */
export function buildReport(result: RunResult, version: string): Report {
  return {
    reportVersion: 1,
    action: { name: "agent-plugins-validate", version },
    valid: isValid(result),
    counts: countLevels(result.findings),
    files: result.files.map((f) => ({
      file: f.file,
      kind: f.kind,
      specVersion: f.specVersion,
      status: f.status,
    })),
    findings: result.findings.map((f) => ({
      rule: f.rule,
      level: f.level,
      file: f.file,
      field: f.field,
      current: f.current,
      fix: f.fix,
      spec: f.spec,
      ...(f.line === undefined ? {} : { line: f.line }),
    })),
    configErrors: result.configErrors,
  };
}

/** A step id made safe to use as a folder name. */
export function safeStepName(action: string): string {
  const safe = action.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
  return safe === "" || /^_*$/.test(safe) ? "step" : safe;
}
