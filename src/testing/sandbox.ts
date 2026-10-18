import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "../context.ts";
import type { Io } from "../report/io.ts";

/** A temporary repository and runner folder, with an `Io` that keeps what is written in memory. */
export interface Sandbox {
  repo: string;
  temp: string;
  files: Map<string, string>;
  out: string[];
  io: Io;
  context: (overrides?: Partial<Context>) => Context;
  put: (file: string, text: string) => void;
  summary: () => string;
  cleanup: () => void;
}

export function createSandbox(): Sandbox {
  const base = mkdtempSync(path.join(tmpdir(), "apv-run-"));
  const repo = path.join(base, "repo");
  const temp = path.join(base, "temp");
  mkdirSync(repo);
  mkdirSync(temp);
  const files = new Map<string, string>();
  const out: string[] = [];
  let counter = 0;
  const io: Io = {
    stdout: (text) => out.push(text),
    append: (file, text) => files.set(file, (files.get(file) ?? "") + text),
    write: (file, text) => files.set(file, text),
    random: () => `r${++counter}`,
  };
  return {
    repo,
    temp,
    files,
    out,
    io,
    context: (overrides = {}) => ({
      manifests: "plugin.json\nmcp.json",
      openIssues: false,
      token: "",
      workspace: repo,
      eventName: "push",
      ref: "refs/heads/main",
      sha: "a".repeat(40),
      action: "validate",
      runnerTemp: temp,
      repository: "example/repo",
      apiUrl: "https://api.example.test",
      outputFile: path.join(temp, "output"),
      summaryFile: path.join(temp, "summary"),
      event: { defaultBranch: "main", before: undefined, forced: undefined },
      ...overrides,
    }),
    put: (file, text) => {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      writeFileSync(path.join(repo, file), text);
    },
    summary: () => files.get(path.join(temp, "summary")) ?? "",
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}
