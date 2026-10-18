import { sectionLabel } from "../engine/spec.ts";
import type { Finding } from "../engine/types.ts";
import { codeSpan, escapeMarkdown, renderFix } from "./escape.ts";
import type { FileResult, RunResult } from "./types.ts";

export const HEADING = "Agent Plugins manifests";
const ICON = { error: "❌", warning: "⚠️", notice: "ℹ️" } as const;

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function specVersions(files: readonly FileResult[]): string {
  const versions = [
    ...new Set(
      files.flatMap((f) => (f.specVersion === null ? [] : [f.specVersion])),
    ),
  ];
  return versions.join(", ");
}

function countsFor(file: string, findings: readonly Finding[]) {
  const mine = findings.filter((f) => f.file === file);
  return {
    error: mine.filter((f) => f.level === "error").length,
    warning: mine.filter((f) => f.level === "warning").length,
    notice: mine.filter((f) => f.level === "notice").length,
  };
}

/** What a file's line says; passing files come first. */
function fileLine(file: FileResult, findings: readonly Finding[]): string {
  const name = codeSpan(file.file);
  const counts = countsFor(file.file, findings);
  if (counts.error > 0) {
    return `❌ ${name} has ${plural(counts.error, "thing", "things")} to fix.`;
  }
  if (counts.warning > 0) {
    return `⚠️ ${name} loads, with ${plural(counts.warning, "warning", "warnings")}.`;
  }
  if (counts.notice > 0) {
    return `✅ ${name} follows the spec, with ${plural(counts.notice, "suggestion", "suggestions")}.`;
  }
  return `✅ ${name} follows the spec.`;
}

/** The sentence for a run in which every file passes with no findings. */
function allPass(files: readonly FileResult[]): string {
  const version = specVersions(files);
  const spec = `the Agent Plugins spec (${version})`;
  if (files.length === 2) return `Both manifests follow ${spec}.`;
  if (files.length === 1) {
    return `${codeSpan(files[0]?.file ?? "")} follows ${spec}.`;
  }
  return `All ${files.length} manifests follow ${spec}.`;
}

function specCell(finding: Finding): string {
  const label = sectionLabel(finding.spec) ?? "spec";
  return `[${escapeMarkdown(label)}](${finding.spec})`;
}

function table(findings: readonly Finding[]): string[] {
  const rows = findings.map(
    (f) =>
      `| ${ICON[f.level]} | ${codeSpan(f.file)} | ${codeSpan(f.field)} | ${codeSpan(f.current)} | ${renderFix(f.fix)} | ${specCell(f)} |`,
  );
  return [
    "| | File | Field | Now | How to fix | Spec |",
    "|---|---|---|---|---|---|",
    ...rows,
  ];
}

export interface SummaryOptions {
  /** The issues line, or null for none (pull requests). */
  issuesLine: string | null;
  /** Extra lines about issues, such as links to the ones that were opened. */
  issueNotes?: readonly string[];
}

/** The job summary, in Markdown. Nothing from a repository is placed outside a code span. */
export function renderSummary(
  result: RunResult,
  options: SummaryOptions,
): string {
  const out: string[] = [`## ${HEADING}`, ""];
  const { files, findings, configErrors, warnings } = result;

  if (files.length > 0 && findings.length === 0 && configErrors.length === 0) {
    out.push(allPass(files), "");
  } else if (files.length > 0) {
    const order = { pass: 0, warn: 1, fail: 2 } as const;
    const sorted = [...files].sort(
      (a, b) =>
        order[a.status] - order[b.status] || a.file.localeCompare(b.file),
    );
    for (const file of sorted) out.push(fileLine(file, findings), "");
    if (findings.length > 0) out.push(...table(findings), "");
  }

  if (configErrors.length > 0) {
    out.push("**Configuration**", "");
    for (const error of configErrors) {
      out.push(`- ${codeSpan(error.id)}: ${codeSpan(error.message)}`);
    }
    out.push("");
  }
  if (warnings.length > 0) {
    out.push("**Skipped**", "");
    for (const warning of warnings) out.push(`- ${codeSpan(warning)}`);
    out.push("");
  }
  if (options.issuesLine !== null) out.push(options.issuesLine, "");
  for (const note of options.issueNotes ?? []) out.push(note, "");
  return `${out.join("\n").trimEnd()}\n`;
}

export const ISSUES_OFF =
  "Issues: off. [How to turn issues on](https://github.com/rbadillap/agent-plugins-validate#issues)";
