import { sectionLabel } from "../engine/spec.ts";
import type { FileKind, Finding } from "../engine/types.ts";
import { ruleById, ruleEffect, schemaViolation } from "../rules/index.ts";
import { escapeData, escapeProperty } from "./escape.ts";

function sentence(text: string): string {
  const capital = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** The message of a finding: what it is about, how to fix it, what happens if not, the spec. */
export function annotationMessage(finding: Finding, kind: FileKind): string {
  const rule = ruleById(finding.rule) ?? schemaViolation;
  const subject =
    finding.current === "(missing)"
      ? `${finding.field} is missing.`
      : `${finding.field} is ${finding.current}.`;
  const label = sectionLabel(finding.spec);
  const spec = label === null ? finding.spec : `${label} ${finding.spec}`;
  return `${subject} ${sentence(finding.fix)}\n${sentence(ruleEffect(rule, kind))} Spec: ${spec}`;
}

/** One workflow command per finding, at its level and on its line. */
export function annotation(finding: Finding, kind: FileKind): string {
  const properties = [`file=${escapeProperty(finding.file)}`];
  if (finding.line !== undefined) properties.push(`line=${finding.line}`);
  properties.push(`title=${escapeProperty(finding.rule)}`);
  return `::${finding.level} ${properties.join(",")}::${escapeData(annotationMessage(finding, kind))}`;
}
