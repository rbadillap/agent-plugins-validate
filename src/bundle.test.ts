import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// The engine depends on packages with several builds (jsonc-parser has a UMD one that can't be
// bundled). This builds the engine the way `make build` does and runs the result, so a change to the
// build flags can't break the bundle unnoticed.
test("the bundled engine runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "apv-bundle-"));
  try {
    const entry = join(dir, "entry.ts");
    const out = join(dir, "out.mjs");
    const engine = fileURLToPath(new URL("./engine/check.ts", import.meta.url));
    const text = JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        docs: { type: "http", url: "https://docs.example.com/mcp" },
      },
    });
    writeFileSync(
      entry,
      `import { check } from ${JSON.stringify(engine)};
console.log(JSON.stringify(check({ root: "", mcp: { path: "mcp.json", text: ${JSON.stringify(text)} } }).findings));`,
    );
    const build = spawnSync(
      "make",
      ["-s", "build", `ENTRY=${entry}`, `OUT=${out}`],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    assert.equal(build.status, 0, build.stderr);
    const run = spawnSync(process.execPath, [out], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const findings = JSON.parse(run.stdout) as {
      rule: string;
      fix: string;
      line: number;
    }[];
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.rule, "mcp-server-type");
    assert.equal(findings[0]?.fix, 'use "streamable-http"');
    assert.equal(findings[0]?.line, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
