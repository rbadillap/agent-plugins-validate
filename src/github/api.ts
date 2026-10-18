// The only module that uses the network. Everything the Action sends to GitHub goes through here.
//
// - Every URL is built from GITHUB_API_URL and checked to stay on its origin.
// - Redirects are refused, so a request can't be taken somewhere else.
// - Only the requests listed in ALLOWED can be made.
// - The token is sent as a bearer token and never logged.

const TIMEOUT_MS = 10_000;
const BUDGET_MS = 60_000;
const API_VERSION = "2022-11-28";

export type ApiErrorKind =
  | "rate-limit"
  | "forbidden"
  | "gone"
  | "network"
  | "other";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  /** What the request was for, so a note can say whether a read or a write failed. */
  readonly write: boolean;
  /** `contents` for reads of earlier versions of files, `tracker` for issues, labels and the user. */
  readonly area: "contents" | "tracker";
  constructor(
    kind: ApiErrorKind,
    write: boolean,
    status?: number,
    area: "contents" | "tracker" = "tracker",
  ) {
    super(
      `GitHub API error: ${kind}${status === undefined ? "" : ` (${status})`}`,
    );
    this.kind = kind;
    this.status = status;
    this.write = write;
    this.area = area;
  }
}

export interface RawIssue {
  number: number;
  html_url: string;
  state: string;
  state_reason?: string | null;
  title: string;
  body?: string | null;
  user?: { login?: string; type?: string } | null;
  performed_via_github_app?: { slug?: string } | null;
  labels?: ({ name?: string } | string)[];
  pull_request?: unknown;
}

export type Contents =
  | { status: "ok"; text: string }
  | { status: "absent" }
  | { status: "unusable" };

export interface ApiClient {
  /** The login of the token's user, or null when the token belongs to an app. */
  getUser(): Promise<string | null>;
  getContents(path: string, ref: string): Promise<Contents>;
  commitExists(sha: string): Promise<boolean>;
  ensureLabel(name: string): Promise<void>;
  listIssues(label: string, page: number): Promise<RawIssue[]>;
  createIssue(input: {
    title: string;
    body: string;
    labels: string[];
  }): Promise<RawIssue>;
  updateIssue(
    number: number,
    patch: {
      title?: string;
      body?: string;
      state?: "open" | "closed";
      state_reason?: "completed" | "reopened";
    },
  ): Promise<RawIssue>;
  addComment(number: number, body: string): Promise<void>;
}

export interface ClientOptions {
  apiUrl: string;
  token: string;
  repository: string;
  /** For tests. In production this is the global `fetch`. */
  fetch?: typeof fetch;
  now?: () => number;
}

interface Allowed {
  method: string;
  path: RegExp;
}

function allowedRequests(repository: string): Allowed[] {
  const repo = `/repos/${repository}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    { method: "GET", path: /^\/user$/ },
    { method: "GET", path: new RegExp(`^${repo}/contents/[^?#]+$`) },
    {
      method: "GET",
      path: new RegExp(`^${repo}/commits/(?:[0-9a-f]{40}|[0-9a-f]{64})$`),
    },
    { method: "GET", path: new RegExp(`^${repo}/labels/[A-Za-z0-9_.-]+$`) },
    { method: "POST", path: new RegExp(`^${repo}/labels$`) },
    { method: "GET", path: new RegExp(`^${repo}/issues$`) },
    { method: "POST", path: new RegExp(`^${repo}/issues$`) },
    { method: "PATCH", path: new RegExp(`^${repo}/issues/[0-9]+$`) },
    { method: "POST", path: new RegExp(`^${repo}/issues/[0-9]+/comments$`) },
  ];
}

/** Each path segment is encoded on its own, so a "/", "#" or "?" in a name stays inside it. */
export function encodePath(path: string): string {
  const segments = path.split("/");
  // A "." or ".." segment would be resolved by the URL parser and walk out of the endpoint.
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new Error("A path for the contents API must have plain segments");
  }
  return segments.map(encodeURIComponent).join("/");
}

export function createClient(options: ClientOptions): ApiClient {
  const base = new URL(options.apiUrl);
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const started = now();
  const allowed = allowedRequests(options.repository);
  const repo = `/repos/${options.repository}`;

  async function request(
    method: string,
    pathname: string,
    init: {
      query?: Record<string, string>;
      body?: unknown;
      area?: "contents" | "tracker";
    } = {},
  ): Promise<{ status: number; json: unknown }> {
    const write = method !== "GET";
    const area = init.area ?? "tracker";
    const prefix = base.pathname.replace(/\/$/, "");
    const url = new URL(`${prefix}${pathname}`, base);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      url.searchParams.set(key, value);
    }
    if (url.origin !== base.origin) {
      throw new Error("A request left GITHUB_API_URL, so it was not sent");
    }
    // The allow-list is checked on the URL that will be sent, after the URL parser has resolved
    // any "." and ".." segment, so a path can't be walked out of the repository's endpoints.
    const finalPath = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length)
      : "";
    if (!allowed.some((a) => a.method === method && a.path.test(finalPath))) {
      throw new Error(
        `The Action does not make this request: ${method} ${finalPath}`,
      );
    }
    const remaining = BUDGET_MS - (now() - started);
    if (remaining <= 0) throw new ApiError("network", write, undefined, area);

    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, remaining)),
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": API_VERSION,
          "user-agent": "agent-plugins-validate",
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch {
      throw new ApiError("network", write, undefined, area);
    }

    const status = response.status;
    if (
      status === 429 ||
      (status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          response.headers.get("retry-after") !== null))
    ) {
      throw new ApiError("rate-limit", write, status, area);
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status, json };
  }

  function fail(
    status: number,
    write: boolean,
    area: "contents" | "tracker" = "tracker",
  ): never {
    if (status === 403 || status === 401) {
      throw new ApiError("forbidden", write, status, area);
    }
    if (status === 410) throw new ApiError("gone", write, status, area);
    throw new ApiError("other", write, status, area);
  }

  const ok = (status: number): boolean => status >= 200 && status < 300;

  return {
    async getUser() {
      const { status, json } = await request("GET", "/user");
      if (
        status === 200 &&
        typeof (json as { login?: unknown })?.login === "string"
      ) {
        return (json as { login: string }).login;
      }
      if (status === 401 || status === 403 || status === 404) return null;
      return fail(status, false);
    },

    async getContents(path, ref) {
      const { status, json } = await request(
        "GET",
        `${repo}/contents/${encodePath(path)}`,
        {
          query: { ref },
          area: "contents",
        },
      );
      if (status === 404) return { status: "absent" };
      if (!ok(status)) return fail(status, false, "contents");
      const file = json as {
        type?: unknown;
        encoding?: unknown;
        content?: unknown;
      } | null;
      if (
        Array.isArray(json) ||
        file === null ||
        file.type !== "file" ||
        file.encoding !== "base64" ||
        typeof file.content !== "string"
      ) {
        return { status: "unusable" };
      }
      const text = Buffer.from(file.content, "base64").toString("utf8");
      return {
        status: "ok",
        text: text.startsWith("\uFEFF") ? text.slice(1) : text,
      };
    },

    async commitExists(sha) {
      const { status } = await request("GET", `${repo}/commits/${sha}`, {
        area: "contents",
      });
      if (status === 404 || status === 422) return false;
      if (!ok(status)) return fail(status, false, "contents");
      return true;
    },

    async ensureLabel(name) {
      const found = await request(
        "GET",
        `${repo}/labels/${encodeURIComponent(name)}`,
      );
      if (ok(found.status)) return;
      if (found.status !== 404) return fail(found.status, false);
      const made = await request("POST", `${repo}/labels`, {
        body: {
          name,
          color: "0e8a16",
          description: "Opened by agent-plugins-validate",
        },
      });
      // 422: someone created it meanwhile.
      if (!ok(made.status) && made.status !== 422) fail(made.status, true);
    },

    async listIssues(label, page) {
      const { status, json } = await request("GET", `${repo}/issues`, {
        query: {
          labels: label,
          state: "all",
          per_page: "100",
          page: String(page),
        },
      });
      if (!ok(status)) return fail(status, false);
      return Array.isArray(json) ? (json as RawIssue[]) : [];
    },

    async createIssue(input) {
      const { status, json } = await request("POST", `${repo}/issues`, {
        body: input,
      });
      if (!ok(status)) return fail(status, true);
      return json as RawIssue;
    },

    async updateIssue(number, patch) {
      const { status, json } = await request(
        "PATCH",
        `${repo}/issues/${number}`,
        { body: patch },
      );
      if (!ok(status)) return fail(status, true);
      return json as RawIssue;
    },

    async addComment(number, body) {
      const { status } = await request(
        "POST",
        `${repo}/issues/${number}/comments`,
        {
          body: { body },
        },
      );
      if (!ok(status)) fail(status, true);
    },
  };
}
