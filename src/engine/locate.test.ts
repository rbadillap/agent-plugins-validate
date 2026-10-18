import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalSchema } from "../rules/schema-version.ts";
import { MINIMAL_PLUGIN } from "../testing/fixtures.ts";
import { check } from "./check.ts";
import { locate, locateParseError } from "./locate.ts";

const MCP_SCHEMA = canonicalSchema("1.0.0", "mcp");

const example = `{
  "$schema": "${MCP_SCHEMA}",
  "mcpServers": {
    "local": {
      "type": "stdio",
      "command": "./bin/server"
    },
    "docs": { "type": "http", "url": "https://docs.example.com/mcp" }
  }
}
`;

test("locate points at the key of the right server, not the first one", () => {
  assert.equal(locate(example, ["mcpServers", "docs", "type"])?.line, 8);
  assert.equal(locate(example, ["mcpServers", "local", "type"])?.line, 5);
});

test("locate gives the column of the key", () => {
  assert.deepEqual(locate(example, ["mcpServers", "docs", "type"]), {
    line: 8,
    column: 15,
  });
});

test("locate points at the key of a value, even when it's an object", () => {
  assert.equal(locate(example, ["mcpServers"])?.line, 3);
  assert.equal(locate(example, ["mcpServers", "docs"])?.line, 8);
});

test("locate points at the opening brace for the whole document", () => {
  assert.deepEqual(locate(`\n\n  {"a": 1}`, []), { line: 3, column: 3 });
});

test("the finding for mcpServers.docs.type is on line 8", () => {
  const { findings } = check({
    root: "",
    plugin: MINIMAL_PLUGIN,
    mcp: { path: "mcp.json", text: example },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.field, "mcpServers.docs.type");
  assert.equal(findings[0]?.line, 8);
});

test("a missing field is reported where its parent's key is", () => {
  assert.equal(locate(example, ["mcpServers", "docs", "headers"])?.line, 8);
  assert.equal(locate(example, ["mcpServers", "local", "url"])?.line, 4);
});

test("a missing field in the root object is reported at the opening brace", () => {
  assert.deepEqual(locate('{\n  "a": 1\n}', ["name"]), { line: 1, column: 1 });
});

test("a missing parent falls back to the closest existing ancestor", () => {
  assert.equal(locate(example, ["mcpServers", "nope", "type"])?.line, 3);
});

test("array items point at the item itself", () => {
  const text = '{\n  "keywords": [\n    "a",\n    3,\n    "c"\n  ]\n}';
  assert.equal(locate(text, ["keywords", 1])?.line, 4);
  assert.equal(locate(text, ["keywords", 2])?.line, 5);
  assert.equal(locate(text, ["keywords"])?.line, 2);
});

test("with duplicate keys the last one wins, as in JSON.parse", () => {
  const text = '{\n  "name": "first",\n  "other": 1,\n  "name": "second"\n}';
  assert.equal(JSON.parse(text).name, "second");
  assert.equal(locate(text, ["name"])?.line, 4);
});

test("a file with \\r\\n gives the same lines as one with \\n", () => {
  const crlf = example.replaceAll("\n", "\r\n");
  assert.equal(locate(crlf, ["mcpServers", "docs", "type"])?.line, 8);
  assert.equal(locate(crlf, ["mcpServers", "local", "command"])?.line, 6);
});

test("a key written with a Unicode escape is found under its decoded name", () => {
  const text = '{\n  "t\\u0079pe": "stdio",\n  "x": 1\n}';
  assert.equal(JSON.parse(text).type, "stdio");
  assert.equal(locate(text, ["type"])?.line, 2);
});

test("keys with dots, spaces and slashes are found", () => {
  const text =
    '{\n  "a": {},\n  "extensions": {\n    "com.example.client": 1\n  },\n  "a/b": 2\n}';
  assert.equal(locate(text, ["extensions", "com.example.client"])?.line, 4);
  assert.equal(locate(text, ["a/b"])?.line, 6);
});

test("the parse error position is where JSON.parse says the text is wrong", () => {
  const text = '{\n  "name": "x",\n  "version": ,\n  "y": 1\n}';
  let message = "";
  try {
    JSON.parse(text);
  } catch (error) {
    message = String((error as Error).message);
  }
  assert.equal(locateParseError(text, message).line, 3);
});

test("the parse error position is found when the message has no position", () => {
  const text = '{\n  "name": }';
  let message = "";
  try {
    JSON.parse(text);
  } catch (error) {
    message = String((error as Error).message);
  }
  assert.equal(locateParseError(text, message).line, 2);
});

test("a file with a comment is a json-syntax error on the comment's line", () => {
  const text = `{\n  // not allowed\n  "$schema": "${MCP_SCHEMA}",\n  "mcpServers": {}\n}`;
  const { findings } = check({
    root: "",
    plugin: MINIMAL_PLUGIN,
    mcp: { path: "mcp.json", text },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.rule, "json-syntax");
  assert.equal(findings[0]?.line, 2);
});

test("a file that is JSON but not an object is reported on the line where the value starts", () => {
  const { findings } = check({
    root: "",
    plugin: { path: "plugin.json", text: "\n\n[1]" },
  });
  assert.equal(findings[0]?.rule, "json-syntax");
  assert.equal(findings[0]?.line, 3);
});

test("JSON.parse stays the authority on validity", () => {
  // jsonc-parser would accept a trailing comma if asked to; the engine never asks it to.
  const text = `{ "$schema": "${MCP_SCHEMA}", "mcpServers": {}, }`;
  const { findings } = check({
    root: "",
    plugin: MINIMAL_PLUGIN,
    mcp: { path: "mcp.json", text },
  });
  assert.equal(findings[0]?.rule, "json-syntax");
});
