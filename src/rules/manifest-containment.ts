import type { Problem, Rule } from "../engine/types.ts";

/**
 * `plugin.json` resolves outside its plugin root, or isn't a regular file. The engine reports it
 * for a file that discovery couldn't hand over (see `unreadableProblem` in the engine); this rule
 * has no check of its own. A client rejects the plugin (§4.1).
 */
export const manifestContainment: Rule = {
  id: "manifest-containment",
  level: "error",
  section: "4.1",
  effect:
    "Clients that follow the spec reject the plugin and load none of its components.",
  appliesTo: "plugin",
  check(): Problem[] {
    return [];
  },
};
