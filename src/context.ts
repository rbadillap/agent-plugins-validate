import { readFileSync } from "node:fs";
import { DEFAULT_MANIFESTS } from "./discover/patterns.ts";

export interface Context {
  manifests: string;
  openIssues: boolean;
  token: string;
  workspace: string;
  eventName: string;
  ref: string;
  sha: string;
  /** The id of this step in the job, for the report's folder. */
  action: string;
  runnerTemp: string;
  repository: string;
  apiUrl: string;
  outputFile: string | undefined;
  summaryFile: string | undefined;
  /** The parts of the event payload the Action uses. */
  event: {
    defaultBranch: string | undefined;
    before: string | undefined;
    forced: boolean | undefined;
  };
}

function readEvent(file: string | undefined): Context["event"] {
  const none = {
    defaultBranch: undefined,
    before: undefined,
    forced: undefined,
  };
  if (file === undefined) return none;
  try {
    const payload = JSON.parse(readFileSync(file, "utf8")) as {
      repository?: { default_branch?: unknown };
      before?: unknown;
      forced?: unknown;
    };
    return {
      defaultBranch:
        typeof payload.repository?.default_branch === "string"
          ? payload.repository.default_branch
          : undefined,
      before: typeof payload.before === "string" ? payload.before : undefined,
      forced: typeof payload.forced === "boolean" ? payload.forced : undefined,
    };
  } catch {
    return none;
  }
}

/** Reads the inputs and the environment of the step. The only place that does. */
export function readContext(env: NodeJS.ProcessEnv): Context {
  const manifests = env.INPUT_MANIFESTS;
  return {
    manifests:
      manifests === undefined || manifests.trim() === ""
        ? DEFAULT_MANIFESTS
        : manifests,
    openIssues:
      (env["INPUT_OPEN-ISSUES"] ?? "false").trim().toLowerCase() === "true",
    token: env.INPUT_TOKEN ?? "",
    workspace: env.GITHUB_WORKSPACE ?? process.cwd(),
    eventName: env.GITHUB_EVENT_NAME ?? "",
    ref: env.GITHUB_REF ?? "",
    sha: env.GITHUB_SHA ?? "",
    action: env.GITHUB_ACTION ?? "step",
    runnerTemp: env.RUNNER_TEMP ?? "",
    repository: env.GITHUB_REPOSITORY ?? "",
    apiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
    outputFile: env.GITHUB_OUTPUT,
    summaryFile: env.GITHUB_STEP_SUMMARY,
    event: readEvent(env.GITHUB_EVENT_PATH),
  };
}
