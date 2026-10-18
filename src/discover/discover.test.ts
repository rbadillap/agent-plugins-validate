import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { check } from "../engine/check.ts";
import type { PluginInput } from "../engine/types.ts";
import { canonicalSchema } from "../rules/schema-version.ts";
import { discover, isInsideWorkspace } from "./discover.ts";
import { canMatchManifest, parseLines, rejectReason } from "./patterns.ts";

const PLUGIN = JSON.stringify({
  $schema: canonicalSchema("1.0.0", "plugin"),
  name: "example-plugin",
});
const MCP = JSON.stringify({
  $schema: canonicalSchema("1.0.0", "mcp"),
  mcpServers: {},
});

/** A temporary repository, and a folder next to it for things outside the repository. */
function sandbox(): { repo: string; outside: string; cleanup: () => void } {
  const base = mkdtempSync(path.join(tmpdir(), "apv-discover-"));
  const repo = path.join(base, "repo");
  const outside = path.join(base, "outside");
  mkdirSync(repo);
  mkdirSync(outside);
  return {
    repo,
    outside,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

function put(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

async function run(repo: string, manifests: string) {
  return discover({ workspace: repo, manifests });
}

function findings(plugins: PluginInput[]) {
  return plugins.flatMap((plugin) => check(plugin).findings);
}

test("blank lines and comments are ignored", () => {
  const lines = parseLines("\n# the plugin\nplugin.json\n  \n  mcp.json  \n");
  assert.deepEqual(
    lines.map((l) => [l.number, l.text]),
    [
      [3, "plugin.json"],
      [5, "mcp.json"],
    ],
  );
});

test("lines that leave the repository, or could expand to do so, are rejected before any access", () => {
  const rejected = [
    "../shared/plugin.json",
    "a/../plugin.json",
    "a..b/plugin.json",
    "{..,sub}/outside/plugin.json",
    "@(..)/plugin.json",
    "!(x)/plugin.json",
    "plugins\\a\\plugin.json",
    "/etc/plugin.json",
    "C:/x/plugin.json",
    "C:\\x\\plugin.json",
    "{a,b}/plugin.json",
    "**/*.yaml",
    "plugins/*/settings.json",
  ];
  for (const line of rejected) {
    assert.notEqual(rejectReason(line), null, line);
  }
});

test("plain segments, *, **, ? and [...] are accepted", () => {
  for (const line of [
    "plugin.json",
    "mcp.json",
    "plugins/*/plugin.json",
    "**/plugin.json",
    "**/*.json",
    "*.json",
    "plugins/?/mcp.json",
    "plugins/[ab]/plugin.json",
    "plugins/**",
  ]) {
    assert.equal(rejectReason(line), null, line);
    assert.ok(canMatchManifest(line), line);
  }
});

test("a rejected line fails the step with a message that names the line, and reads nothing", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugin.json", PLUGIN);
    const result = await run(sb.repo, "plugin.json\n../shared/plugin.json");
    assert.deepEqual(result.configErrors, [
      {
        id: "manifests-invalid-pattern",
        message:
          'manifests line 2: "../shared/plugin.json" leaves the repository. Use a path inside it, e.g. "shared/plugin.json".',
      },
    ]);
    assert.deepEqual(result.plugins, []);
  } finally {
    sb.cleanup();
  }
});

test("the default input reads plugin.json and mcp.json at the root", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugin.json", PLUGIN);
    put(sb.repo, "mcp.json", MCP);
    const result = await run(sb.repo, "plugin.json\nmcp.json");
    assert.deepEqual(result.configErrors, []);
    assert.equal(result.plugins.length, 1);
    assert.equal(result.plugins[0]?.root, "");
    assert.deepEqual(findings(result.plugins), []);
  } finally {
    sb.cleanup();
  }
});

test("the default input without plugin.json is one plugin-manifest-missing error; a missing mcp.json is fine", async () => {
  const sb = sandbox();
  try {
    const none = await run(sb.repo, "plugin.json\nmcp.json");
    assert.deepEqual(
      findings(none.plugins).map((f) => [f.rule, f.level, f.file, f.fix]),
      [
        [
          "plugin-manifest-missing",
          "error",
          "plugin.json",
          "add plugin.json at the repository root, or set the manifests input to where your plugin lives",
        ],
      ],
    );
    put(sb.repo, "mcp.json", MCP);
    const onlyMcp = await run(sb.repo, "plugin.json\nmcp.json");
    assert.deepEqual(
      findings(onlyMcp.plugins).map((f) => f.rule),
      ["plugin-manifest-missing"],
    );
    put(sb.repo, "plugin.json", PLUGIN);
    rmSync(path.join(sb.repo, "mcp.json"));
    const onlyPlugin = await run(sb.repo, "plugin.json\nmcp.json");
    assert.deepEqual(findings(onlyPlugin.plugins), []);
  } finally {
    sb.cleanup();
  }
});

test("a pattern with no match fails; the default input does not", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugin.json", PLUGIN);
    const result = await run(sb.repo, "plugin.json\nplugins/*/plugin.json");
    assert.deepEqual(result.configErrors, [
      {
        id: "manifests-no-match",
        message: 'manifests line 2: "plugins/*/plugin.json" matched no file',
      },
    ]);
  } finally {
    sb.cleanup();
  }
});

test("plugins/*/plugin.json yields one root per plugin, each with its own mcp.json", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugins/a/plugin.json", PLUGIN);
    put(sb.repo, "plugins/a/mcp.json", MCP);
    put(sb.repo, "plugins/b/plugin.json", PLUGIN);
    put(sb.repo, "plugins/b/mcp.json", MCP);
    put(sb.repo, "plugins/c/skills.json", "{}");
    const result = await run(sb.repo, "plugins/*/plugin.json");
    assert.deepEqual(result.configErrors, []);
    assert.deepEqual(
      result.plugins.map((p) => [p.root, p.plugin?.path, p.mcp?.path]),
      [
        ["plugins/a", "plugins/a/plugin.json", "plugins/a/mcp.json"],
        ["plugins/b", "plugins/b/plugin.json", "plugins/b/mcp.json"],
      ],
    );
    assert.deepEqual(findings(result.plugins), []);
  } finally {
    sb.cleanup();
  }
});

test("only files named plugin.json or mcp.json are read, and .git and node_modules are skipped", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugin.json", PLUGIN);
    put(sb.repo, "node_modules/x/plugin.json", PLUGIN);
    put(sb.repo, ".git/plugin.json", PLUGIN);
    put(sb.repo, "settings.json", "{}");
    const result = await run(sb.repo, "**/*.json");
    assert.deepEqual(
      result.plugins.map((p) => p.root),
      [""],
    );
  } finally {
    sb.cleanup();
  }
});

test("a symlinked plugin.json pointing outside the repository is not read", async () => {
  const sb = sandbox();
  try {
    put(sb.outside, "secret.json", '{"name":"s3cr3t-outside"}');
    symlinkSync(
      path.join(sb.outside, "secret.json"),
      path.join(sb.repo, "plugin.json"),
    );
    const result = await run(sb.repo, "plugin.json");
    const [finding] = findings(result.plugins);
    assert.equal(finding?.rule, "manifest-containment");
    assert.equal(finding?.level, "error");
    assert.equal(finding?.fix, "replace the symlink with the file itself");
    assert.match(finding?.current ?? "", /^symbolic link \(\d+ chars\)$/);
    assert.ok(!JSON.stringify(result).includes("s3cr3t-outside"));
    assert.ok(!JSON.stringify(findings(result.plugins)).includes(sb.outside));
  } finally {
    sb.cleanup();
  }
});

test("a symlinked plugin.json pointing elsewhere in the repository, outside its plugin root, is not read", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "other/plugin.json", PLUGIN);
    mkdirSync(path.join(sb.repo, "plugins/a"), { recursive: true });
    symlinkSync(
      path.join(sb.repo, "other/plugin.json"),
      path.join(sb.repo, "plugins/a/plugin.json"),
    );
    const result = await run(sb.repo, "plugins/a/plugin.json");
    assert.deepEqual(
      findings(result.plugins).map((f) => f.rule),
      ["manifest-containment"],
    );
  } finally {
    sb.cleanup();
  }
});

test("a symlinked plugin.json inside its plugin root is read", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugins/a/real.json", PLUGIN);
    symlinkSync("real.json", path.join(sb.repo, "plugins/a/plugin.json"));
    const result = await run(sb.repo, "plugins/a/plugin.json");
    assert.equal(
      result.plugins[0]?.plugin && "text" in result.plugins[0].plugin,
      true,
    );
    assert.deepEqual(findings(result.plugins), []);
  } finally {
    sb.cleanup();
  }
});

test("a symlinked mcp.json pointing outside is mcp-component-location", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugin.json", PLUGIN);
    put(sb.outside, "mcp.json", MCP);
    symlinkSync(
      path.join(sb.outside, "mcp.json"),
      path.join(sb.repo, "mcp.json"),
    );
    const result = await run(sb.repo, "plugin.json");
    const found = findings(result.plugins);
    assert.deepEqual(
      found.map((f) => f.rule),
      ["mcp-component-location"],
    );
    assert.equal(found[0]?.fix, "replace the symlink with the file itself");
  } finally {
    sb.cleanup();
  }
});

test("a symlinked directory is skipped, however it is reached", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "real/plugin.json", PLUGIN);
    symlinkSync(path.join(sb.repo, "real"), path.join(sb.repo, "linked"));
    for (const pattern of [
      "linked/plugin.json",
      "*/plugin.json",
      "**/plugin.json",
    ]) {
      const result = await run(sb.repo, pattern);
      const roots = result.plugins.map((p) => p.root);
      assert.ok(!roots.includes("linked"), pattern);
      if (pattern === "linked/plugin.json") {
        assert.deepEqual(roots, [], pattern);
        assert.deepEqual(result.warnings, [
          "linked is a symlinked directory; linked/plugin.json was not read.",
        ]);
      }
    }
  } finally {
    sb.cleanup();
  }
});

test("a directory named plugin.json is not-a-file", async () => {
  const sb = sandbox();
  try {
    mkdirSync(path.join(sb.repo, "plugin.json"));
    const result = await run(sb.repo, "plugin.json");
    const [finding] = findings(result.plugins);
    assert.equal(finding?.rule, "manifest-containment");
    assert.equal(finding?.current, "(directory)");
    assert.equal(
      finding?.fix,
      "make plugin.json a regular file in the plugin root",
    );
  } finally {
    sb.cleanup();
  }
});

test("a FIFO named mcp.json is not read and does not block", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugin.json", PLUGIN);
    execFileSync("mkfifo", [path.join(sb.repo, "mcp.json")]);
    const result = await run(sb.repo, "plugin.json");
    const found = findings(result.plugins);
    assert.deepEqual(
      found.map((f) => f.rule),
      ["mcp-component-location"],
    );
    assert.equal(found[0]?.current, "(FIFO)");
    assert.equal(
      found[0]?.fix,
      "make mcp.json a regular file in the plugin root",
    );
  } finally {
    sb.cleanup();
  }
});

test("more than 100 matches fail the step", async () => {
  const sb = sandbox();
  try {
    for (let i = 0; i < 101; i++) put(sb.repo, `p${i}/plugin.json`, PLUGIN);
    const result = await run(sb.repo, "*/plugin.json");
    assert.deepEqual(
      result.configErrors.map((e) => e.id),
      ["manifests-too-many"],
    );
    assert.equal(result.plugins.length, 0);
    const exactly = sandbox();
    try {
      for (let i = 0; i < 100; i++)
        put(exactly.repo, `p${i}/plugin.json`, PLUGIN);
      const ok = await run(exactly.repo, "*/plugin.json");
      assert.deepEqual(ok.configErrors, []);
      assert.equal(ok.plugins.length, 100);
    } finally {
      exactly.cleanup();
    }
  } finally {
    sb.cleanup();
  }
});

test("a file over 1 MiB is not read", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugin.json", PLUGIN);
    put(sb.repo, "mcp.json", " ".repeat(2 * 1024 * 1024));
    const result = await run(sb.repo, "plugin.json");
    assert.deepEqual(result.configErrors, [
      {
        id: "manifest-too-large",
        message:
          "mcp.json is larger than 1 MiB; manifests are small JSON files, so check that this is the right file",
      },
    ]);
  } finally {
    sb.cleanup();
  }
});

test("a leading BOM is stripped", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugin.json", `\uFEFF${PLUGIN}`);
    const result = await run(sb.repo, "plugin.json");
    const entry = result.plugins[0]?.plugin;
    assert.ok(entry && "text" in entry);
    assert.equal(entry.text, PLUGIN);
    assert.deepEqual(findings(result.plugins), []);
  } finally {
    sb.cleanup();
  }
});

test("no output holds the path of the runner", async () => {
  const sb = sandbox();
  try {
    symlinkSync(
      path.join(sb.outside, "nowhere.json"),
      path.join(sb.repo, "plugin.json"),
    );
    put(sb.repo, "mcp.json", "{ not json");
    const result = await run(sb.repo, "plugin.json");
    const everything = JSON.stringify([result, findings(result.plugins)]);
    assert.ok(!everything.includes(sb.repo));
    assert.ok(!everything.includes(sb.outside));
  } finally {
    sb.cleanup();
  }
});

test("the engine reports a file it was not handed, without reading anything", () => {
  const input: PluginInput = {
    root: "plugins/a",
    plugin: {
      path: "plugins/a/plugin.json",
      unreadable: "outside-root",
      detail: "symbolic link (21 chars)",
    },
    mcp: { path: "plugins/a/mcp.json", text: MCP },
  };
  const result = check(input);
  assert.deepEqual(
    result.findings.map((f) => [f.rule, f.file, f.field, f.current]),
    [
      [
        "manifest-containment",
        "plugins/a/plugin.json",
        "(root)",
        "symbolic link (21 chars)",
      ],
    ],
  );
  assert.deepEqual(
    result.files.map((f) => [f.file, f.specVersion]),
    [
      ["plugins/a/plugin.json", null],
      ["plugins/a/mcp.json", "1.0.0"],
    ],
  );
});

test("classes that spell '.' or '..' are refused before any access", () => {
  for (const line of [
    "[.][.]/outside/plugin.json",
    ".[.]/outside/plugin.json",
    "[.]./outside/plugin.json",
    "a/[.][.]/plugin.json",
    ".[.]/**/plugin.json",
    "[.][.]/*/plugin.json",
  ]) {
    assert.match(rejectReason(line) ?? "", /could match "\." or "\.\."/, line);
  }
  for (const line of [
    "./plugin.json",
    "*/plugin.json",
    "**/plugin.json",
    "plugins/?/mcp.json",
    "a.b/plugin.json",
    "[ab]/plugin.json",
  ]) {
    assert.equal(rejectReason(line), null, line);
  }
});

test("a pattern that spells '..' with a class never reads the folder above", async () => {
  const sb = sandbox();
  try {
    put(sb.repo, "plugin.json", PLUGIN);
    put(sb.outside, "outside/plugin.json", '{"name":"s3cr3t-outside"}');
    for (const line of [
      "[.][.]/outside/plugin.json",
      ".[.]/outside/plugin.json",
      "[.]./outside/plugin.json",
    ]) {
      const result = await run(sb.repo, line);
      assert.deepEqual(result.plugins, [], line);
      assert.equal(
        result.configErrors[0]?.id,
        "manifests-invalid-pattern",
        line,
      );
      assert.ok(!JSON.stringify(result).includes("s3cr3t-outside"), line);
    }
  } finally {
    sb.cleanup();
  }
});

test("a match outside the workspace is refused even if a pattern got through", () => {
  const workspace = "/work/repo";
  for (const relative of [
    "../outside/plugin.json",
    "a/../../x/plugin.json",
    "./plugin.json",
    "a//plugin.json",
    "/etc/plugin.json",
    "",
  ]) {
    assert.equal(isInsideWorkspace(workspace, relative), false, relative);
  }
  for (const relative of [
    "plugin.json",
    "a/b/plugin.json",
    "a..b/plugin.json",
  ]) {
    assert.equal(isInsideWorkspace(workspace, relative), true, relative);
  }
});

test("a very large match set fails with manifests-too-many", async () => {
  const sb = sandbox();
  try {
    for (let i = 0; i < 150; i++) put(sb.repo, `p${i}/plugin.json`, PLUGIN);
    const result = await run(sb.repo, "**/plugin.json");
    assert.deepEqual(
      result.configErrors.map((e) => e.id),
      ["manifests-too-many"],
    );
  } finally {
    sb.cleanup();
  }
});
