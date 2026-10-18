import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Context } from "../context.ts";
import { canonicalSchema } from "../rules/schema-version.ts";
import { run } from "../run.ts";
import { FakeGitHub } from "../testing/github.ts";
import type { Sandbox } from "../testing/sandbox.ts";
import { createSandbox } from "../testing/sandbox.ts";
import { createClient } from "./api.ts";
import { issueMode, LABEL, trackIssues } from "./issues.ts";

const BEFORE = "b".repeat(40);
const SHA = "a".repeat(40);

const PLUGIN = JSON.stringify({
  $schema: canonicalSchema("1.0.0", "plugin"),
  name: "example-plugin",
});
function mcp(type: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    {
      $schema: canonicalSchema("1.0.0", "mcp"),
      mcpServers: {
        docs: { type, url: "https://docs.example.com/mcp", ...extra },
      },
    },
    null,
    2,
  )}\n`;
}
const GOOD = mcp("streamable-http");
const BAD = mcp("http");

interface Scene {
  sb: Sandbox;
  gh: FakeGitHub;
  go: (overrides?: Partial<Context>) => Promise<number>;
  summary: () => string;
}

/** The repository now has a broken mcp.json; at BEFORE it was fine. */
function scene(options: { now?: string; before?: string | null } = {}): Scene {
  const sb = createSandbox();
  const gh = new FakeGitHub();
  gh.commits.add(BEFORE);
  sb.put("plugin.json", PLUGIN);
  sb.put("mcp.json", options.now ?? BAD);
  gh.contents.set(`${BEFORE}:plugin.json`, PLUGIN);
  if (options.before !== null)
    gh.contents.set(`${BEFORE}:mcp.json`, options.before ?? GOOD);
  const go = (overrides: Partial<Context> = {}): Promise<number> =>
    run(
      sb.context({
        openIssues: true,
        token: "tok-s3cr3t",
        sha: SHA,
        event: { defaultBranch: "main", before: BEFORE, forced: false },
        ...overrides,
      }),
      {
        io: sb.io,
        createClient: (o) => createClient({ ...o, fetch: gh.fetch }),
      },
    );
  return { sb, gh, go, summary: () => sb.summary() };
}

function bodies(gh: FakeGitHub): string[] {
  return gh.issues.map((i) => i.body ?? "");
}

test("the event table: which events do anything", () => {
  const base = {
    ref: "refs/heads/main",
    defaultBranch: "main",
    forced: false,
    eventName: "push",
  };
  assert.equal(issueMode(base), "full");
  assert.equal(issueMode({ ...base, forced: true }), "update-close");
  assert.equal(
    issueMode({ ...base, eventName: "workflow_dispatch" }),
    "update-close",
  );
  assert.equal(issueMode({ ...base, eventName: "schedule" }), "none");
  assert.equal(issueMode({ ...base, eventName: "pull_request" }), "none");
  assert.equal(
    issueMode({ ...base, eventName: "pull_request_target" }),
    "none",
  );
  assert.equal(issueMode({ ...base, ref: "refs/heads/dev" }), "none");
  assert.equal(issueMode({ ...base, defaultBranch: undefined }), "none");
  assert.equal(issueMode({ ...base, eventName: "release" }), "none");
});

test("a regression that passed before opens one issue, with the template", async () => {
  const { sb, gh, go } = scene();
  try {
    assert.equal(await go(), 1);
    assert.equal(gh.issues.length, 1);
    const issue = gh.issues[0];
    assert.equal(
      issue?.title,
      "`mcp.json`: `mcpServers.docs.type` no longer follows the Agent Plugins spec",
    );
    const body = issue?.body ?? "";
    assert.match(
      body,
      /^`mcpServers\.docs\.type` in `mcp\.json` stopped following the Agent Plugins spec \(1\.0\.0\) in aaaaaaa\./,
    );
    assert.match(
      body,
      /\| `mcp-server-type` \| `"http"` \| use `"streamable-http"` \| \[§7\.2\.1\]\(https:\/\/github\.com\/agentplugins\/agent-plugins-spec\/blob\/v1\.0\.0\/spec\/1\.0\.0\.md#721-discovery-and-configuration\) \|/,
    );
    assert.match(
      body,
      /It passed at bbbbbbb\. This issue closes itself when the rule passes again\./,
    );
    assert.match(
      body,
      /<!-- agent-plugins-validate:v1 fingerprint=[0-9a-f]{64} current=[0-9a-f]{64} file=[0-9a-f]{64} rule=mcp-server-type -->/,
    );
    assert.ok(gh.labels.has(LABEL));
    assert.match(
      sb.summary(),
      /Issues: opened 1, reopened 0, updated 0, closed 0\.\n\nOpened: \[#1\]/,
    );
  } finally {
    sb.cleanup();
  }
});

test("two runs in a row with the same regression give one issue and no new comment", async () => {
  const { sb, gh, go } = scene();
  try {
    await go();
    const writes = gh.writes();
    await go();
    assert.equal(gh.issues.length, 1);
    assert.equal(gh.writes(), writes);
    assert.match(
      sb.summary(),
      /Issues: opened 0, reopened 0, updated 0, closed 0\./,
    );
  } finally {
    sb.cleanup();
  }
});

test("a changed value gives exactly one comment, and a fix closes the issue naming the commit", async () => {
  const { sb, gh, go } = scene();
  try {
    // A different "current" for the same fingerprint: the same field, another value.
    await go();
    sb.put("mcp.json", mcp("sse-http"));
    const before = gh.writes();
    await go({ sha: "c".repeat(40) });
    const comments = gh.requests.filter(
      (r) => r.method === "POST" && r.path.endsWith("/comments"),
    );
    assert.equal(gh.writes() - before, 2);
    assert.equal(comments.length, 1);
    assert.equal(
      (comments[0]?.body as { body: string } | undefined)?.body,
      'Now `"sse-http"` as of ccccccc.',
    );
    await go({ sha: "c".repeat(40) });
    assert.equal(
      gh.requests.filter((r) => r.path.endsWith("/comments")).length,
      1,
    );
    sb.put("mcp.json", GOOD);
    await go({ sha: "d".repeat(40) });
    assert.equal(gh.issues[0]?.state, "closed");
    assert.equal(gh.issues[0]?.state_reason, "completed");
    const last = gh.requests.filter((r) => r.path.endsWith("/comments")).pop();
    assert.equal(
      (last?.body as { body: string } | undefined)?.body,
      "Fixed in ddddddd.",
    );
    assert.match(
      sb.summary(),
      /Issues: opened 0, reopened 0, updated 0, closed 1\./,
    );
  } finally {
    sb.cleanup();
  }
});

test("the regression table: no proof, no issue", async () => {
  const cases: [string, (s: Scene) => Partial<Context>][] = [
    [
      "first push of a branch (all zeros)",
      () => ({
        event: { defaultBranch: "main", before: "0".repeat(40), forced: false },
      }),
    ],
    [
      "no before at all",
      () => ({
        event: { defaultBranch: "main", before: undefined, forced: false },
      }),
    ],
    [
      "forced push, even when the commit still answers 200",
      () => ({
        event: { defaultBranch: "main", before: BEFORE, forced: true },
      }),
    ],
    [
      "unreachable before",
      (s) => {
        s.gh.commits.clear();
        return {};
      },
    ],
  ];
  for (const [name, change] of cases) {
    const s = scene();
    try {
      const overrides = change(s);
      assert.equal(await s.go(overrides), 1, name);
      assert.equal(s.gh.issues.length, 0, name);
      assert.match(s.summary(), /❌ `mcp\.json` has 1 thing to fix\./, name);
    } finally {
      s.sb.cleanup();
    }
  }
});

test("a manifest that did not exist at before, or cannot be used, opens nothing", async () => {
  const absent = scene({ before: null });
  try {
    await absent.go();
    assert.equal(absent.gh.issues.length, 0);
  } finally {
    absent.sb.cleanup();
  }
  for (const value of [
    { type: "symlink" },
    { type: "dir" },
    { size: "big" as const },
  ]) {
    const s = scene();
    try {
      s.gh.contents.set(`${BEFORE}:mcp.json`, value);
      await s.go();
      assert.equal(s.gh.issues.length, 0, JSON.stringify(value));
    } finally {
      s.sb.cleanup();
    }
  }
});

test("a problem that was already there before opens nothing", async () => {
  const s = scene({ before: BAD });
  try {
    await s.go();
    assert.equal(s.gh.issues.length, 0);
  } finally {
    s.sb.cleanup();
  }
});

test("when a gate failed before, only an earlier gate rule can be proven", async () => {
  // Before: the file was not valid JSON. Now: json-syntax again, or something else.
  const brokenBefore = scene({ before: "{ not json" });
  try {
    await brokenBefore.go();
    assert.equal(brokenBefore.gh.issues.length, 0);
  } finally {
    brokenBefore.sb.cleanup();
  }
  // Before: a wrong $schema (schema-version failed). Now: json-syntax fails, which passed before.
  const wrongSchema = scene({
    now: "{ not json",
    before: mcp("streamable-http").replace("1.0.0", "9.9.9"),
  });
  try {
    await wrongSchema.go();
    assert.equal(wrongSchema.gh.issues.length, 1);
    assert.match(wrongSchema.gh.issues[0]?.body ?? "", /rule=json-syntax/);
  } finally {
    wrongSchema.sb.cleanup();
  }
  // Before: invalid JSON. Now: schema-version fails. json-syntax failed first, so it is not proven.
  const invalidThenSchema = scene({
    now: mcp("streamable-http").replace("1.0.0", "9.9.9"),
    before: "{ not json",
  });
  try {
    await invalidThenSchema.go();
    assert.equal(invalidThenSchema.gh.issues.length, 0);
  } finally {
    invalidThenSchema.sb.cleanup();
  }
});

test("a notice never opens, updates or closes an issue, and makes no write", async () => {
  const s = scene({
    now: GOOD,
    before: GOOD,
  });
  try {
    s.sb.put(
      "plugin.json",
      JSON.stringify({
        $schema: canonicalSchema("1.0.0", "plugin"),
        name: "example-plugin",
        version: "v1",
      }),
    );
    s.gh.contents.set(`${BEFORE}:plugin.json`, PLUGIN);
    assert.equal(await s.go(), 0);
    assert.equal(s.gh.writes(), 0);
    assert.equal(s.gh.issues.length, 0);
  } finally {
    s.sb.cleanup();
  }
});

test("contents are read only for files with candidates, and path segments are encoded", async () => {
  const s = scene({ now: GOOD, before: GOOD });
  try {
    const dir = "my plugins #1";
    s.sb.put(`${dir}/plugin.json`, PLUGIN);
    s.sb.put(`${dir}/mcp.json`, BAD);
    s.gh.contents.set(`${BEFORE}:${dir}/plugin.json`, PLUGIN);
    s.gh.contents.set(`${BEFORE}:${dir}/mcp.json`, GOOD);
    await s.go({
      manifests: "plugin.json\nmcp.json\nmy plugins #1/plugin.json",
    });
    const reads = s.gh.requests
      .filter((r) => r.path.includes("/contents/"))
      .map((r) => r.path);
    assert.deepEqual(reads, [
      "/repos/example/repo/contents/my%20plugins%20%231/plugin.json",
      "/repos/example/repo/contents/my%20plugins%20%231/mcp.json",
    ]);
    assert.equal(s.gh.issues.length, 1);
  } finally {
    s.sb.cleanup();
  }
});

test("an issue that a user authored, labeled and gave a valid marker is never touched", async () => {
  const s = scene();
  try {
    await s.go();
    const own = s.gh.issues[0];
    assert.ok(own);
    // The same marker, on an issue that someone else wrote.
    s.gh.issues = [];
    const forged = s.gh.add({ body: own.body ?? "" }, "other");
    forged.state = "closed";
    forged.state_reason = "not_planned";
    const writesBefore = s.gh.writes();
    await s.go();
    // The Action opens its own issue, and the forged one is not edited, reopened or counted.
    assert.equal(s.gh.issues.length, 2);
    assert.equal(forged.state, "closed");
    assert.equal(forged.state_reason, "not_planned");
    assert.equal(forged.body, own.body);
    assert.ok(s.gh.writes() > writesBefore);
    const mine = s.gh.issues[1];
    assert.equal(mine?.user?.type, "Bot");
    assert.doesNotMatch(s.summary(), /not planned/);
    // Fixing the problem does not close the forged issue either.
    s.sb.put("mcp.json", GOOD);
    forged.state = "open";
    forged.state_reason = null;
    await s.go();
    assert.equal(forged.state, "open");
    assert.equal(mine?.state, "closed");
  } finally {
    s.sb.cleanup();
  }
});

test("identity: a personal token uses its login, and an app token accepts only bots", async () => {
  const personal = scene();
  try {
    personal.gh.login = "octo-maintainer";
    await personal.go();
    const issue = personal.gh.issues[0];
    assert.equal(issue?.user?.login, "octo-maintainer");
    // Listed again, it is recognized: nothing new happens.
    const writes = personal.gh.writes();
    await personal.go();
    assert.equal(personal.gh.writes(), writes);
    // A bot's issue with the same marker is not ours when the identity is a login.
    const bot = personal.gh.add(
      {
        body: issue?.body ?? "",
        user: { login: "github-actions[bot]", type: "Bot" },
      },
      "other",
    );
    bot.user = { login: "github-actions[bot]", type: "Bot" };
    personal.sb.put("mcp.json", GOOD);
    await personal.go();
    assert.equal(bot.state, "open");
    assert.equal(issue?.state, "closed");
  } finally {
    personal.sb.cleanup();
  }
  const app = scene();
  try {
    await app.go();
    const issue = app.gh.issues[0];
    assert.equal(issue?.user?.type, "Bot");
    // A user-authored issue is ignored, an app-authored one is accepted.
    const user = app.gh.add({ body: issue?.body ?? "" }, "other");
    app.sb.put("mcp.json", GOOD);
    await app.go();
    assert.equal(user.state, "open");
    assert.equal(issue?.state, "closed");
  } finally {
    app.sb.cleanup();
  }
});

test("own issues: completed reopens, not planned stays closed", async () => {
  const completed = scene();
  try {
    await completed.go();
    const issue = completed.gh.issues[0];
    assert.ok(issue);
    issue.state = "closed";
    issue.state_reason = "completed";
    await completed.go({ sha: "e".repeat(40) });
    assert.equal(completed.gh.issues.length, 1);
    assert.equal(issue.state, "open");
    assert.match(
      completed.summary(),
      /Issues: opened 0, reopened 1, updated 0, closed 0\./,
    );
  } finally {
    completed.sb.cleanup();
  }
  const notPlanned = scene();
  try {
    await notPlanned.go();
    const issue = notPlanned.gh.issues[0];
    assert.ok(issue);
    issue.state = "closed";
    issue.state_reason = "not_planned";
    const writes = notPlanned.gh.writes();
    await notPlanned.go();
    assert.equal(issue.state, "closed");
    assert.equal(notPlanned.gh.writes(), writes);
    assert.match(
      notPlanned.summary(),
      /was closed as not planned, so it stays closed\./,
    );
  } finally {
    notPlanned.sb.cleanup();
  }
});

test("an open issue whose file was not checked stays open, and the summary says why", async () => {
  const s = scene();
  try {
    await s.go();
    // The file is gone, so it can't be checked.
    rmSync(path.join(s.sb.repo, "mcp.json"));
    await s.go();
    assert.equal(s.gh.issues[0]?.state, "open");
    assert.match(
      s.summary(),
      /stays open: its file was not checked in this run\./,
    );
  } finally {
    s.sb.cleanup();
  }
});

test("a forced push and a manual run only update and close", async () => {
  for (const [eventName, forced] of [
    ["push", true],
    ["workflow_dispatch", undefined],
  ] as const) {
    const s = scene();
    try {
      await s.go();
      s.sb.put("mcp.json", mcp("sse-http"));
      await s.go({
        eventName,
        event: { defaultBranch: "main", before: BEFORE, forced },
      });
      assert.equal(s.gh.issues.length, 1);
      assert.equal(
        s.gh.requests.filter((r) => r.path.endsWith("/comments")).length,
        1,
      );
      s.sb.put("mcp.json", GOOD);
      await s.go({
        eventName,
        event: { defaultBranch: "main", before: BEFORE, forced },
      });
      assert.equal(s.gh.issues[0]?.state, "closed");
      // And it opens nothing new.
      s.sb.put("mcp.json", mcp("sse-http"));
      await s.go({
        eventName,
        event: { defaultBranch: "main", before: BEFORE, forced },
      });
      assert.equal(s.gh.issues.length, 1);
    } finally {
      s.sb.cleanup();
    }
  }
});

test("pull requests, schedules, other branches and open-issues: false never call the API", async () => {
  const cases: Partial<Context>[] = [
    { eventName: "pull_request" },
    { eventName: "pull_request_target" },
    { eventName: "schedule" },
    { ref: "refs/heads/dev" },
    { openIssues: false },
    { eventName: "release" },
  ];
  for (const overrides of cases) {
    const s = scene();
    try {
      let created = false;
      const code = await run(
        s.sb.context({
          openIssues: true,
          token: "tok",
          event: { defaultBranch: "main", before: BEFORE, forced: false },
          ...overrides,
        }),
        {
          io: s.sb.io,
          createClient: () => {
            created = true;
            throw new Error("the API module must not be used");
          },
        },
      );
      assert.equal(code, 1);
      assert.equal(created, false, JSON.stringify(overrides));
      assert.equal(s.gh.requests.length, 0);
    } finally {
      s.sb.cleanup();
    }
  }
});

test("a repository whose default branch is trunk gets issues on trunk pushes only", async () => {
  const trunk = scene();
  try {
    await trunk.go({
      ref: "refs/heads/trunk",
      event: { defaultBranch: "trunk", before: BEFORE, forced: false },
    });
    assert.equal(trunk.gh.issues.length, 1);
    assert.match(trunk.summary(), /Issues: opened 1/);
  } finally {
    trunk.sb.cleanup();
  }
  const main = scene();
  try {
    await main.go({
      ref: "refs/heads/main",
      event: { defaultBranch: "trunk", before: BEFORE, forced: false },
    });
    assert.equal(main.gh.issues.length, 0);
    assert.equal(main.gh.requests.length, 0);
    assert.match(main.summary(), /Issues: on, for trunk only\./);
  } finally {
    main.sb.cleanup();
  }
});

test("the summary has no issues line on a pull request", async () => {
  const s = scene();
  try {
    await s.go({ eventName: "pull_request" });
    assert.doesNotMatch(s.summary(), /Issues/);
  } finally {
    s.sb.cleanup();
  }
});

test("the caps: at most 10 new issues and 50 writes, the rest listed", async () => {
  const servers = (type: string): string =>
    JSON.stringify({
      $schema: canonicalSchema("1.0.0", "mcp"),
      mcpServers: Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [
          `s${i}`,
          { type, url: "https://docs.example.com/mcp" },
        ]),
      ),
    });
  const s = scene({ now: servers("http"), before: servers("streamable-http") });
  try {
    await s.go();
    assert.equal(s.gh.issues.length, 10);
    assert.ok(s.gh.writes() <= 50);
    assert.match(
      s.summary(),
      /Issues: opened 10, reopened 0, updated 0, closed 0\./,
    );
    assert.match(
      s.summary(),
      /issue changes were not made: the limit of 10 new issues or 50 writes was reached\./,
    );
  } finally {
    s.sb.cleanup();
  }
});

test("errors never change the step's result, and each has its note", async () => {
  const cases: [string, (gh: FakeGitHub) => void, RegExp][] = [
    [
      "rate limit, 403 with no requests left",
      (gh) =>
        gh.failures.set("GET /repos/example/repo/issues", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
      /Issues: skipped, GitHub's API rate limit was reached\. They'll catch up on the next push\./,
    ],
    [
      "rate limit, 429",
      (gh) =>
        gh.failures.set("GET /repos/example/repo/issues", { status: 429 }),
      /Issues: skipped, GitHub's API rate limit was reached\./,
    ],
    [
      "rate limit, retry-after",
      (gh) =>
        gh.failures.set("GET /repos/example/repo/issues", {
          status: 403,
          headers: { "retry-after": "60" },
        }),
      /rate limit was reached/,
    ],
    [
      "issues turned off",
      (gh) =>
        gh.failures.set("GET /repos/example/repo/issues", { status: 410 }),
      /Issues: on, but issues are turned off in this repository\./,
    ],
    [
      "no permission to write",
      (gh) =>
        gh.failures.set("POST /repos/example/repo/issues", { status: 403 }),
      /Issues: on, but the token can't write issues\. Add issues: write to the job's permissions\./,
    ],
    [
      "no permission to read earlier versions",
      (gh) =>
        gh.failures.set("GET /repos/example/repo/contents", { status: 403 }),
      /Issues: on, but the token can't read earlier versions of the manifests, so no regression could be proven\./,
    ],
  ];
  for (const [name, setup, note] of cases) {
    const s = scene();
    try {
      setup(s.gh);
      assert.equal(await s.go(), 1, name);
      assert.match(s.summary(), note, name);
      assert.match(s.sb.out.join(""), /::warning title=issues::/, name);
    } finally {
      s.sb.cleanup();
    }
  }
});

test("a network error or a timeout gives its note and does not fail the step", async () => {
  const s = scene({ now: GOOD, before: GOOD });
  try {
    const code = await run(
      s.sb.context({
        openIssues: true,
        token: "t",
        event: { defaultBranch: "main", before: BEFORE, forced: false },
      }),
      {
        io: s.sb.io,
        createClient: (o) =>
          createClient({
            ...o,
            fetch: async () => {
              throw new TypeError("fetch failed");
            },
          }),
      },
    );
    assert.equal(code, 0);
    assert.match(s.summary(), /Issues: skipped, GitHub's API didn't answer\./);
  } finally {
    s.sb.cleanup();
  }
  const slow = scene({ now: GOOD, before: GOOD });
  try {
    let tick = 0;
    const code = await run(
      slow.sb.context({
        openIssues: true,
        token: "t",
        event: { defaultBranch: "main", before: BEFORE, forced: false },
      }),
      {
        io: slow.sb.io,
        createClient: (o) =>
          createClient({
            ...o,
            fetch: slow.gh.fetch,
            // The total budget of 60 seconds runs out before the first request.
            now: () => (tick++ === 0 ? 0 : 61_000),
          }),
      },
    );
    assert.equal(code, 0);
    assert.match(
      slow.summary(),
      /Issues: skipped, GitHub's API didn't answer\./,
    );
  } finally {
    slow.sb.cleanup();
  }
});

test("the token is masked before it is used, and never printed or sent anywhere else", async () => {
  const s = scene();
  try {
    await s.go();
    const printed = s.sb.out.join("");
    assert.match(printed, /^::add-mask::tok-s3cr3t\n/);
    assert.equal(printed.split("tok-s3cr3t").length - 1, 1);
    assert.ok(!s.summary().includes("tok-s3cr3t"));
    assert.ok(
      ![...s.sb.files.values()].some((text) => text.includes("tok-s3cr3t")),
    );
  } finally {
    s.sb.cleanup();
  }
});

test("a server called after markup becomes inert text in the issue", async () => {
  const nasty = "`a` | <img src=x> @octocat";
  const now = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "mcp"),
    mcpServers: {
      [nasty]: { type: "http", url: "https://docs.example.com/mcp" },
    },
  });
  const before = now.replace('"http"', '"streamable-http"');
  const s = scene({ now, before });
  try {
    await s.go();
    const issue = s.gh.issues[0];
    assert.ok(issue);
    // The key is not plain, so it is not even in the field.
    assert.doesNotMatch(`${issue.title}\n${issue.body}`, /<img|@octocat/);
  } finally {
    s.sb.cleanup();
  }
});

test("two findings that look alike but have different keys have different fingerprints", async () => {
  const keys = (a: string, b: string): string =>
    JSON.stringify({
      $schema: canonicalSchema("1.0.0", "mcp"),
      mcpServers: {
        [a]: { type: "http", url: "https://docs.example.com/mcp" },
        [b]: { type: "http", url: "https://docs.example.com/mcp" },
      },
    });
  const s = scene({
    now: keys("odd one", "odd two"),
    before: keys("odd one", "odd two").replaceAll(
      '"http"',
      '"streamable-http"',
    ),
  });
  try {
    await s.go();
    // Both servers have the field "mcpServers[…].type", and each gets its own issue.
    assert.equal(s.gh.issues.length, 2);
    assert.notEqual(bodies(s.gh)[0], bodies(s.gh)[1]);
  } finally {
    s.sb.cleanup();
  }
});

test("any failure while talking to GitHub leaves the report, summary and outputs, and the exit code from the findings", async () => {
  const cases: [string, (gh: FakeGitHub) => void, RegExp][] = [
    [
      "500",
      (gh) =>
        gh.failures.set("GET /repos/example/repo/issues", { status: 500 }),
      /Issues: skipped, GitHub's API answered with an error/,
    ],
    [
      "404",
      (gh) =>
        gh.failures.set("GET /repos/example/repo/issues", { status: 404 }),
      /Issues: skipped, GitHub's API answered with an error/,
    ],
    [
      "422",
      (gh) =>
        gh.failures.set("POST /repos/example/repo/issues", { status: 422 }),
      /Issues: skipped, GitHub's API answered with an error/,
    ],
    [
      "a 502 while reading contents",
      (gh) =>
        gh.failures.set("GET /repos/example/repo/contents", { status: 502 }),
      /Issues: skipped/,
    ],
  ];
  for (const [name, setup, note] of cases) {
    const s = scene();
    try {
      setup(s.gh);
      assert.equal(await s.go(), 1, name);
      assert.match(s.summary(), note, name);
      assert.match(
        s.sb.files.get(path.join(s.sb.temp, "output")) ?? "",
        /valid<<ghadelimiter_r1\nfalse\n/,
        name,
      );
      assert.ok(
        s.sb.files.has(
          path.join(
            s.sb.temp,
            "agent-plugins-validate",
            "validate",
            "report.json",
          ),
        ),
        name,
      );
    } finally {
      s.sb.cleanup();
    }
  }
});

test("an unexpected error in the client, or in making it, costs nothing either", async () => {
  for (const make of [
    () => {
      throw new Error("bad API URL");
    },
    () =>
      ({
        getUser: async () => {
          throw new TypeError("boom");
        },
      }) as never,
  ]) {
    const s = scene();
    try {
      const code = await run(
        s.sb.context({
          openIssues: true,
          token: "t",
          event: { defaultBranch: "main", before: BEFORE, forced: false },
        }),
        { io: s.sb.io, createClient: make },
      );
      assert.equal(code, 1);
      assert.match(s.summary(), /Issues: skipped/);
      assert.match(
        s.sb.files.get(path.join(s.sb.temp, "output")) ?? "",
        /valid<<ghadelimiter_r1\nfalse\n/,
      );
    } finally {
      s.sb.cleanup();
    }
  }
});

test("a 64-digit before (SHA-256 repository) works", async () => {
  const before = "b".repeat(64);
  const s = scene();
  try {
    s.gh.commits.add(before);
    s.gh.contents.set(`${before}:plugin.json`, PLUGIN);
    s.gh.contents.set(`${before}:mcp.json`, GOOD);
    await s.go({ event: { defaultBranch: "main", before, forced: false } });
    assert.equal(s.gh.issues.length, 1);
  } finally {
    s.sb.cleanup();
  }
});

test("a before that is not a commit id is no proof, and asks GitHub nothing", async () => {
  const s = scene();
  try {
    await s.go({
      event: { defaultBranch: "main", before: "../../user", forced: false },
    });
    assert.equal(s.gh.issues.length, 0);
    assert.equal(
      s.gh.requests.filter((r) => r.path.includes("/commits/")).length,
      0,
    );
  } finally {
    s.sb.cleanup();
  }
});

test("with an app token, only github-actions[bot] issues are the Action's", async () => {
  const s = scene();
  try {
    await s.go();
    const own = s.gh.issues[0];
    assert.ok(own);
    for (const user of [
      { login: "dependabot[bot]", type: "Bot" },
      { login: "renovate[bot]", type: "Bot" },
    ]) {
      s.gh.add({ body: own.body ?? "", user }, "other");
    }
    const impostor = s.gh.add(
      { body: own.body ?? "", performed_via_github_app: { slug: "other-app" } },
      "own",
    );
    s.sb.put("mcp.json", GOOD);
    await s.go();
    assert.equal(own.state, "closed");
    for (const issue of s.gh.issues.slice(1)) {
      assert.equal(issue.state, "open", issue.user?.login);
    }
    assert.equal(impostor.state, "open");
  } finally {
    s.sb.cleanup();
  }
});

test("titles hold the file and the field in code spans, cut when long", async () => {
  const long = "k".repeat(150);
  const now = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "mcp"),
    mcpServers: {
      [long]: { type: "http", url: "https://docs.example.com/mcp" },
    },
  });
  const s = scene({ now, before: now.replace('"http"', '"streamable-http"') });
  try {
    await s.go();
    const title = s.gh.issues[0]?.title ?? "";
    assert.ok(title.length <= 200, String(title.length));
    assert.match(
      title,
      /^`mcp\.json`: `mcpServers\[…\]\.type` no longer follows the Agent Plugins spec$/,
    );
  } finally {
    s.sb.cleanup();
  }
});

test("a closed own issue is reopened only when it was closed as completed", async () => {
  for (const [reason, reopened] of [
    ["completed", true],
    ["not_planned", false],
    [null, false],
    ["duplicate", false],
  ] as const) {
    const s = scene();
    try {
      await s.go();
      const issue = s.gh.issues[0];
      assert.ok(issue);
      issue.state = "closed";
      issue.state_reason = reason;
      await s.go();
      assert.equal(issue.state === "open", reopened, String(reason));
      if (!reopened)
        assert.match(s.summary(), /so it stays closed\./, String(reason));
    } finally {
      s.sb.cleanup();
    }
  }
});

test("one fingerprint opens one issue, even when two findings share it", async () => {
  const s = scene();
  try {
    const finding = {
      rule: "mcp-server-type",
      level: "error" as const,
      file: "mcp.json",
      field: "mcpServers.docs.type",
      current: '"http"',
      fix: 'use "streamable-http"',
      spec: "https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md#721-discovery-and-configuration",
    };
    const path = ["mcpServers", "docs", "type"];
    await trackIssues({
      client: createClient({
        apiUrl: s.gh.origin,
        token: "t",
        repository: s.gh.repository,
        fetch: s.gh.fetch,
      }),
      mode: "full",
      sha: SHA,
      before: BEFORE,
      forced: false,
      findings: [finding, finding],
      paths: [path, path],
      files: [
        { file: "mcp.json", kind: "mcp", specVersion: "1.0.0", status: "fail" },
      ],
      plugins: [
        {
          root: "",
          plugin: { path: "plugin.json", text: PLUGIN },
          mcp: { path: "mcp.json", text: BAD },
        },
      ],
      check: () => ({ findings: [], paths: [], files: [] }),
    });
    assert.equal(s.gh.issues.length, 1);
  } finally {
    s.sb.cleanup();
  }
});

test("reads say what could not be read: earlier versions, or the issues", async () => {
  const contents = scene();
  try {
    contents.gh.failures.set("GET /repos/example/repo/contents", {
      status: 403,
    });
    await contents.go();
    assert.match(
      contents.summary(),
      /can't read earlier versions of the manifests/,
    );
  } finally {
    contents.sb.cleanup();
  }
  const tracker = scene();
  try {
    tracker.gh.failures.set("GET /repos/example/repo/issues", { status: 403 });
    await tracker.go();
    assert.match(
      tracker.summary(),
      /Issues: on, but the token can't read this repository's issues\. Add issues: write to the job's permissions\./,
    );
    assert.doesNotMatch(tracker.summary(), /earlier versions/);
  } finally {
    tracker.sb.cleanup();
  }
});
