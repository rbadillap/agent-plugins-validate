import { constants } from "node:fs";
import { glob, lstat, open, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { ManifestEntry, PluginInput } from "../engine/types.ts";
import {
  isDefaultInput,
  MANIFEST_NAMES,
  parseLines,
  rejectReason,
} from "./patterns.ts";

export const MAX_FILES = 100;
export const MAX_BYTES = 1024 * 1024;

/** A problem with the workflow, not with a manifest. It fails the step with its own id. */
export interface ConfigError {
  id:
    | "manifests-invalid-pattern"
    | "manifests-no-match"
    | "manifests-too-many"
    | "manifest-too-large";
  message: string;
}

export interface Discovery {
  /** One entry per plugin root, in path order. */
  plugins: PluginInput[];
  configErrors: ConfigError[];
  /** Notes for `warning` annotations, for files that were skipped. */
  warnings: string[];
}

type Loaded =
  | { kind: "absent" }
  | { kind: "skipped"; warning: string }
  | { kind: "tooLarge" }
  | { kind: "entry"; entry: ManifestEntry };

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

function isSkippedDirectory(entry: string | { name: string }): boolean {
  const name = typeof entry === "string" ? path.basename(entry) : entry.name;
  return SKIPPED_DIRECTORIES.has(name);
}

function describeKind(stats: {
  isDirectory(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
}): string {
  if (stats.isDirectory()) return "(directory)";
  if (stats.isFIFO()) return "(FIFO)";
  if (stats.isSocket()) return "(socket)";
  if (stats.isBlockDevice() || stats.isCharacterDevice()) return "(device)";
  return "(not a regular file)";
}

/**
 * True when a path that glob returned is a plain path inside the workspace: no "", "." or ".."
 * segment, and it resolves inside. A match like "../outside/plugin.json" is refused, whatever the
 * pattern was.
 */
export function isInsideWorkspace(
  workspace: string,
  relative: string,
): boolean {
  if (relative === "" || path.isAbsolute(relative)) return false;
  if (relative.split("/").some((s) => s === "" || s === "." || s === ".."))
    return false;
  return isInside(workspace, path.resolve(workspace, relative));
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/**
 * Reads one manifest the safe way. Every component of the path is checked with `lstat`, a symlinked
 * file must resolve inside its plugin root, and the file is opened once and checked with `fstat` on
 * that handle, so a swap between the check and the read can't change what is read.
 */
async function load(workspace: string, relative: string): Promise<Loaded> {
  const parts = relative.split("/");
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join("/");
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(path.join(workspace, prefix));
    } catch {
      return { kind: "absent" };
    }
    if (stats.isSymbolicLink()) {
      // Only a file that is there is worth a warning; a sibling that doesn't exist is just absent.
      const exists = await lstat(path.join(workspace, relative)).then(
        () => true,
        () => false,
      );
      return exists
        ? {
            kind: "skipped",
            warning: `${prefix} is a symlinked directory; ${relative} was not read.`,
          }
        : { kind: "absent" };
    }
  }

  const full = path.join(workspace, relative);
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(full);
  } catch {
    return { kind: "absent" };
  }

  let openPath = full;
  if (stats.isSymbolicLink()) {
    const root = path.join(workspace, ...parts.slice(0, -1));
    let real: string;
    try {
      real = await realpath(full);
    } catch {
      return {
        kind: "entry",
        entry: {
          path: relative,
          unreadable: "not-a-file",
          detail: "(broken symbolic link)",
        },
      };
    }
    if (!isInside(root, real)) {
      const length = (await readlink(full)).length;
      return {
        kind: "entry",
        entry: {
          path: relative,
          unreadable: "outside-root",
          detail: `symbolic link (${length} chars)`,
        },
      };
    }
    openPath = real;
  } else if (!stats.isFile()) {
    return {
      kind: "entry",
      entry: {
        path: relative,
        unreadable: "not-a-file",
        detail: describeKind(stats),
      },
    };
  }

  // O_NOFOLLOW and O_NONBLOCK: a file swapped for a link or a FIFO after the checks is refused,
  // and can't make the read wait.
  const handle = await open(
    openPath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) {
      return {
        kind: "entry",
        entry: {
          path: relative,
          unreadable: "not-a-file",
          detail: describeKind(opened),
        },
      };
    }
    if (opened.size > MAX_BYTES) return { kind: "tooLarge" };
    // Read at most one byte more than the cap, in case the file grows after the check.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) return { kind: "tooLarge" };
    const text = buffer.toString("utf8", 0, length);
    return {
      kind: "entry",
      entry: {
        path: relative,
        text: text.startsWith("﻿") ? text.slice(1) : text,
      },
    };
  } finally {
    await handle.close();
  }
}

/**
 * Turns the `manifests` input into the plugins to check. This module is the only code that reads
 * manifest files. Lines are validated before any filesystem access; matching is done by Node's
 * stable `fs.promises.glob` inside the real path of the workspace.
 */
export async function discover(options: {
  workspace: string;
  manifests: string;
}): Promise<Discovery> {
  const result: Discovery = { plugins: [], configErrors: [], warnings: [] };
  const lines = parseLines(options.manifests);
  const isDefault = isDefaultInput(options.manifests);

  for (const line of lines) {
    const reason = rejectReason(line.text);
    if (reason !== null) {
      result.configErrors.push({
        id: "manifests-invalid-pattern",
        message: `manifests line ${line.number}: "${line.text}" ${reason}`,
      });
    }
  }
  if (result.configErrors.length > 0) return result;

  const workspace = await realpath(options.workspace);
  const matched = new Set<string>();
  for (const line of lines) {
    let count = 0;
    for await (const found of glob(line.text, {
      cwd: workspace,
      exclude: isSkippedDirectory,
    })) {
      const relative = found.split(path.sep).join("/");
      if (!isInsideWorkspace(workspace, relative)) continue;
      const segments = relative.split("/");
      const name = segments[segments.length - 1] ?? "";
      if (!MANIFEST_NAMES.includes(name)) continue;
      if (segments.some((segment) => SKIPPED_DIRECTORIES.has(segment)))
        continue;
      matched.add(relative);
      count += 1;
      // More than the cap is already an error: don't walk the rest of a large repository.
      if (matched.size > MAX_FILES) break;
    }
    if (count === 0 && !isDefault) {
      result.configErrors.push({
        id: "manifests-no-match",
        message: `manifests line ${line.number}: "${line.text}" matched no file`,
      });
    }
  }
  if (matched.size > MAX_FILES) {
    result.configErrors.push({
      id: "manifests-too-many",
      message: `manifests matched more than ${MAX_FILES} files; narrow the patterns`,
    });
  }
  if (result.configErrors.length > 0) return result;

  // Each directory with a matched file is a plugin root, and gets both of its manifests.
  const roots = new Set<string>(
    [...matched]
      .map((file) => path.posix.dirname(file))
      .map((dir) => (dir === "." ? "" : dir)),
  );
  if (isDefault) roots.add("");

  for (const root of [...roots].sort()) {
    const input: PluginInput = { root };
    for (const name of MANIFEST_NAMES) {
      const relative = root === "" ? name : `${root}/${name}`;
      const loaded = await load(workspace, relative);
      if (loaded.kind === "skipped") result.warnings.push(loaded.warning);
      else if (loaded.kind === "tooLarge") {
        result.configErrors.push({
          id: "manifest-too-large",
          message: `${relative} is larger than 1 MiB; manifests are small JSON files, so check that this is the right file`,
        });
      } else if (loaded.kind === "entry") {
        if (name === "plugin.json") input.plugin = loaded.entry;
        else input.mcp = loaded.entry;
      }
    }
    if (isDefault && root === "" && input.plugin === undefined) {
      input.plugin = { path: "plugin.json", unreadable: "missing" };
    }
    if (input.plugin !== undefined || input.mcp !== undefined) {
      result.plugins.push(input);
    }
  }
  return result;
}
