import type {
  Claim,
  Problem,
  Rule,
  RuleContext,
  SchemaError,
} from "../engine/types.ts";
import { mcpServers } from "./mcp-servers.ts";

const EXAMPLE = '"https://api.example.com/mcp"';
const ABSOLUTE = `use an absolute http or https URL, e.g. ${EXAMPLE}`;
const CREDENTIAL =
  'a credential is in the URL: remove the user and the password from it, put the credential in "headers" (or in your secret store), and rotate it, because it is now in the repository';

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** The first character of a part, then "****". Nothing else of it is shown. */
function hidden(part: string): string {
  const [first = ""] = Array.from(decode(part));
  return `${first}****`;
}

/**
 * `scheme://u****:p****@host`: the first character of the user and of the password, each followed
 * by `****`, and the host, from the URL parser. The user is hidden like the password, because
 * a token is often sent as the user name. It is the only part of a URL a finding repeats, so that
 * a person can tell which credential it is. It is short, and the markers come before the host, so
 * the cut of `current` can't remove them.
 */
function maskedCredential(url: URL): string {
  return `${url.protocol}//${hidden(url.username)}:${hidden(url.password)}@${url.host}`;
}

// What the raw text looks like when it holds "user:password@" before the host, for a URL the parser
// rejects: with a scheme and any slashes, or with only slashes.
const RAW_CREDENTIAL =
  /^(?:[A-Za-z][A-Za-z0-9+.-]*:[\\/]*|[\\/]{0,2}(?![A-Za-z][A-Za-z0-9+.-]*:[\\/]{2}))[^@/?#\s]*:[^@\s]*@/;

export interface UrlProblem {
  /** What to change, as instructions. It never repeats the URL. */
  fix: string;
  /** Set when the parser found a password: the masked form to show as `current`. */
  shown?: string;
}

/**
 * Checks a `url`. The raw text is checked first, because the URL parser would normalize away what
 * the spec forbids (whitespace, a fragment, a missing "//"). User info is found by the parser, not
 * by pattern matching: a URL that parses with a password holds a credential.
 */
export function urlProblem(url: string): UrlProblem | null {
  const text = url.trim();
  const fixes: string[] = [];
  if (text !== url) fixes.push("remove the spaces around the URL");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this looks for
  if (/[\s\u0000-\u001f\u007f]/.test(text)) {
    fixes.push("remove the spaces and control characters inside the URL");
  }
  if (text.includes("#")) fixes.push('remove the fragment (from "#" on)');
  const prefix = /^(https?):([\\/]*)/i.exec(text);
  if (prefix !== null && prefix[2] !== "//") {
    fixes.push('write "://" right after the scheme');
  }

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    // The parser rejects it, so it can't say what the credential is. The advice is still needed.
    return {
      fix: RAW_CREDENTIAL.test(text) ? `${ABSOLUTE}; ${CREDENTIAL}` : ABSOLUTE,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    // Not a URL a client can use, so it is described, not shown, even with a password.
    return {
      fix:
        parsed.password !== "" || RAW_CREDENTIAL.test(text)
          ? `${ABSOLUTE}; ${CREDENTIAL}`
          : ABSOLUTE,
    };
  }

  let shown: string | undefined;
  if (parsed.password !== "") {
    fixes.push(CREDENTIAL);
    shown = maskedCredential(parsed);
  } else if (
    parsed.username !== "" ||
    /^[a-z][a-z0-9+.-]*:[\\/]*[^\\/?#]*@/i.test(text)
  ) {
    fixes.push("remove the user info from the URL");
  }
  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
    fixes.push(
      'use "https" instead of "http", which is allowed only for localhost, 127.0.0.0/8 and [::1]',
    );
  }
  if (fixes.length === 0) return null;
  return { fix: fixes.join("; "), ...(shown === undefined ? {} : { shown }) };
}

export const mcpUrl: Rule = {
  id: "mcp-url",
  level: "error",
  section: "Streamable HTTP and legacy HTTP+SSE",
  effect: "Clients that follow the spec skip this server until it's fixed.",
  appliesTo: "mcp",
  check(ctx: RuleContext): Problem[] {
    const problems: Problem[] = [];
    for (const { name, value, shape } of mcpServers(ctx)) {
      const url = value.url;
      // An empty url is a schema error, claimed below.
      if (shape === "stdio" || typeof url !== "string" || url === "") continue;
      const problem = urlProblem(url);
      if (problem !== null) {
        problems.push({
          path: ["mcpServers", name, "url"],
          current: url,
          ...(problem.shown === undefined
            ? {}
            : { currentText: problem.shown }),
          fix: problem.fix,
        });
      }
    }
    return problems;
  },
  claim(error: SchemaError): Claim | undefined {
    if (error.server === undefined || error.keyword !== "minLength") {
      return undefined;
    }
    if (error.path.length !== 3 || error.path[2] !== "url") return undefined;
    return { path: error.path, current: error.value, fix: ABSOLUTE };
  },
};
