import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The only code that writes: stdout, the summary, the outputs and the report. Nothing else. */
export interface Io {
  stdout(text: string): void;
  append(file: string, text: string): void;
  write(file: string, text: string): void;
  /** A random token for an output delimiter. */
  random(): string;
}

export const realIo: Io = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  append: (file, text) => {
    appendFileSync(file, text);
  },
  write: (file, text) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  },
  random: () => randomBytes(16).toString("hex"),
};

/**
 * One output in the `GITHUB_OUTPUT` format. The delimiter is random, so a value can't end the
 * block early and add other outputs.
 */
export function outputBlock(
  name: string,
  value: string,
  delimiter: string,
): string {
  return `${name}<<ghadelimiter_${delimiter}\n${value}\nghadelimiter_${delimiter}\n`;
}
