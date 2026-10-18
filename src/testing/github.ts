import type { RawIssue } from "../github/api.ts";

interface Failure {
  status: number;
  headers?: Record<string, string>;
  /** Applies to the first N requests that match, then stops. Omitted: every request. */
  times?: number;
}

/** A small stand-in for GitHub's API, for tests. It keeps issues, labels, commits and file contents. */
export class FakeGitHub {
  readonly origin = "https://api.example.test";
  readonly repository = "example/repo";
  issues: RawIssue[] = [];
  labels = new Set<string>();
  commits = new Set<string>();
  /** Keyed by `${ref}:${path}`. */
  contents = new Map<string, string | { type: string } | { size: "big" }>();
  /** The token's user: a login (a personal token), or null (an app: GET /user answers 403). */
  login: string | null = null;
  requests: { method: string; path: string; body?: unknown }[] = [];
  failures = new Map<string, Failure>();
  private next = 1;
  private botType = "Bot";

  /** Adds an issue authored by the Action (a bot, or `login`). */
  add(
    partial: Partial<RawIssue> & { body: string },
    author: "own" | "other" = "own",
  ): RawIssue {
    const number = this.next++;
    const issue: RawIssue = {
      number,
      html_url: `https://github.com/${this.repository}/issues/${number}`,
      state: "open",
      title: "t",
      labels: [{ name: "agent-plugins-validate" }],
      user:
        author === "own"
          ? this.login === null
            ? { login: "github-actions[bot]", type: this.botType }
            : { login: this.login, type: "User" }
          : { login: "someone", type: "User" },
      ...partial,
    };
    this.issues.push(issue);
    return issue;
  }

  writes(): number {
    return this.requests.filter((r) => r.method !== "GET").length;
  }

  private failure(method: string, path: string): Response | undefined {
    for (const [key, failure] of this.failures) {
      const [m, prefix] = key.split(" ");
      if (m !== method || prefix === undefined || !path.startsWith(prefix))
        continue;
      if (failure.times !== undefined) {
        if (failure.times <= 0) continue;
        failure.times -= 1;
      }
      return new Response("{}", {
        status: failure.status,
        headers: failure.headers,
      });
    }
    return undefined;
  }

  fetch = async (
    input: URL | string | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.origin !== this.origin)
      throw new Error(`A request left the API: ${url.href}`);
    if (init?.redirect !== "error") throw new Error("redirect must be refused");
    const method = init?.method ?? "GET";
    const path = url.pathname;
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    this.requests.push({
      method,
      path,
      ...(body === undefined ? {} : { body }),
    });
    const json = (value: unknown, status = 200): Response =>
      new Response(JSON.stringify(value), { status });
    const failed = this.failure(method, path);
    if (failed !== undefined) return failed;

    const repo = `/repos/${this.repository}`;
    if (method === "GET" && path === "/user") {
      return this.login === null ? json({}, 403) : json({ login: this.login });
    }
    const commit =
      /^\/repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40}|[0-9a-f]{64})$/.exec(
        path,
      );
    if (method === "GET" && commit !== null) {
      return this.commits.has(commit[1] ?? "") ? json({}) : json({}, 422);
    }
    if (method === "GET" && path.startsWith(`${repo}/contents/`)) {
      const file = path
        .slice(`${repo}/contents/`.length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
      const value = this.contents.get(`${url.searchParams.get("ref")}:${file}`);
      if (value === undefined) return json({}, 404);
      if (typeof value === "string") {
        return json({
          type: "file",
          encoding: "base64",
          content: Buffer.from(value).toString("base64"),
        });
      }
      if ("size" in value)
        return json({ type: "file", encoding: "none", content: "" });
      return json({ type: value.type, target: "x" });
    }
    if (method === "GET" && path.startsWith(`${repo}/labels/`)) {
      return this.labels.has(decodeURIComponent(path.split("/").pop() ?? ""))
        ? json({})
        : json({}, 404);
    }
    if (method === "POST" && path === `${repo}/labels`) {
      this.labels.add((body as { name: string }).name);
      return json({}, 201);
    }
    if (method === "GET" && path === `${repo}/issues`) {
      const label = url.searchParams.get("labels");
      const page = Number(url.searchParams.get("page") ?? "1");
      const matching = this.issues.filter((i) =>
        (i.labels ?? []).some(
          (l) => (typeof l === "string" ? l : l.name) === label,
        ),
      );
      return json(matching.slice((page - 1) * 100, page * 100));
    }
    if (method === "POST" && path === `${repo}/issues`) {
      const input = body as { title: string; body: string; labels: string[] };
      const issue = this.add({ title: input.title, body: input.body });
      return json(issue, 201);
    }
    const patch = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(path);
    if (method === "PATCH" && patch !== null) {
      const issue = this.issues.find((i) => i.number === Number(patch[1]));
      if (issue === undefined) return json({}, 404);
      const change = body as {
        state?: string;
        state_reason?: string;
        body?: string;
        title?: string;
      };
      if (change.state !== undefined) issue.state = change.state;
      if (change.state_reason !== undefined)
        issue.state_reason = change.state_reason;
      if (change.body !== undefined) issue.body = change.body;
      if (change.title !== undefined) issue.title = change.title;
      return json(issue);
    }
    if (method === "POST" && /\/issues\/\d+\/comments$/.test(path))
      return json({}, 201);
    return json({}, 404);
  };
}
