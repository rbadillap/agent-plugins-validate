import type { Problem, Rule, RuleContext } from "../engine/types.ts";
import { mcpServers } from "./mcp-servers.ts";
import { pastedKeyText, pastedPair } from "./pasted-pair.ts";
import { isObject, quote, shownName } from "./util.ts";

// The `token` grammar of RFC 9110 section 5.6.2.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// RFC 9110 section 5.5: no control characters in a field value, except horizontal tab.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this is the check
const CONTROL = /[\u0000-\u0008\u000A-\u001F\u007F]/;

// The fixes are instructions with a generic example. They never repeat a header name or value,
// which are free text.
const NAME_FIX =
  'use a header name made of letters, digits and "-" (and the other characters RFC 9110 allows in a token), e.g. "X-Tenant"';
const ROTATE =
  "Header values are visible package data: if the pasted value is a secret, don't keep it here. Rotate it: removing it from the file doesn't remove it from the repository's history.";
const VALUE_FIX = "remove the control characters from the value";
const SPELLING_FIX =
  "keep one spelling of this header name: names are case-insensitive, so they are the same header";

export const mcpHeaders: Rule = {
  id: "mcp-headers",
  level: "error",
  section: "Streamable HTTP and legacy HTTP+SSE",
  effect: "Clients that follow the spec skip this server until it's fixed.",
  appliesTo: "mcp",
  check(ctx: RuleContext): Problem[] {
    const problems: Problem[] = [];
    for (const { name, value, shape } of mcpServers(ctx)) {
      const headers = value.headers;
      if (shape === "stdio" || !isObject(headers)) continue;
      const seen = new Map<string, string[]>();
      for (const [header, headerValue] of Object.entries(headers)) {
        const path = ["mcpServers", name, "headers", header];
        if (!TOKEN.test(header)) {
          const pasted = pastedPair(header, /^[A-Za-z0-9-]{1,64}$/);
          problems.push(
            pasted === null
              ? { path, current: header, fix: NAME_FIX }
              : {
                  path,
                  current: header,
                  currentText: pastedKeyText(header, pasted.separator),
                  fix:
                    pasted.name === undefined
                      ? `a header name can't contain ${quote(pasted.separator)}; keep only the name as the key, e.g. "X-Tenant", and put the value in the value. ${ROTATE}`
                      : `use ${quote(pasted.name)} as the header name and put the value in the value. ${ROTATE}`,
                },
          );
        }
        if (typeof headerValue === "string" && CONTROL.test(headerValue)) {
          problems.push({
            path,
            current: headerValue,
            fix: VALUE_FIX,
          });
        }
        seen.set(header.toLowerCase(), [
          ...(seen.get(header.toLowerCase()) ?? []),
          header,
        ]);
      }
      // One finding per group of names that differ only by case, on the second spelling.
      for (const spellings of seen.values()) {
        const [, second] = spellings;
        if (second === undefined) continue;
        problems.push({
          path: ["mcpServers", name, "headers", second],
          current: second,
          ...shownName(second),
          fix: SPELLING_FIX,
        });
      }
    }
    return problems;
  },
};
