import type { Problem, Rule, RuleContext } from "../engine/types.ts";

const MAX_REASON = 80;

/** The part of a JSON.parse message that says what is wrong, without the echoed text. */
function reason(message: string): string {
  const [first = ""] = message.split(
    / in JSON| after JSON|, "| is not valid JSON/,
  );
  return first.length > MAX_REASON ? `${first.slice(0, MAX_REASON)}…` : first;
}

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
          fix: `fix the JSON syntax: ${reason(ctx.parsed.message)}`,
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
