import type { Problem, Rule, RuleContext } from "../engine/types.ts";
import { isObject, shownName } from "./util.ts";

// At least two dot-separated labels of letters, digits and hyphens.
const REVERSE_DOMAIN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export const extensionsNamespace: Rule = {
  id: "extensions-namespace",
  level: "warning",
  section: "8",
  effect:
    "Clients ignore a namespace they don't implement, so this only matters to the client that owns it.",
  appliesTo: "plugin",
  check(ctx: RuleContext): Problem[] {
    if (!ctx.parsed.ok || !isObject(ctx.parsed.value)) return [];
    const extensions = ctx.parsed.value.extensions;
    if (!isObject(extensions)) return [];
    return Object.keys(extensions)
      .filter((key) => !REVERSE_DOMAIN.test(key))
      .map((key) => ({
        path: ["extensions", key],
        current: key,
        ...shownName(key),
        fix: 'the namespace is the reverse domain of the client these settings are for, e.g. "com.example.myclient" for a client at example.com. Use the namespace that client documents: the client reads its settings by this key, so a guessed name means it stops reading them',
      }));
  },
};
