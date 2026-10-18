import type { Problem, Rule, RuleContext } from "../engine/types.ts";
import { isObject } from "./util.ts";

// At least two dot-separated labels of letters, digits and hyphens.
const REVERSE_DOMAIN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function suggestNamespace(key: string): string {
  const cleaned = key
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (cleaned === "") return "com.example.myclient";
  return REVERSE_DOMAIN.test(cleaned) ? cleaned : `com.example.${cleaned}`;
}

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
        fix: `use a reverse-domain name, e.g. ${JSON.stringify(suggestNamespace(key))}`,
      }));
  },
};
