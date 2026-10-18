import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FakeGitHub } from "../testing/github.ts";
import { ApiError, createClient, encodePath } from "./api.ts";

const BEFORE = "b".repeat(40);

function client(gh: FakeGitHub, apiUrl = gh.origin) {
  return createClient({
    apiUrl,
    token: "tok",
    repository: gh.repository,
    fetch: gh.fetch,
  });
}

function sources(dir: string): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      found.push({ file: full, text: readFileSync(full, "utf8") });
    }
  }
  return found;
}

test("fetch is used only in src/github/api.ts", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const network =
    /\bfetch\s*\(|globalThis\.fetch|(?:from|import)\s*["'](?:node:)?(?:https?|http2|net|tls|dns|dgram)["']|\bXMLHttpRequest\b|\bWebSocket\b/;
  const users = sources(root)
    .filter(({ text }) => network.test(text))
    .map(({ file }) => path.relative(root, file));
  // The test helper in src/testing implements a fake `fetch`, but never calls the network.
  assert.deepEqual(
    users.filter((file) => !file.startsWith("testing")),
    ["github/api.ts"],
  );
});

test("every request goes to GITHUB_API_URL, with no redirects, and carries the token", async () => {
  const gh = new FakeGitHub();
  gh.commits.add(BEFORE);
  const api = client(gh);
  assert.equal(await api.commitExists(BEFORE), true);
  assert.equal(await api.commitExists("c".repeat(40)), false);
  await api.getUser();
  assert.ok(gh.requests.length >= 3);
});

test("an API URL with a path prefix keeps every request under it", async () => {
  const seen: string[] = [];
  const api = createClient({
    apiUrl: "https://ghe.example.test/api/v3",
    token: "tok",
    repository: "example/repo",
    fetch: async (input) => {
      seen.push(new URL(input instanceof Request ? input.url : input).href);
      return new Response("{}", { status: 404 });
    },
  });
  await api.getContents("a b/plugin.json", BEFORE);
  assert.deepEqual(seen, [
    `https://ghe.example.test/api/v3/repos/example/repo/contents/a%20b/plugin.json?ref=${BEFORE}`,
  ]);
});

test("the headers carry the bearer token and redirects are refused", async () => {
  let seen: RequestInit | undefined;
  const api = createClient({
    apiUrl: "https://api.example.test",
    token: "tok-123",
    repository: "example/repo",
    fetch: async (_url, init) => {
      seen = init;
      return new Response("{}", { status: 404 });
    },
  });
  await api.getContents("plugin.json", BEFORE);
  assert.equal(seen?.redirect, "error");
  assert.equal(
    (seen?.headers as Record<string, string> | undefined)?.authorization,
    "Bearer tok-123",
  );
  assert.ok(seen?.signal instanceof AbortSignal);
});

test("a redirect is an error, not a request to somewhere else", async () => {
  const api = createClient({
    apiUrl: "https://api.example.test",
    token: "tok",
    repository: "example/repo",
    fetch: async (_url, init) => {
      if (init?.redirect === "error")
        throw new TypeError("redirect mode is set to error");
      return new Response("{}");
    },
  });
  await assert.rejects(
    api.getUser(),
    (error: unknown) => error instanceof ApiError && error.kind === "network",
  );
});

test("path segments are encoded one by one", () => {
  assert.equal(
    encodePath("a b/c#d/e?f/plugin.json"),
    "a%20b/c%23d/e%3Ff/plugin.json",
  );
  assert.equal(encodePath("plugin.json"), "plugin.json");
});

test("contents: a file, an absent file, and ones that cannot be used", async () => {
  const gh = new FakeGitHub();
  const api = client(gh);
  gh.contents.set(`${BEFORE}:a.json`, "﻿{}");
  gh.contents.set(`${BEFORE}:link.json`, { type: "symlink" });
  gh.contents.set(`${BEFORE}:big.json`, { size: "big" });
  assert.deepEqual(await api.getContents("a.json", BEFORE), {
    status: "ok",
    text: "{}",
  });
  assert.deepEqual(await api.getContents("missing.json", BEFORE), {
    status: "absent",
  });
  assert.deepEqual(await api.getContents("link.json", BEFORE), {
    status: "unusable",
  });
  assert.deepEqual(await api.getContents("big.json", BEFORE), {
    status: "unusable",
  });
});

test("errors are sorted into kinds", async () => {
  const kinds: [string, number, Record<string, string>, string][] = [
    [
      "rate limit by count",
      403,
      { "x-ratelimit-remaining": "0" },
      "rate-limit",
    ],
    ["rate limit by retry-after", 403, { "retry-after": "5" }, "rate-limit"],
    ["429", 429, {}, "rate-limit"],
    ["permission", 403, {}, "forbidden"],
    ["gone", 410, {}, "gone"],
    ["server", 500, {}, "other"],
  ];
  for (const [name, status, headers, kind] of kinds) {
    const gh = new FakeGitHub();
    gh.failures.set("GET /repos/example/repo/issues", { status, headers });
    await assert.rejects(
      client(gh).listIssues("x", 1),
      (e: unknown) => e instanceof ApiError && e.kind === kind,
      name,
    );
  }
});

test("the client makes only the requests it needs: no deletes, no other endpoints", async () => {
  const gh = new FakeGitHub();
  const api = client(gh);
  await api.getUser();
  await api.ensureLabel("agent-plugins-validate");
  const issue = await api.createIssue({
    title: "t",
    body: "b",
    labels: ["agent-plugins-validate"],
  });
  await api.updateIssue(issue.number, {
    state: "closed",
    state_reason: "completed",
  });
  await api.addComment(issue.number, "c");
  await api.listIssues("agent-plugins-validate", 1);
  const methods = new Set(gh.requests.map((r) => r.method));
  assert.deepEqual([...methods].sort(), ["GET", "PATCH", "POST"]);
  for (const request of gh.requests) {
    assert.match(
      request.path,
      /^\/user$|^\/repos\/example\/repo\/(labels(\/[^/]+)?|issues(\/\d+(\/comments)?)?|contents\/.+|commits\/[0-9a-f]{40})$/,
    );
  }
});

test("a path with '..' cannot walk out of the contents endpoint", async () => {
  let calls = 0;
  const api = createClient({
    apiUrl: "https://api.example.test",
    token: "tok",
    repository: "example/repo",
    fetch: async () => {
      calls += 1;
      return new Response("{}", { status: 404 });
    },
  });
  for (const hostile of [
    "../../../../user/plugin.json",
    "a/../../../../user",
    "./plugin.json",
    "a//b",
    "",
    "..",
  ]) {
    await assert.rejects(
      api.getContents(hostile, BEFORE),
      /plain segments/,
      hostile,
    );
  }
  assert.equal(calls, 0);
});

test("the allow-list is checked on the URL that is sent", async () => {
  const sent: string[] = [];
  // A repository name that would climb out of /repos/ once the URL parser resolved it.
  const api = createClient({
    apiUrl: "https://api.example.test",
    token: "tok",
    repository: "example/repo/../../../user",
    fetch: async (input) => {
      sent.push(String(input));
      return new Response("{}", { status: 404 });
    },
  });
  await assert.rejects(
    api.getContents("plugin.json", BEFORE),
    /does not make this request/,
  );
  await assert.rejects(api.listIssues("x", 1), /does not make this request/);
  assert.deepEqual(sent, []);
});

test("64-digit commit ids (SHA-256 repositories) are accepted", async () => {
  const gh = new FakeGitHub();
  gh.commits.add("c".repeat(64));
  assert.equal(await client(gh).commitExists("c".repeat(64)), true);
  assert.equal(await client(gh).commitExists("d".repeat(64)), false);
});

test("forbidden reads say which area they were in", async () => {
  const gh = new FakeGitHub();
  gh.failures.set("GET /repos/example/repo/contents", { status: 403 });
  gh.failures.set("GET /repos/example/repo/issues", { status: 403 });
  await assert.rejects(
    client(gh).getContents("plugin.json", BEFORE),
    (e: unknown) =>
      e instanceof ApiError &&
      e.kind === "forbidden" &&
      e.area === "contents" &&
      !e.write,
  );
  await assert.rejects(
    client(gh).listIssues("x", 1),
    (e: unknown) =>
      e instanceof ApiError &&
      e.kind === "forbidden" &&
      e.area === "tracker" &&
      !e.write,
  );
});
