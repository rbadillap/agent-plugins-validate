# AGENTS.md — agent-plugins-validate

`agent-plugins-validate` is a GitHub Action that checks Agent Plugins manifests (`plugin.json`, `mcp.json`) against the public specification and reports each problem as a finding: the exact field, its current value, a concrete fix and the spec section.

This file is for agents and contributors, and holds rules only. Humans start at [README.md](README.md). How it works lives in [docs/architecture.md](docs/architecture.md).

## Product rules

- **Spec only.** Every rule cites a section of the Agent Plugins specification. No rule without a spec link, and no recommendations of our own.
- **Every finding has the seven fields:** `rule`, `level`, `file`, `field`, `current`, `fix`, `spec`. A finding never says only "must be equal to one of the allowed values": `fix` is a concrete change, e.g. `use "streamable-http"`.
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
- Commits and PR titles use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `chore:`, `refactor:`). Commits are signed.
- Merging is the owner's decision.
