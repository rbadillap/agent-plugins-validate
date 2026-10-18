# AGENTS.md — agent-plugins-validate

`agent-plugins-validate` is a GitHub Action that checks Agent Plugins manifests (`plugin.json`, `mcp.json`) against the public specification and reports each problem as a finding: the exact field, its current value, a concrete fix and the spec section.

This file is for agents and contributors, and holds rules only. Humans start at [README.md](README.md). How it works lives in [docs/architecture.md](docs/architecture.md).

## Product rules

- **Spec only.** Every rule cites a section of the Agent Plugins specification. No rule without a spec link, and no recommendations of our own.
- **Every finding has the seven fields:** `rule`, `level`, `file`, `field`, `current`, `fix`, `spec`. A finding never says only "must be equal to one of the allowed values": `fix` is a concrete change, e.g. `use "streamable-http"`.
- **Findings never repeat the user's text.** `current` describes a value (`string (54 chars)`) and `fix` is an instruction with a generic example. Only values that can't hold free text are shown as they are: numbers, booleans, and plain names (`^[A-Za-z0-9_.-]{1,64}$`: a plugin name, a namespace, a server, header or variable name, a transport). The values of `env`, `headers`, `url`, `command`, `args` and `cwd` never are, and a key in `field` that is not plain is written `[…]`. The one exception is a URL the parser says holds a password: `scheme://u****:p****@host`.
- **Levels follow the spec's consequence:** `error` when a client rejects the plugin, disables MCP or skips a server; `warning` when a client reports and keeps loading; `notice` for SHOULD/RECOMMENDED.
- **Rule ids are stable.** A rule id never changes meaning and is never reused.
- **No surprise failures.** A new rule ships as `warning` in a minor release and becomes `error` only in the next major.
- **The summary starts with what passes**, e.g. "Both manifests follow the Agent Plugins spec (1.0.0)", never "no problems". With issues off it says `Issues: off. [How to turn issues on](…#issues)`. On pull requests it says nothing about issues.

## Security rules

- **No network.** With `open-issues` off, no HTTP, DNS or socket use at all. With it on, only GitHub's API: read the previous version of the manifests and manage the Action's own issues. No telemetry. Schemas are vendored; nothing is fetched at runtime.
- **No secrets.** The Action reads no secret and has no token of its own. It uses the `token` input (default: the workflow's `GITHUB_TOKEN`) only when `open-issues` is `true`.
- **A regression is proven, never assumed:** the rule passed at the push's `before` commit and fails now. No `before`, an unreachable `before` or a manifest that didn't exist there means no issue.
- **Permissions:** `contents: read` always; `issues: write` only with `open-issues`. Never ask for more.
- **Writes:** only the step outputs, the job summary, the JSON report under `RUNNER_TEMP`, and opt-in issues. No PR comments, no commits, no edits to issues the Action didn't open.
- **Issues** only on the default branch, read from `github.event.repository.default_branch`, never assumed to be `main`. Only regressions, one per fingerprint (rule, file, field), never duplicated.
- **Paths:** resolve inside the checkout and reject anything that escapes it; don't follow symlinks out of the repository; read only files named `plugin.json` or `mcp.json`, up to a cap. Manifests are read, never executed or imported.
- **Manifest content is untrusted.** Escape it in annotations, the summary and issues (no Markdown, HTML or `@mention` injection).
- Any change to the output format, the permissions, the issue behavior or these security rules is proposed in an issue first.

## Engineering rules

- TypeScript strict, ESM, on the `node24` runtime.
- The engine (`src/engine/`, `src/rules/`) is pure: text in, findings out. Side effects live in exactly these places:
  - `src/main.ts` reads the inputs and the environment;
  - `src/discover/` reads manifest files;
  - `src/report/` writes the summary, the outputs and the report;
  - `src/github/api.ts` is the only code that uses the network.
- Schemas live in `schemas/<version>/` with a checksum and their Apache-2.0 notice. Never edit a vendored schema.
- Every rule has pass and fail fixtures in `fixtures/`. Fixtures are minimal and anonymized: no real repository, publisher or server names.
- The Action validates its own fixtures with itself in CI.
- Dependencies are minimal, and the PR that adds one justifies it. Versions come from the live registry on the day they're added, and the PR says that date.
- Actions in workflows are pinned by full commit SHA, from releases at least seven days old.
- English everywhere.

## Sources

Cite only public sources. Every document, commit, issue and PR must stand on its own.

## Work

- Issues first: each change starts as an issue with Problem, Behavior, Acceptance criteria, Security notes and Out of scope. Only issues labeled `approved` are built, one PR each.
- **Say how we'll know it works.** An issue that changes code, schemas or workflows has a section **How we'll know it works**: a short list of "when …, then …" sentences, each one something that could turn out false. For example: "When a PR changes only `README.md`, every area is skipped and `gate` passes." If one depends on how GitHub behaves, link GitHub's docs or a run that showed it. Approving the issue approves this list too.
- **Decisions made while building go to the issue.** When the work needs a decision the issue didn't make, open a sub-issue of the issue for it, titled `Decision: …`, with the decision and why. The owner closes it as **completed** to accept it or **not planned** to reject it. The work can go on, but the PR is merged only when every decision sub-issue is closed, and it follows each outcome. Known limit: the parent issue's sub-issue progress counts a `not planned` sub-issue as done, so the outcome of each decision is read on the sub-issue, not on the parent's progress bar.
- **Say how we'll know it works** applies to issues approved after #60 is closed. Decision sub-issues apply to issues approved after #66 is closed; an issue approved between the two keeps the comment: the decision goes in a comment on the issue, and the PR is merged only after the owner agrees in that comment. Earlier issues and their PRs are not changed.
- Commits and PR titles use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `chore:`, `refactor:`). Commits are signed.
- Merging is the owner's decision.

## Make targets

`make` is the only interface. Humans, agents and CI run the same targets. It runs only binaries from `node_modules/.bin`, never `npx`. `lint`, `format`, `test` and `build` install the dependencies first when they are missing or `package-lock.json` changed, and `build` does nothing when its inputs are unchanged.

| Target | Runs |
| --- | --- |
| `make` or `make help` | List the targets |
| `make install` | `npm ci --ignore-scripts` from `package-lock.json` |
| `make lint` | Biome, then `tsc --noEmit` |
| `make format` | Biome with fixes |
| `make test` | `node --test 'src/**/*.test.ts'` |
| `make build` | esbuild: `src/main.ts` → `dist/index.js` |
| `make check-dist` | `make build`, then fail if `dist/` differs from the commit |
| `make check-schemas` | Recompute every `schemas/*/SHA256SUMS` and fail on a mismatch or an unlisted schema |

## CI

CI is described in [docs/ci.md](docs/ci.md). Checks are split by area, and `gate` is the only required check: it always reports, and fails when any area that ran failed or was cancelled.
