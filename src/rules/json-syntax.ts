import type { Problem, Rule, RuleContext } from "../engine/types.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const jsonSyntax: Rule = {
  id: "json-syntax",
  level: "error",
  section: "5.2",
  sections: { mcp: "7.2.2" },
  effect:
    "Clients that follow the spec reject the plugin and load none of its components.",
  effects: {
    mcp: "Clients that follow the spec turn off MCP for this plugin.",
  },
  appliesTo: "both",
  gate: true,
  check(ctx: RuleContext): Problem[] {
    if (!ctx.parsed.ok) {
      if (ctx.text.startsWith("\uFEFF")) {
        return [
          {
            path: [],
            current: undefined,
            currentText: "(not valid JSON)",
            fix: "remove the byte order mark at the start of the file",
          },
        ];
      }
      return [
        {
          path: [],
          current: undefined,
          currentText: "(not valid JSON)",
          fix: "fix the JSON syntax at this line: check commas, quotes and brackets",
        },
      ];
    }
    if (!isObject(ctx.parsed.value)) {
      return [
        { path: [], current: ctx.parsed.value, fix: "use a JSON object" },
      ];
    }
    return [];
  },
};
