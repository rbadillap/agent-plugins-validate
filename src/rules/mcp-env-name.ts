import type { Problem, Rule, RuleContext } from "../engine/types.ts";
import { mcpServers } from "./mcp-servers.ts";
import { pastedKeyText } from "./pasted-pair.ts";
import { isObject } from "./util.ts";

// One wording for every case: whether the pasted part is a secret can't be known, and the spec gives
// no portable way to pass a credential through "env".
const FIX =
  "remove this entry: env values are visible package data, and the spec forbids credentials in them (§9.2). Let the server get the credential through its own sign-in or a client setting. Rotate it: removing it from the file doesn't remove it from the repository's history.";

/**
 * Tracked in https://github.com/rbadillap/agent-plugins-validate/issues/53. It needs the `approved`
 * label before the release.
 *
 * A name in `env` with "=" in it, usually a pasted `NAME=value`. A process environment can't hold
 * such a name, so the entry can't do what the author meant. No part of the key is repeated.
 */
export const mcpEnvName: Rule = {
  id: "mcp-env-name",
  level: "warning",
  section: "9.2",
  effect:
    "The variable can't be set under that name, so the server starts without the setting the author meant.",
  appliesTo: "mcp",
  check(ctx: RuleContext): Problem[] {
    const problems: Problem[] = [];
    for (const { name, value, shape } of mcpServers(ctx)) {
      if (shape !== "stdio" || !isObject(value.env)) continue;
      for (const key of Object.keys(value.env)) {
        if (!key.includes("=")) continue;
        problems.push({
          path: ["mcpServers", name, "env", key],
          current: key,
          currentText: pastedKeyText(key, "="),
          fix: FIX,
        });
      }
    }
    return problems;
  },
};
