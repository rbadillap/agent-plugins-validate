import path from "node:path";
import pkg from "../package.json" with { type: "json" };
import type { Context } from "./context.ts";
import type { Discovery } from "./discover/discover.ts";
import { discover as realDiscover } from "./discover/discover.ts";
import { check } from "./engine/check.ts";
import type { FileKind, Finding } from "./engine/types.ts";
import { annotation } from "./report/annotations.ts";
import { escapeData, escapeProperty } from "./report/escape.ts";
import type { Io } from "./report/io.ts";
import { outputBlock } from "./report/io.ts";
import {
  buildReport,
  countLevels,
  isValid,
  safeStepName,
} from "./report/report.ts";
import { ISSUES_OFF, renderSummary } from "./report/summary.ts";
import type { FileResult, RunResult } from "./report/types.ts";

export interface Deps {
  discover?: (options: {
    workspace: string;
    manifests: string;
  }) => Promise<Discovery>;
  io: Io;
}

const LEVEL_ORDER = { error: 0, warning: 1, notice: 2 } as const;

function compare(a: Finding, b: Finding): number {
  return (
    LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.rule.localeCompare(b.rule) ||
    a.field.localeCompare(b.field)
  );
}

/** Discovers the manifests and checks every plugin. */
async function evaluate(context: Context, deps: Deps): Promise<RunResult> {
  const discovery = await (deps.discover ?? realDiscover)({
    workspace: context.workspace,
    manifests: context.manifests,
  });
  const findings: Finding[] = [];
  const files: FileResult[] = [];
  for (const plugin of discovery.plugins) {
    const result = check(plugin);
    findings.push(...result.findings);
    for (const file of result.files) {
      const mine = result.findings.filter((f) => f.file === file.file);
      files.push({
        ...file,
        status: mine.some((f) => f.level === "error")
          ? "fail"
          : mine.some((f) => f.level === "warning")
            ? "warn"
            : "pass",
      });
    }
  }
  findings.sort(compare);
  return {
    files,
    findings,
    configErrors: discovery.configErrors,
    warnings: discovery.warnings,
  };
}

/** The line about issues, or null where the summary doesn't mention them (pull requests). */
export function issuesLine(context: Context): string | null {
  if (
    context.eventName === "pull_request" ||
    context.eventName === "pull_request_target"
  ) {
    return null;
  }
  if (!context.openIssues) return ISSUES_OFF;
  const branch = context.event.defaultBranch;
  const onDefault =
    branch !== undefined && context.ref === `refs/heads/${branch}`;
  if (!onDefault) {
    return branch === undefined
      ? "Issues: on, for the default branch only."
      : `Issues: on, for ${branch} only.`;
  }
  return "Issues: on.";
}

function print(deps: Deps, line: string): void {
  deps.io.stdout(`${line}\n`);
}

/** Runs the Action once. Returns the exit code: non-zero only for errors and bad configuration. */
export async function run(context: Context, deps: Deps): Promise<number> {
  const result = await evaluate(context, deps);
  const kinds = new Map<string, FileKind>(
    result.files.map((f) => [f.file, f.kind]),
  );

  for (const error of result.configErrors) {
    print(
      deps,
      `::error title=${escapeProperty(error.id)}::${escapeData(error.message)}`,
    );
  }
  for (const warning of result.warnings) {
    print(deps, `::warning title=skipped::${escapeData(warning)}`);
  }
  for (const finding of result.findings) {
    print(deps, annotation(finding, kinds.get(finding.file) ?? "plugin"));
  }

  const report = buildReport(result, pkg.version);
  const reportFile = path.join(
    context.runnerTemp,
    "agent-plugins-validate",
    safeStepName(context.action),
    "report.json",
  );
  if (context.runnerTemp !== "") {
    deps.io.write(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (context.summaryFile !== undefined) {
    deps.io.append(
      context.summaryFile,
      renderSummary(result, { issuesLine: issuesLine(context) }),
    );
  }

  if (context.outputFile !== undefined) {
    const delimiter = deps.io.random();
    deps.io.append(
      context.outputFile,
      outputBlock("valid", String(isValid(result)), delimiter) +
        outputBlock("findings", String(result.findings.length), delimiter) +
        outputBlock("report", reportFile, delimiter),
    );
  }

  const errors = countLevels(result.findings).error;
  if (errors > 0) {
    print(
      deps,
      `::error title=agent-plugins-validate::${errors === 1 ? "1 error" : `${errors} errors`} in Agent Plugins manifests.`,
    );
  }
  return errors > 0 || result.configErrors.length > 0 ? 1 : 0;
}
