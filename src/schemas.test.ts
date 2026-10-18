import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const schemasDir = new URL("../schemas/", import.meta.url);

const versions = readdirSync(schemasDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test("at least one schema version is vendored", () => {
  assert.ok(versions.length > 0);
});

for (const version of versions) {
  const folder = new URL(`${version}/`, schemasDir);
  const files = readdirSync(folder).filter((name) =>
    name.endsWith(".schema.json"),
  );

  test(`schemas/${version} has the plugin and mcp schemas`, () => {
    assert.deepEqual(files.sort(), ["mcp.schema.json", "plugin.schema.json"]);
  });

  for (const file of files) {
    test(`schemas/${version}/${file} has the canonical $id`, () => {
      const schema = JSON.parse(
        readFileSync(new URL(file, folder), "utf8"),
      ) as { $id?: unknown };
      assert.equal(
        schema.$id,
        `https://agent-plugins.org/schemas/${version}/${file}`,
      );
    });
  }
}
