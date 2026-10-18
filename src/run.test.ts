import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../docs/report.schema.json" with { type: "json" };
import type { Context } from "./context.ts";
import { canonicalSchema } from "./rules/schema-version.ts";
import { run } from "./run.ts";
import { createSandbox } from "./testing/sandbox.ts";

const PLUGIN = JSON.stringify({
  $schema: canonicalSchema("1.0.0", "plugin"),
  name: "example-plugin",
});
const GOOD_MCP = JSON.stringify({
  $schema: canonicalSchema("1.0.0", "mcp"),
  mcpServers: {},
});
const BAD_MCP = `{
  "$schema": "${canonicalSchema("1.0.0", "mcp")}",
  "mcpServers": {
    "docs": { "type": "http", "url": "https://docs.example.com/mcp" }
  }
}
`;

const sandbox = createSandbox;
type Sandbox = ReturnType<typeof createSandbox>;

function put(sb: Sandbox, file: string, text: string): void {
  sb.put(file, text);
}

test("a passing repository: exit 0, one sentence, the outputs and a report", async () => {
  const sb = sandbox();
  try {
    put(sb, "plugin.json", PLUGIN);
    put(sb, "mcp.json", GOOD_MCP);
    const code = await run(sb.context(), { io: sb.io });
    assert.equal(code, 0);
    assert.equal(sb.out.join(""), "");
    const summary = sb.files.get(path.join(sb.temp, "summary")) ?? "";
    assert.match(
      summary,
      /^## Agent Plugins manifests\n\nBoth manifests follow the Agent Plugins spec \(1\.0\.0\)\.\n\nIssues: off\./,
    );
    assert.doesNotMatch(summary, /no problems/i);
    const reportPath = path.join(
      sb.temp,
      "agent-plugins-validate",
      "validate",
      "report.json",
    );
    assert.equal(
      sb.files.get(path.join(sb.temp, "output")),
      `valid<<ghadelimiter_r1\ntrue\nghadelimiter_r1\nfindings<<ghadelimiter_r1\n0\nghadelimiter_r1\nreport<<ghadelimiter_r1\n${reportPath}\nghadelimiter_r1\n`,
    );
    const report = JSON.parse(sb.files.get(reportPath) ?? "null");
    assert.equal(report.valid, true);
    assert.deepEqual(
      report.files.map((f: { status: string }) => f.status),
      ["pass", "pass"],
    );
  } finally {
    sb.cleanup();
  }
});

test("an error fails the step, with its annotation, summary and report", async () => {
  const sb = sandbox();
  try {
    put(sb, "plugin.json", PLUGIN);
    put(sb, "mcp.json", BAD_MCP);
    const code = await run(sb.context(), { io: sb.io });
    assert.equal(code, 1);
    const lines = sb.out.join("").trimEnd().split("\n");
    assert.match(
      lines[0] ?? "",
      /^::error file=mcp\.json,line=4,title=mcp-server-type::mcpServers\.docs\.type is "http"\. Use "streamable-http"\.%0AClients/,
    );
    assert.equal(
      lines[1],
      "::error title=agent-plugins-validate::1 error in Agent Plugins manifests.",
    );
    const summary = sb.files.get(path.join(sb.temp, "summary")) ?? "";
    assert.match(
      summary,
      /✅ `plugin\.json` follows the spec\.\n\n❌ `mcp\.json` has 1 thing to fix\./,
    );
    const output = sb.files.get(path.join(sb.temp, "output")) ?? "";
    assert.match(output, /valid<<ghadelimiter_r1\nfalse\n/);
    assert.match(output, /findings<<ghadelimiter_r1\n1\n/);
  } finally {
    sb.cleanup();
  }
});

test("warnings and notices never fail the step", async () => {
  const sb = sandbox();
  try {
    put(
      sb,
      "plugin.json",
      JSON.stringify({
        $schema: canonicalSchema("1.0.0", "plugin"),
        name: "example-plugin",
        version: "v1",
        extra: 1,
      }),
    );
    const code = await run(sb.context(), { io: sb.io });
    assert.equal(code, 0);
    const lines = sb.out.join("").trimEnd().split("\n");
    assert.deepEqual(
      lines.map((l) => l.split(" ")[0]),
      ["::warning", "::notice"],
    );
    const output = sb.files.get(path.join(sb.temp, "output")) ?? "";
    assert.match(output, /valid<<ghadelimiter_r1\ntrue\n/);
    assert.match(output, /findings<<ghadelimiter_r1\n2\n/);
  } finally {
    sb.cleanup();
  }
});

test("a configuration problem fails the step with its own message", async () => {
  const sb = sandbox();
  try {
    put(sb, "plugin.json", PLUGIN);
    const code = await run(
      sb.context({ manifests: "plugin.json\n../x/plugin.json" }),
      { io: sb.io },
    );
    assert.equal(code, 1);
    assert.match(
      sb.out.join(""),
      /^::error title=manifests-invalid-pattern::manifests line 2: "\.\.\/x\/plugin\.json" leaves the repository/,
    );
    const report = JSON.parse(
      sb.files.get(
        path.join(sb.temp, "agent-plugins-validate", "validate", "report.json"),
      ) ?? "null",
    );
    assert.equal(report.valid, false);
    assert.equal(report.configErrors[0].id, "manifests-invalid-pattern");
  } finally {
    sb.cleanup();
  }
});

test("the summary has no issues line on a pull request, and says issues are off elsewhere", async () => {
  const sb = sandbox();
  try {
    put(sb, "plugin.json", PLUGIN);
    await run(sb.context({ eventName: "pull_request" }), { io: sb.io });
    assert.doesNotMatch(
      sb.files.get(path.join(sb.temp, "summary")) ?? "",
      /Issues/,
    );
    sb.files.clear();
    await run(sb.context({ eventName: "pull_request_target" }), { io: sb.io });
    assert.doesNotMatch(
      sb.files.get(path.join(sb.temp, "summary")) ?? "",
      /Issues/,
    );
    sb.files.clear();
    await run(sb.context({ eventName: "schedule" }), { io: sb.io });
    assert.match(
      sb.files.get(path.join(sb.temp, "summary")) ?? "",
      /Issues: off\. \[How to turn issues on\]\(https:\/\/github\.com\/rbadillap\/agent-plugins-validate#issues\)/,
    );
  } finally {
    sb.cleanup();
  }
});

test("two runs in one job write two separate reports", async () => {
  const sb = sandbox();
  try {
    put(sb, "good/plugin.json", PLUGIN);
    put(sb, "bad/plugin.json", PLUGIN);
    put(sb, "bad/mcp.json", BAD_MCP);
    await run(sb.context({ action: "pass", manifests: "good/plugin.json" }), {
      io: sb.io,
    });
    await run(sb.context({ action: "fail", manifests: "bad/plugin.json" }), {
      io: sb.io,
    });
    const first = path.join(
      sb.temp,
      "agent-plugins-validate",
      "pass",
      "report.json",
    );
    const second = path.join(
      sb.temp,
      "agent-plugins-validate",
      "fail",
      "report.json",
    );
    assert.ok(sb.files.has(first) && sb.files.has(second));
    assert.equal(JSON.parse(sb.files.get(first) ?? "{}").valid, true);
    assert.equal(JSON.parse(sb.files.get(second) ?? "{}").valid, false);
  } finally {
    sb.cleanup();
  }
});

test("report.json validates against docs/report.schema.json", async () => {
  const sb = sandbox();
  try {
    const validate = new (Ajv2020 as unknown as typeof Ajv2020.default)({
      strict: false,
      allErrors: true,
    }).compile(schema);
    const cases: [string, Partial<Context>][] = [
      ["good", {}],
      ["bad", {}],
      ["config", { manifests: "../x/plugin.json" }],
    ];
    for (const [name, overrides] of cases) {
      put(sb, "plugin.json", PLUGIN);
      put(sb, "mcp.json", name === "bad" ? BAD_MCP : GOOD_MCP);
      sb.files.clear();
      await run(sb.context({ action: name, ...overrides }), { io: sb.io });
      const text = sb.files.get(
        path.join(sb.temp, "agent-plugins-validate", name, "report.json"),
      );
      const report = JSON.parse(text ?? "null");
      assert.ok(
        validate(report),
        `${name}: ${JSON.stringify(validate.errors)}`,
      );
    }
    assert.ok(!validate({ reportVersion: 2 }));
  } finally {
    sb.cleanup();
  }
});

test("hostile text in the repository reaches no surface unescaped", async () => {
  const sb = sandbox();
  try {
    put(sb, "plugin.json", PLUGIN);
    const nasty = "`a` | <img src=x> @octocat";
    put(
      sb,
      "mcp.json",
      JSON.stringify({
        $schema: canonicalSchema("1.0.0", "mcp"),
        mcpServers: {
          [nasty]: { type: "http", url: "https://docs.example.com/mcp" },
          ok: { type: "stdio", command: "node", env: { [nasty]: 3 } },
        },
      }),
    );
    await run(sb.context(), { io: sb.io });
    const summary = sb.files.get(path.join(sb.temp, "summary")) ?? "";
    assert.doesNotMatch(summary, /<img|@octocat/);
    for (const line of sb.out.join("").trimEnd().split("\n")) {
      assert.match(line, /^::(error|warning|notice)[ ]/);
    }
  } finally {
    sb.cleanup();
  }
});
