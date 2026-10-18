import type { ConfigError } from "../discover/discover.ts";
import type { FileKind, Finding } from "../engine/types.ts";

export type FileStatus = "pass" | "warn" | "fail";

export interface FileResult {
  file: string;
  kind: FileKind;
  specVersion: string | null;
  status: FileStatus;
}

/** Everything one run found, from discovery and the engine. The reporters turn it into output. */
export interface RunResult {
  files: FileResult[];
  /** Sorted: errors, then warnings, then notices; each by file and line. */
  findings: Finding[];
  configErrors: ConfigError[];
  /** Notes for files that were skipped, shown as `warning` annotations. */
  warnings: string[];
}
