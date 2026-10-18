import type {
  Claim,
  Problem,
  Rule,
  RuleContext,
  SchemaError,
} from "../engine/types.ts";
import { mcpServers } from "./mcp-servers.ts";
import { escapes, isAbsolute, namedSegments } from "./path-text.ts";

const PLACEHOLDER = /\$\{PLUGIN_(?:ROOT|DATA)\}/;
const EXAMPLE = '"./bin/server"';
// The fixes below are instructions with a generic example. They never repeat any part of the
// command, which is free text.
const SINGLE_EXECUTABLE = `use a single executable, e.g. ${EXAMPLE}`;
const SPLIT_TOKENS =
  'keep only the executable in "command" and move the remaining tokens, in order, to "args", e.g. "command": "npx", "args": ["-y", "some-package"]';
const SPLIT_TOKENS_BEFORE_ARGS =
  'keep only the executable in "command" and move the remaining tokens, in order, to the start of the existing "args", e.g. "command": "npx", "args": ["-y", "some-package"]';
const NO_QUOTES = `use a single executable without quotes or spaces, e.g. ${EXAMPLE}`;

// Tokens that are provably safe to repeat. A flag is a dash and a word; a package spec is a package
// name with an optional scope and version, such as "@scope/pkg@1.2.3". Anything else (a value after
// "=", a path, a URL, an odd character) might be a secret, so the instruction stays generic.
const FLAG = /^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/;
const PACKAGE =
  /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(@[A-Za-z0-9._^~<>=*-]+)?$/;
const PLAIN_EXECUTABLE =
  /^(?:\.\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** What is wrong with one token. Null when it is a bare name, or a "./" path inside the plugin. */
function tokenProblem(token: string): string | null {
  const normalized = token.replaceAll("\\", "/");
  const named = namedSegments(normalized);
  if (PLACEHOLDER.test(token)) {
    return `use a bare executable name or a path starting with "./"; placeholders are not expanded in "command"`;
  }
  // "~" and environment variables are expanded by a shell, which a client doesn't use.
  if (/^~|\$/.test(token)) {
    return 'use a bare executable name or a path starting with "./"; "~" and environment variables are not expanded';
  }
  // ".", "./", ".." and the like name a directory, not an executable.
  if (named.length === 0 && !isAbsolute(normalized)) {
    return `use an executable name or a path to a file, e.g. ${EXAMPLE}`;
  }
  if (isAbsolute(normalized)) {
    return `use a bare executable name found on the search path, or bundle the executable and use a path starting with "./", e.g. ${EXAMPLE}`;
  }
  if (!normalized.includes("/")) return null;
  if (normalized.startsWith("../") || escapes(normalized)) {
    return `move the executable inside the plugin and use a path starting with "./", e.g. ${EXAMPLE}`;
  }
  if (normalized.startsWith("./")) {
    return normalized === token
      ? null
      : `use "/" as the separator in the path, e.g. ${EXAMPLE}`;
  }
  return `start the path with "./", e.g. ${EXAMPLE}`;
}

/** The fix for a `command`, or null when it is valid. */
export function commandFix(command: string, hasArgs = false): string | null {
  const [head, ...rest] = command.split(/\s+/).filter((t) => t !== "");
  if (head === undefined) return SINGLE_EXECUTABLE;
  if (rest.length > 0) {
    // Quotes don't make a token: a spec-conforming client sees the words inside them as separate.
    if (/^["']/.test(head)) return NO_QUOTES;
    // When every token is provably safe, the fix is exact. If one is not, nothing is listed.
    if (
      tokenProblem(head) === null &&
      PLAIN_EXECUTABLE.test(head) &&
      rest.every((token) => FLAG.test(token) || PACKAGE.test(token))
    ) {
      const list = `[${rest.map((token) => JSON.stringify(token)).join(", ")}]`;
      return hasArgs
        ? `use "command": ${JSON.stringify(head)} and put ${list} at the start of the existing "args"`
        : `use "command": ${JSON.stringify(head)}, "args": ${list}`;
    }
    return hasArgs ? SPLIT_TOKENS_BEFORE_ARGS : SPLIT_TOKENS;
  }
  const problem = tokenProblem(head);
  if (problem !== null) return problem;
  // Only whitespace around a valid token.
  return head === command ? null : "remove the spaces around the executable";
}

export const mcpCommand: Rule = {
  id: "mcp-command",
  level: "error",
  section: "stdio",
  effect: "Clients that follow the spec skip this server until it's fixed.",
  appliesTo: "mcp",
  check(ctx: RuleContext): Problem[] {
    const problems: Problem[] = [];
    for (const { name, value, shape } of mcpServers(ctx)) {
      const command = value.command;
      // An empty command is a schema error, claimed below.
      if (shape !== "stdio" || typeof command !== "string" || command === "") {
        continue;
      }
      const fix = commandFix(
        command,
        Array.isArray(value.args) && value.args.length > 0,
      );
      if (fix !== null) {
        problems.push({
          path: ["mcpServers", name, "command"],
          current: command,
          fix,
        });
      }
    }
    return problems;
  },
  claim(error: SchemaError): Claim | undefined {
    if (error.server === undefined || error.keyword !== "minLength") {
      return undefined;
    }
    if (error.path.length !== 3 || error.path[2] !== "command") {
      return undefined;
    }
    return { path: error.path, current: error.value, fix: SINGLE_EXECUTABLE };
  },
};
