import { createHash } from "node:crypto";
import { check as realCheck } from "../engine/check.ts";
import { sectionLabel } from "../engine/spec.ts";
import type {
  CheckResult,
  Finding,
  PathPart,
  PluginInput,
} from "../engine/types.ts";
import { codeSpan, renderFix } from "../report/escape.ts";
import type { FileResult } from "../report/types.ts";
import type { ApiClient, Contents, RawIssue } from "./api.ts";
import { ApiError } from "./api.ts";

export const LABEL = "agent-plugins-validate";
const MAX_OPENED = 10;
const MAX_WRITES = 50;
const MAX_PAGES = 10;
const ZEROS = "0".repeat(40);
// A commit id: 40 hex digits, or 64 in a repository that uses SHA-256.
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// The two rules that gate every other rule of a file, in the order they run.
const GATES = ["json-syntax", "schema-version"] as const;

export type Mode = "full" | "update-close" | "none";

/** What the event allows: see the table in the README's Issues section. */
export function issueMode(event: {
  eventName: string;
  ref: string;
  defaultBranch: string | undefined;
  forced: boolean | undefined;
}): Mode {
  if (event.defaultBranch === undefined) return "none";
  if (event.ref !== `refs/heads/${event.defaultBranch}`) return "none";
  if (event.eventName === "push")
    return event.forced === true ? "update-close" : "full";
  if (event.eventName === "workflow_dispatch") return "update-close";
  return "none";
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Identifies a problem: its rule, its file and the keys that lead to its field, as in the file. */
export function fingerprint(
  finding: Finding,
  path: readonly PathPart[],
): string {
  return sha256(JSON.stringify([finding.rule, finding.file, path]));
}

const MARKER =
  /<!-- agent-plugins-validate:v1 fingerprint=([0-9a-f]{64}) current=([0-9a-f]{64}) file=([0-9a-f]{64}) rule=([a-z][a-z0-9-]{0,63}) -->/;

interface Marker {
  fingerprint: string;
  current: string;
  file: string;
  rule: string;
}

export function marker(finding: Finding, path: readonly PathPart[]): string {
  return `<!-- agent-plugins-validate:v1 fingerprint=${fingerprint(finding, path)} current=${sha256(finding.current)} file=${sha256(finding.file)} rule=${finding.rule} -->`;
}

function parseMarker(body: string | null | undefined): Marker | null {
  const match = MARKER.exec(body ?? "");
  if (match === null) return null;
  const [, fingerprint = "", current = "", file = "", rule = ""] = match;
  return { fingerprint, current, file, rule };
}

interface OwnIssue {
  issue: RawIssue;
  marker: Marker;
  open: boolean;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

/** The title: the file and the field in code spans, each cut so the whole stays under 200. */
function title(finding: Finding): string {
  const cut = (text: string): string =>
    text.length > 80 ? `${text.slice(0, 79)}…` : text;
  return `${codeSpan(cut(finding.file))}: ${codeSpan(cut(finding.field))} no longer follows the Agent Plugins spec`;
}

function specVersion(finding: Finding): string {
  return /\/v(\d+\.\d+\.\d+)\//.exec(finding.spec)?.[1] ?? "1.0.0";
}

/** The body of an issue. Everything that comes from a repository is in a code span. */
export function issueBody(
  finding: Finding,
  path: readonly PathPart[],
  sha: string,
  before: string,
): string {
  const label = sectionLabel(finding.spec) ?? "spec";
  return [
    `${codeSpan(finding.field)} in ${codeSpan(finding.file)} stopped following the Agent Plugins spec (${specVersion(finding)}) in ${short(sha)}.`,
    "",
    "| Rule | Current | Fix | Spec |",
    "| --- | --- | --- | --- |",
    `| ${codeSpan(finding.rule)} | ${codeSpan(finding.current)} | ${renderFix(finding.fix)} | [${label}](${finding.spec}) |`,
    "",
    `It passed at ${short(before)}. This issue closes itself when the rule passes again.`,
    "",
    marker(finding, path),
    "",
  ].join("\n");
}

export interface IssueLink {
  number: number;
  url: string;
}

export interface IssuesOutcome {
  opened: IssueLink[];
  reopened: IssueLink[];
  updated: IssueLink[];
  closed: IssueLink[];
  /** Set when GitHub's answer stopped the issues step: it replaces the counts in the summary. */
  errorNote: string | undefined;
  /** Lines for the summary, after the counts. */
  notes: string[];
  /** Messages for `warning` annotations. */
  warnings: string[];
}

export function issuesSummaryLine(outcome: IssuesOutcome): string {
  const n = (list: IssueLink[]): number => list.length;
  return `Issues: opened ${n(outcome.opened)}, reopened ${n(outcome.reopened)}, updated ${n(outcome.updated)}, closed ${n(outcome.closed)}.`;
}

function link(issue: RawIssue): IssueLink {
  return { number: issue.number, url: issue.html_url };
}

export function linkMarkdown(item: IssueLink): string {
  return /^https:\/\//.test(item.url)
    ? `[#${item.number}](${item.url})`
    : `#${item.number}`;
}

const NOTES = {
  rateLimit:
    "Issues: skipped, GitHub's API rate limit was reached. They'll catch up on the next push.",
  write:
    "Issues: on, but the token can't write issues. Add issues: write to the job's permissions.",
  read: "Issues: on, but the token can't read earlier versions of the manifests, so no regression could be proven.",
  gone: "Issues: on, but issues are turned off in this repository.",
  readIssues:
    "Issues: on, but the token can't read this repository's issues. Add issues: write to the job's permissions.",
  network: "Issues: skipped, GitHub's API didn't answer.",
  other:
    "Issues: skipped, GitHub's API answered with an error or something unexpected happened. Your results above are not affected.",
} as const;

function noteFor(error: ApiError): string {
  switch (error.kind) {
    case "rate-limit":
      return NOTES.rateLimit;
    case "forbidden":
      if (error.write) return NOTES.write;
      return error.area === "contents" ? NOTES.read : NOTES.readIssues;
    case "gone":
      return NOTES.gone;
    case "network":
      return NOTES.network;
    default:
      return NOTES.other;
  }
}

export interface IssuesInput {
  client: ApiClient;
  mode: "full" | "update-close";
  sha: string;
  before: string | undefined;
  forced: boolean | undefined;
  findings: readonly Finding[];
  paths: readonly PathPart[][];
  files: readonly FileResult[];
  /** The plugins that were checked, to read the same files at the earlier commit. */
  plugins: readonly PluginInput[];
  /** The engine, for the earlier version of the manifests. */
  check?: (input: PluginInput) => CheckResult;
}

interface Tracked {
  finding: Finding;
  path: PathPart[];
  fingerprint: string;
}

/**
 * Keeps the Action's own issues in step with the findings. See the README's Issues section for the
 * rules this follows. It acts only on issues it authored, and writes only issues and one label.
 */
export async function trackIssues(input: IssuesInput): Promise<IssuesOutcome> {
  const outcome: IssuesOutcome = {
    opened: [],
    reopened: [],
    updated: [],
    closed: [],
    errorNote: undefined,
    notes: [],
    warnings: [],
  };
  try {
    await track(input, outcome);
  } catch (error) {
    // Whatever goes wrong here, the result of the run still comes from the findings alone.
    const note = error instanceof ApiError ? noteFor(error) : NOTES.other;
    outcome.errorNote = note;
    outcome.warnings.push(note);
  }
  return outcome;
}

/** An outcome for an issues step that could not even start. */
export function failedOutcome(): IssuesOutcome {
  return {
    opened: [],
    reopened: [],
    updated: [],
    closed: [],
    errorNote: NOTES.other,
    notes: [],
    warnings: [NOTES.other],
  };
}

/**
 * The author of an issue opened with the workflow's own token: `github-actions[bot]`, not any bot.
 * Another app (a dependency updater, for instance) can open an issue with a label and a marker too.
 */
function isWorkflowBot(issue: RawIssue): boolean {
  if (
    issue.user?.type !== "Bot" ||
    issue.user.login !== "github-actions[bot]"
  ) {
    return false;
  }
  const slug = issue.performed_via_github_app?.slug;
  return slug === undefined || slug === "github-actions";
}

async function listOwn(
  client: ApiClient,
  login: string | null,
): Promise<OwnIssue[]> {
  const own: OwnIssue[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const issues = await client.listIssues(LABEL, page);
    for (const issue of issues) {
      if (issue.pull_request !== undefined) continue;
      const labels = (issue.labels ?? []).map((l) =>
        typeof l === "string" ? l : l.name,
      );
      if (!labels.includes(LABEL)) continue;
      const parsed = parseMarker(issue.body);
      if (parsed === null) continue;
      // The author must be the Action's own identity: a user can add a label and a marker.
      const author = issue.user;
      const isOwn =
        login === null ? isWorkflowBot(issue) : author?.login === login;
      if (!isOwn) continue;
      own.push({ issue, marker: parsed, open: issue.state === "open" });
    }
    if (issues.length < 100) break;
  }
  return own;
}

/** Of several issues for one fingerprint, the open one, else the newest. */
function pick(own: readonly OwnIssue[]): Map<string, OwnIssue> {
  const byFingerprint = new Map<string, OwnIssue>();
  for (const item of own) {
    const current = byFingerprint.get(item.marker.fingerprint);
    if (
      current === undefined ||
      (item.open && !current.open) ||
      (item.open === current.open && item.issue.number > current.issue.number)
    ) {
      byFingerprint.set(item.marker.fingerprint, item);
    }
  }
  return byFingerprint;
}

function trackedFindings(input: IssuesInput): Tracked[] {
  const tracked: Tracked[] = [];
  input.findings.forEach((finding, index) => {
    // A notice never opens, updates or closes an issue.
    if (finding.level === "notice") return;
    const path = input.paths[index] ?? [];
    tracked.push({ finding, path, fingerprint: fingerprint(finding, path) });
  });
  return tracked;
}

/** True when the file was read, and (unless the rule is a gate) passed version selection. */
function wasChecked(
  files: readonly FileResult[],
  file: string,
  rule: string,
): boolean {
  const found = files.find((f) => f.file === file);
  if (found === undefined) return false;
  return (
    found.specVersion !== null || (GATES as readonly string[]).includes(rule)
  );
}

async function track(input: IssuesInput, out: IssuesOutcome): Promise<void> {
  const { client } = input;
  const login = await client.getUser();
  const own = await listOwn(client, login);
  const byFingerprint = pick(own);
  const failing = trackedFindings(input);
  const failingFingerprints = new Map(failing.map((t) => [t.fingerprint, t]));
  const sha7 = short(input.sha);
  let writes = 0;
  let notDone = 0;

  // Update and close: no proof needed, the issue is already ours.
  for (const item of byFingerprint.values()) {
    if (!item.open) continue;
    const still = failingFingerprints.get(item.marker.fingerprint);
    if (still !== undefined) {
      if (sha256(still.finding.current) === item.marker.current) continue;
      if (writes + 2 > MAX_WRITES) {
        notDone += 1;
        continue;
      }
      const old = /in ([0-9a-f]{7})\./.exec(item.issue.body ?? "")?.[1] ?? sha7;
      const passed =
        /It passed at ([0-9a-f]{7})\./.exec(item.issue.body ?? "")?.[1] ?? sha7;
      await client.updateIssue(item.issue.number, {
        body: issueBody(still.finding, still.path, old, passed),
      });
      await client.addComment(
        item.issue.number,
        `Now ${codeSpan(still.finding.current)} as of ${sha7}.`,
      );
      writes += 2;
      out.updated.push(link(item.issue));
    } else if (checkedByHash(input.files, item.marker)) {
      if (writes + 2 > MAX_WRITES) {
        notDone += 1;
        continue;
      }
      await client.addComment(item.issue.number, `Fixed in ${sha7}.`);
      await client.updateIssue(item.issue.number, {
        state: "closed",
        state_reason: "completed",
      });
      writes += 2;
      out.closed.push(link(item.issue));
    } else {
      out.notes.push(
        `${linkMarkdown(link(item.issue))} stays open: its file was not checked in this run.`,
      );
    }
  }

  if (input.mode !== "full") {
    if (notDone > 0)
      out.notes.push(
        `${notDone} issue changes were not made: the limit of ${MAX_WRITES} writes was reached.`,
      );
    return;
  }

  // Open and reopen: only a regression that is proven.
  const candidates = failing.filter(
    (t) => byFingerprint.get(t.fingerprint)?.open !== true,
  );
  if (candidates.length === 0) {
    if (notDone > 0)
      out.notes.push(
        `${notDone} issue changes were not made: the limit of ${MAX_WRITES} writes was reached.`,
      );
    return;
  }
  const proven = await proveRegressions(input, candidates);
  let labelReady = false;
  let opened = 0;
  const handled = new Set<string>();
  for (const regression of proven) {
    // One fingerprint, one issue, even if two findings share it. The list of issues can lag.
    if (handled.has(regression.fingerprint)) continue;
    handled.add(regression.fingerprint);
    const existing = byFingerprint.get(regression.fingerprint);
    if (existing !== undefined && existing.issue.state_reason !== "completed") {
      const reason =
        existing.issue.state_reason === "not_planned"
          ? "not planned"
          : (existing.issue.state_reason ?? "something other than completed");
      out.notes.push(
        `${linkMarkdown(link(existing.issue))} was closed as ${reason}, so it stays closed.`,
      );
      continue;
    }
    if (opened >= MAX_OPENED || writes + 3 > MAX_WRITES) {
      notDone += 1;
      continue;
    }
    const before = input.before ?? ZEROS;
    if (existing !== undefined) {
      await client.updateIssue(existing.issue.number, {
        state: "open",
        state_reason: "reopened",
        body: issueBody(regression.finding, regression.path, input.sha, before),
      });
      await client.addComment(
        existing.issue.number,
        `It fails again as of ${sha7}.`,
      );
      writes += 2;
      opened += 1;
      out.reopened.push(link(existing.issue));
      continue;
    }
    if (!labelReady) {
      await client.ensureLabel(LABEL);
      labelReady = true;
      writes += 1;
    }
    // Another run may have opened it since the list was read.
    const fresh = pick(await listOwn(client, login)).get(
      regression.fingerprint,
    );
    if (fresh !== undefined) continue;
    const created = await client.createIssue({
      title: title(regression.finding),
      body: issueBody(regression.finding, regression.path, input.sha, before),
      labels: [LABEL],
    });
    writes += 1;
    opened += 1;
    out.opened.push(link(created));
  }
  if (notDone > 0) {
    out.notes.push(
      `${notDone} issue changes were not made: the limit of ${MAX_OPENED} new issues or ${MAX_WRITES} writes was reached.`,
    );
  }
}

function checkedByHash(files: readonly FileResult[], mark: Marker): boolean {
  return files.some(
    (f) => sha256(f.file) === mark.file && wasChecked(files, f.file, mark.rule),
  );
}

interface Before {
  state: "absent" | "unusable" | "ok";
  text?: string;
}

async function readBefore(
  client: ApiClient,
  file: string,
  ref: string,
): Promise<Before> {
  const contents: Contents = await client.getContents(file, ref);
  if (contents.status === "ok") return { state: "ok", text: contents.text };
  return { state: contents.status };
}

/** The candidates that passed at the commit before the push. No proof, no issue. */
async function proveRegressions(
  input: IssuesInput,
  candidates: Tracked[],
): Promise<Tracked[]> {
  const { client, before, forced } = input;
  if (before === undefined || /^0+$/.test(before) || forced === true) return [];
  // Not a commit id: there is nothing to ask GitHub about.
  if (!COMMIT.test(before)) return [];
  if (!(await client.commitExists(before))) return [];
  const engine = input.check ?? realCheck;
  // Both files of a plugin root are read at `before` and checked together, because a rule can
  // compare them. Known gap, latent while 1.0.0 is the only supported version (`mcp-version-match`
  // can't fail yet): when the sibling failed a gate at `before`, a rule that depends on it should
  // count as not proven. It does not yet.

  const proven: Tracked[] = [];
  const roots = new Map<string, PluginInput>();
  for (const plugin of input.plugins) roots.set(plugin.root, plugin);
  const byRoot = new Map<string, Tracked[]>();
  for (const candidate of candidates) {
    const owner = input.plugins.find(
      (p) =>
        p.plugin?.path === candidate.finding.file ||
        p.mcp?.path === candidate.finding.file,
    );
    if (owner === undefined) continue;
    byRoot.set(owner.root, [...(byRoot.get(owner.root) ?? []), candidate]);
  }

  for (const [root, group] of byRoot) {
    const plugin = roots.get(root);
    if (plugin === undefined) continue;
    const pluginPath = root === "" ? "plugin.json" : `${root}/plugin.json`;
    const mcpPath = root === "" ? "mcp.json" : `${root}/mcp.json`;
    const [pluginBefore, mcpBefore] = [
      await readBefore(client, pluginPath, before),
      await readBefore(client, mcpPath, before),
    ];
    if (pluginBefore.state === "unusable" || mcpBefore.state === "unusable")
      continue;
    const previous: PluginInput = { root };
    if (pluginBefore.text !== undefined)
      previous.plugin = { path: pluginPath, text: pluginBefore.text };
    if (mcpBefore.text !== undefined)
      previous.mcp = { path: mcpPath, text: mcpBefore.text };
    const result = engine(previous);
    const failingBefore = new Set(
      result.findings.map((f, i) => fingerprint(f, result.paths[i] ?? [])),
    );
    for (const candidate of group) {
      const file = candidate.finding.file;
      const existed =
        file === pluginPath
          ? pluginBefore.state === "ok"
          : mcpBefore.state === "ok";
      if (!existed) continue;
      const gate = GATES.find((rule) =>
        result.findings.some((f) => f.file === file && f.rule === rule),
      );
      if (gate !== undefined) {
        // The rules after a failed gate never ran, so only an earlier gate rule was proven to pass.
        const order = (GATES as readonly string[]).indexOf(
          candidate.finding.rule,
        );
        if (order === -1 || order >= GATES.indexOf(gate)) continue;
        proven.push(candidate);
        continue;
      }
      if (!failingBefore.has(candidate.fingerprint)) proven.push(candidate);
    }
  }
  return proven;
}
