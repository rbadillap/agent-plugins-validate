import path from "node:path";
import pkg from "../package.json" with { type: "json" };
import type { Context } from "./context.ts";
import type { Discovery } from "./discover/discover.ts";
import { discover as realDiscover } from "./discover/discover.ts";
import { check } from "./engine/check.ts";
import type {
  FileKind,
  Finding,
  PathPart,
  PluginInput,
} from "./engine/types.ts";
import type { ApiClient, ClientOptions } from "./github/api.ts";
import { createClient as realCreateClient } from "./github/api.ts";
import type { IssueLink, IssuesOutcome } from "./github/issues.ts";
import {
  failedOutcome,
  issueMode,
  issuesSummaryLine,
  linkMarkdown,
  trackIssues,
} from "./github/issues.ts";
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
  createClient?: (options: ClientOptions) => ApiClient;
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

interface Evaluation {
  result: RunResult;
  /** For each finding of `result`, the keys and indexes of its field. Never printed. */
  paths: PathPart[][];
  plugins: PluginInput[];
}

/** Discovers the manifests and checks every plugin. */
async function evaluate(context: Context, deps: Deps): Promise<Evaluation> {
  const discovery = await (deps.discover ?? realDiscover)({
    workspace: context.workspace,
    manifests: context.manifests,
  });
  const found: { finding: Finding; path: PathPart[] }[] = [];
  const files: FileResult[] = [];
  for (const plugin of discovery.plugins) {
    const result = check(plugin);
    result.findings.forEach((finding, index) => {
      found.push({ finding, path: result.paths[index] ?? [] });
    });
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
  found.sort((a, b) => compare(a.finding, b.finding));
  return {
    result: {
      files,
      findings: found.map((f) => f.finding),
      configErrors: discovery.configErrors,
      warnings: discovery.warnings,
    },
    paths: found.map((f) => f.path),
    plugins: discovery.plugins,
  };
}

/** The line about issues, or null where the summary doesn't mention them (pull requests). */
export function issuesLine(
  context: Context,
  outcome: IssuesOutcome | undefined,
): string | null {
  if (
    context.eventName === "pull_request" ||
    context.eventName === "pull_request_target"
  ) {
    return null;
  }
  if (!context.openIssues) return ISSUES_OFF;
  if (outcome === undefined) {
    const branch = context.event.defaultBranch;
    return branch === undefined
      ? "Issues: on, for the default branch only."
      : `Issues: on, for ${branch} only.`;
  }
  return outcome.errorNote ?? issuesSummaryLine(outcome);
}

/** Links and notes to put under the issues line. */
function issueNotes(outcome: IssuesOutcome | undefined): string[] {
  if (outcome === undefined) return [];
  const lines: string[] = [];
  const groups: [string, IssueLink[]][] = [
    ["Opened", outcome.opened],
    ["Reopened", outcome.reopened],
    ["Updated", outcome.updated],
    ["Closed", outcome.closed],
  ];
  for (const [label, list] of groups) {
    if (list.length > 0)
      lines.push(`${label}: ${list.map(linkMarkdown).join(", ")}`);
  }
  lines.push(...outcome.notes);
  return lines;
}

function print(deps: Deps, line: string): void {
  deps.io.stdout(`${line}\n`);
}

/** Runs the Action once. Returns the exit code: non-zero only for errors and bad configuration. */
export async function run(context: Context, deps: Deps): Promise<number> {
  const { result, paths, plugins } = await evaluate(context, deps);
  const kinds = new Map<string, FileKind>(
    result.files.map((f) => [f.file, f.kind]),
  );

  // Issues: only on the events and branches that allow it. Otherwise nothing here runs, and the API
  // module is never called.
  let outcome: IssuesOutcome | undefined;
  const mode = context.openIssues
    ? issueMode({
        eventName: context.eventName,
        ref: context.ref,
        defaultBranch: context.event.defaultBranch,
        forced: context.event.forced,
      })
    : "none";
  // The token is masked before anything else is printed, so it can't appear in a log unmasked.
  if (mode !== "none" && context.token !== "") {
    print(deps, `::add-mask::${escapeData(context.token)}`);
  }

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

  if (mode !== "none") {
    // Nothing about issues may cost the run its report, summary and outputs.
    try {
      const client = (deps.createClient ?? realCreateClient)({
        apiUrl: context.apiUrl,
        token: context.token,
        repository: context.repository,
      });
      outcome = await trackIssues({
        client,
        mode,
        sha: context.sha,
        before: context.event.before,
        forced: context.event.forced,
        findings: result.findings,
        paths,
        files: result.files,
        plugins,
      });
    } catch {
      outcome = failedOutcome();
    }
    for (const warning of outcome.warnings) {
      print(deps, `::warning title=issues::${escapeData(warning)}`);
    }
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
      renderSummary(result, {
        issuesLine: issuesLine(context, outcome),
        issueNotes: issueNotes(outcome),
      }),
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
