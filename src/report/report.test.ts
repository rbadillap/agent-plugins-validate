import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding } from "../engine/types.ts";
import { annotation, annotationMessage } from "./annotations.ts";
import { codeSpan, escapeData, escapeProperty, renderFix } from "./escape.ts";
import { outputBlock } from "./io.ts";
import { safeStepName } from "./report.ts";
import { ISSUES_OFF, renderSummary } from "./summary.ts";
import type { FileResult, RunResult } from "./types.ts";

const SPEC =
  "https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md#721-discovery-and-configuration";

const http: Finding = {
  rule: "mcp-server-type",
  level: "error",
  file: "mcp.json",
  field: "mcpServers.docs.type",
  current: '"http"',
  fix: 'use "streamable-http"',
  spec: SPEC,
  line: 4,
};

test("the annotation of a finding is the one in the README", () => {
  assert.equal(
    annotation(http, "mcp"),
    `::error file=mcp.json,line=4,title=mcp-server-type::mcpServers.docs.type is "http". Use "streamable-http".%0AClients that follow the spec skip this server until it's fixed. Spec: §7.2.1 ${SPEC}`,
  );
});

test("a missing value reads 'is missing', and a fix that ends with a period gets no second one", () => {
  const missing: Finding = {
    ...http,
    rule: "required-fields",
    field: "name",
    current: "(missing)",
    fix: "add a name.",
    file: "plugin.json",
    spec: SPEC.replace(
      "#721-discovery-and-configuration",
      "#53-required-fields",
    ),
  };
  assert.match(
    annotationMessage(missing, "plugin"),
    /^name is missing\. Add a name\.\n/,
  );
});

test("a finding with no line has no line property", () => {
  const { line: _line, ...rest } = http;
  assert.match(
    annotation(rest, "mcp"),
    /^::error file=mcp\.json,title=mcp-server-type::/,
  );
});

test("annotation properties and data are escaped", () => {
  assert.equal(escapeProperty("a%b:c,d\ne\rf"), "a%25b%3Ac%2Cd%0Ae%0Df");
  assert.equal(escapeData("a%b:c,d\ne\rf"), "a%25b:c,d%0Ae%0Df");
  const hostile: Finding = {
    ...http,
    file: "dir,with:odd%name\n::error::injected.json",
    field: "a%b:c,d\n::notice::x",
    current: "string (5 chars)\n::error::y",
  };
  const text = annotation(hostile, "mcp");
  assert.equal(text.split("\n").length, 1);
  assert.match(
    text,
    /^::error file=dir%2Cwith%3Aodd%25name%0A%3A%3Aerror%3A%3Ainjected\.json,line=4,title=mcp-server-type::/,
  );
});

test("code spans use a fence longer than any run of backticks", () => {
  assert.equal(codeSpan("a"), "`a`");
  assert.equal(codeSpan("a`b"), "``a`b``");
  assert.equal(codeSpan("a``b`c"), "```a``b`c```");
  assert.equal(codeSpan("`a`"), "`` `a` ``");
  assert.equal(codeSpan("a|b"), "`a\\|b`");
  assert.equal(codeSpan("a\nb\r\nc"), "`a↵b↵c`");
});

test("a fix keeps its quoted examples as code and escapes the rest", () => {
  assert.equal(renderFix('use "streamable-http"'), 'use `"streamable-http"`');
  assert.equal(
    renderFix("<img src=x> @octocat | [a](b)"),
    "\\<img src=x\\> &#64;octocat \\| \\[a\\](b)",
  );
});

function file(
  name: string,
  status: FileResult["status"],
  kind: FileResult["kind"] = "plugin",
): FileResult {
  return { file: name, kind, specVersion: "1.0.0", status };
}

function result(files: FileResult[], findings: Finding[] = []): RunResult {
  return { files, findings, configErrors: [], warnings: [] };
}

test("everything passes: one sentence for two files, one file, and more", () => {
  const two = renderSummary(
    result([file("plugin.json", "pass"), file("mcp.json", "pass", "mcp")]),
    {
      issuesLine: ISSUES_OFF,
    },
  );
  assert.equal(
    two,
    `## Agent Plugins manifests\n\nBoth manifests follow the Agent Plugins spec (1.0.0).\n\n${ISSUES_OFF}\n`,
  );
  const one = renderSummary(result([file("plugin.json", "pass")]), {
    issuesLine: ISSUES_OFF,
  });
  assert.match(
    one,
    /^## Agent Plugins manifests\n\n`plugin\.json` follows the Agent Plugins spec \(1\.0\.0\)\.\n/,
  );
  const four = renderSummary(
    result(["a", "b", "c", "d"].map((n) => file(`${n}/plugin.json`, "pass"))),
    { issuesLine: null },
  );
  assert.equal(
    four,
    "## Agent Plugins manifests\n\nAll 4 manifests follow the Agent Plugins spec (1.0.0).\n",
  );
});

test("a mix gives one line per file, passing files first, then one table", () => {
  const findings: Finding[] = [
    http,
    {
      ...http,
      rule: "extensions-type",
      level: "warning",
      file: "plugin.json",
      field: "extensions",
      current: "array (0 items)",
      fix: "use an object",
      line: 5,
    },
    {
      ...http,
      rule: "version-semver",
      level: "notice",
      file: "plugin.json",
      field: "version",
      current: "string (3 chars)",
      fix: "use a version",
      line: 3,
    },
  ];
  const summary = renderSummary(
    result(
      [file("mcp.json", "fail", "mcp"), file("plugin.json", "warn")],
      findings,
    ),
    { issuesLine: null },
  );
  assert.equal(
    summary,
    [
      "## Agent Plugins manifests",
      "",
      "⚠️ `plugin.json` loads, with 1 warning.",
      "",
      "❌ `mcp.json` has 1 thing to fix.",
      "",
      "| | File | Field | Now | How to fix | Spec |",
      "|---|---|---|---|---|---|",
      `| ❌ | \`mcp.json\` | \`mcpServers.docs.type\` | \`"http"\` | use \`"streamable-http"\` | [§7.2.1](${SPEC}) |`,
      `| ⚠️ | \`plugin.json\` | \`extensions\` | \`array (0 items)\` | use an object | [§7.2.1](${SPEC}) |`,
      `| ℹ️ | \`plugin.json\` | \`version\` | \`string (3 chars)\` | use a version | [§7.2.1](${SPEC}) |`,
      "",
    ].join("\n"),
  );
});

test("lines for notices only, warnings only, and several errors", () => {
  const notice: Finding = { ...http, level: "notice", file: "plugin.json" };
  assert.match(
    renderSummary(result([file("plugin.json", "pass")], [notice]), {
      issuesLine: null,
    }),
    /✅ `plugin\.json` follows the spec, with 1 suggestion\./,
  );
  assert.match(
    renderSummary(
      result(
        [file("plugin.json", "pass")],
        [notice, { ...notice, field: "x" }],
      ),
      { issuesLine: null },
    ),
    /with 2 suggestions\./,
  );
  const errors = [http, { ...http, field: "mcpServers.other.type" }];
  assert.match(
    renderSummary(result([file("mcp.json", "fail", "mcp")], errors), {
      issuesLine: null,
    }),
    /❌ `mcp\.json` has 2 things to fix\./,
  );
});

test("the words 'no problems' and 'no errors found' never appear", () => {
  const summaries = [
    renderSummary(result([file("plugin.json", "pass")]), {
      issuesLine: ISSUES_OFF,
    }),
    renderSummary(result([]), { issuesLine: null }),
    renderSummary(result([file("mcp.json", "fail", "mcp")], [http]), {
      issuesLine: null,
    }),
  ];
  for (const text of summaries) {
    assert.doesNotMatch(text, /no problems|no errors found|nothing to fix/i);
  }
});

test("a file path with markup renders as inert text", () => {
  const nasty = "dir/`a` | <img src=x onerror=alert(1)> @octocat/plugin.json";
  const summary = renderSummary(
    result(
      [file(nasty, "fail")],
      [{ ...http, file: nasty, field: "[…].x", current: "`b` | <b>" }],
    ),
    { issuesLine: null },
  );
  assert.ok(
    summary.includes(
      "``dir/`a` \\| <img src=x onerror=alert(1)> @octocat/plugin.json``",
    ),
  );
  assert.ok(
    summary.includes("`` `b` \\| <b>``") ||
      summary.includes("`` `b` \\| <b> ``") ||
      summary.includes("`` `b` \\| <b>``".trim()),
  );
  // Outside code spans there is nothing from the repository.
  const outside = summary.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, "");
  assert.doesNotMatch(outside, /<img|@octocat|onerror/);
});

test("the issues line is the last line, and pull requests have none", () => {
  const off = renderSummary(result([file("plugin.json", "pass")]), {
    issuesLine: ISSUES_OFF,
  });
  assert.ok(off.trimEnd().endsWith(ISSUES_OFF));
  const pr = renderSummary(result([file("plugin.json", "pass")]), {
    issuesLine: null,
  });
  assert.doesNotMatch(pr, /Issues/);
});

test("configuration problems and skipped files are listed in code spans", () => {
  const summary = renderSummary(
    {
      files: [],
      findings: [],
      configErrors: [
        {
          id: "manifests-no-match",
          message: 'manifests line 2: "x`y" matched no file',
        },
      ],
      warnings: ["a is a symlinked directory; a/plugin.json was not read."],
    },
    { issuesLine: null },
  );
  assert.match(
    summary,
    /- `manifests-no-match`: ``manifests line 2: "x`y" matched no file``/,
  );
  assert.match(summary, /\*\*Skipped\*\*/);
});

test("output blocks use a delimiter that a value cannot guess", () => {
  const block = outputBlock("report", "/tmp/x/report.json", "abc123");
  assert.equal(
    block,
    "report<<ghadelimiter_abc123\n/tmp/x/report.json\nghadelimiter_abc123\n",
  );
});

test("a step id becomes a safe folder name", () => {
  assert.equal(safeStepName("pass"), "pass");
  assert.equal(safeStepName("__run_2"), "__run_2");
  assert.equal(safeStepName("../../etc/x"), "______etc_x");
  assert.equal(safeStepName("a\nghadelimiter_x\nb"), "a_ghadelimiter_x_b");
  assert.equal(safeStepName(""), "step");
  assert.equal(safeStepName("///"), "step");
  assert.equal(safeStepName("x".repeat(500)).length, 100);
});
