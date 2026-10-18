# agent-plugins-validate

**Make sure your Agent Plugin actually loads, before anyone installs it.**

This GitHub Action reads your `plugin.json` and `mcp.json` and checks them against the [Agent Plugins specification](https://agent-plugins.org). When something's wrong, it tells you exactly what, and how to fix it, right in your pull request.

> **Status:** in design. There is no release yet. This page describes v1 as it will ship, and the roadmap is in the [issues](https://github.com/rbadillap/agent-plugins-validate/issues).

## Get started in one minute

Add this file to your repository as `.github/workflows/agent-plugins.yml`:

```yaml
name: agent-plugins
on: [push, pull_request]
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: rbadillap/agent-plugins-validate@<full-commit-sha> # v1.0.0
```

That's it. No configuration, no tokens, no secrets.

## What you'll see

If something's wrong, a note appears on the exact line of your pull request:

> ❌ **mcp.json, line 6**
> `mcpServers.docs.type` is `"http"`. Use `"streamable-http"`.
> Clients that follow the spec skip this server until it's fixed. [Read the spec](https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md#721-discovery-and-configuration)

And the run's summary gives you the full picture:

> **Agent Plugins manifests**
> ✅ `plugin.json` follows the spec.
> ❌ `mcp.json` has 1 thing to fix.
>
> | | File | Field | Now | How to fix | Spec |
> |---|---|---|---|---|---|
> | ❌ | mcp.json | `mcpServers.docs.type` | `"http"` | use `"streamable-http"` | [§7.2.1](https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md#721-discovery-and-configuration) |

When everything is right, the check turns green and the summary simply says so: "Both manifests follow the Agent Plugins spec (1.0.0)."

## Questions you might have

**Does it send my code anywhere?**
No. It runs inside your own workflow, and the official spec files are bundled with it, so it never needs to download anything or call any server. The one exception is opt-in: if you turn on [issues](#issues), it talks to GitHub's own API, and to nothing else.

**Will it suddenly break my CI?**
No. Only real problems fail the check: the ones that stop your plugin, or one of its MCP servers, from loading. Suggestions from the spec appear as notes and never fail anything. When a new check is added, it starts as a warning and only becomes an error in a new major version, so `@v1` never breaks on its own.

**Do I need to give it a token or a secret?**
No. Reading your files is all it needs. If you turn on issues, it uses the token GitHub already gives every workflow, and you don't set anything.

**My plugin isn't at the root of my repository.**
Tell it where your `plugin.json` is. It checks the `mcp.json` next to it automatically:

```yaml
      - uses: rbadillap/agent-plugins-validate@<full-commit-sha> # v1.0.0
        with:
          manifests: plugins/*/plugin.json
```

**Can it warn me when something breaks on my main branch?**
Yes, if you want it to. Turn on `open-issues`, and when a manifest that used to be fine breaks on your default branch, you get one issue for it. When you fix it, the issue closes itself. It never opens the same issue twice, and it never opens issues for problems you already had. [How issues work](#issues)

**Which version should I use: `@v1` or a commit SHA?**
Both work, and you can choose.
- `@v1` gets every fix automatically, so you trust each release as it lands.
- A commit SHA runs exactly the code you reviewed, and nobody can change it under you. Dependabot keeps it up to date. This is the one we recommend.

---

## Reference

### Inputs

| Input | Default | What it does |
|---|---|---|
| `manifests` | `plugin.json`<br>`mcp.json` | Files or patterns to check, one per line, relative to the repository root. Only files named `plugin.json` or `mcp.json` are read. The `mcp.json` next to each `plugin.json` is always checked with it. A missing `mcp.json` is fine: it's optional in the spec. A line that matches no file fails the step with a message naming that line. |
| `open-issues` | `false` | Open an issue when something breaks on your default branch. See [Issues](#issues). |
| `token` | `${{ github.token }}` | Used only when `open-issues` is on. You don't need to set it. |

### Outputs

| Output | Example | What it means |
|---|---|---|
| `valid` | `true` | No errors. Notices and warnings don't change it. |
| `findings` | `2` | Everything found, at any level. |
| `report` | `/home/runner/work/_temp/agent-plugins-validate/report.json` | Every finding as data, for scripts and AI agents. |

Each finding in `report` has seven fields:

| Field | Example | Meaning |
|---|---|---|
| `rule` | `mcp-server-type` | Stable id. It never changes meaning. |
| `level` | `error` | `error`, `warning` or `notice` |
| `file` | `mcp.json` | Path from the repository root |
| `field` | `mcpServers.docs.type` | Dotted path inside the file |
| `current` | `"http"` | The value as written, or `(missing)` |
| `fix` | `use "streamable-http"` | What to change, concretely |
| `spec` | link to §7.2.1 | The section of the spec that requires it |

### Levels

Levels follow what the spec says a client does with the problem:

- **Error:** a client rejects the plugin, turns off its MCP servers, or skips a server. Fails the check.
- **Warning:** the spec requires it, but a client reports the problem and keeps loading, such as an unknown top-level field in `plugin.json` ([§5.2](https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md#52-manifest-object)). Doesn't fail.
- **Notice:** something the spec recommends (SHOULD) but doesn't require, such as a Semantic Versioning `version` ([§10.2](https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md#102-plugin-versions)). Doesn't fail.

### Permissions

| Permission | When | Why | Without it | What it never does with it |
|---|---|---|---|---|
| `contents: read` | Always | Lets `actions/checkout` fetch your code, so the Action can read your manifests. With `open-issues` on, it also reads the previous version of the same manifests. | `actions/checkout` can't fetch a private repository. With `open-issues` on, no regression can be proven, so no issue opens. | Write, push, or read anything but your manifests |
| `issues: write` | Only with `open-issues` | Open, update and close its own issues, and create its label | The summary and a warning say the token can't write issues. Results don't change, and the check doesn't fail for it. | Touch issues it didn't open, or comment anywhere else |

With `open-issues` on, it reads the previous version of your manifests through GitHub's API. That's how it tells a new problem from an old one. It never talks to any other server.

### What this Action never asks for

- **Secrets.** It needs none and reads none.
- **Tokens of its own.** It uses the workflow's `GITHUB_TOKEN` through the `token` input, and only when `open-issues` is on.
- **Network access.** With `open-issues` off, it makes no network calls at all. With it on, it talks only to GitHub's API. No telemetry.
- **Pull request permissions.** It never comments on pull requests. The notes on each line and the summary cover them.

It also has no opinion on how your MCP servers authenticate or confirm writes. The spec leaves those to the client, so this Action leaves them alone.

### Issues

Issues are off by default. To turn them on, give the job `issues: write` and set `open-issues`:

```yaml
on:
  push:
permissions:
  contents: read
  issues: write
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: rbadillap/agent-plugins-validate@<full-commit-sha> # v1.0.0
        with:
          open-issues: true
```

- **Only on your default branch.** The branch comes from GitHub's event data, so it doesn't have to be `main`. On other branches and on pull requests, `open-issues` does nothing, and the summary doesn't mention issues on pull requests.
- **Only on pushes.** A push to the default branch can open an issue. Scheduled or manual runs only update and close existing ones.
- **Only real regressions.** A regression is a check that passed at the commit before the push and fails now. The Action proves it by checking the previous version of your manifests. Problems that already existed when you turned issues on appear in the summary, never as issues.
- **No proof, no issue.** When the Action can't show that a check passed before, it opens nothing: on the first push of a branch, after a force-push, or for a manifest that didn't exist before.
- **Errors and warnings only.** Notices never open issues.
- **One issue per problem, never repeated.** Each issue carries the `agent-plugins-validate` label and a hidden fingerprint of the check, file and field, so the next run finds it instead of opening another. If a fixed problem comes back, its issue is reopened. An issue you closed as "not planned" stays closed.
- **Kept current.** If the value changes while the issue is open, the Action updates the issue and adds one short comment.
- **Closed by the fix.** When the check passes again, the Action closes the issue with a comment naming the commit that fixed it. If the file is no longer checked at all, the issue stays open, and the summary says why.
- **At most 10 new issues per run.** Anything beyond that is listed in the summary.
- **Without `issues: write`**, the summary and a warning say so. Your results don't change, and the check doesn't fail for it.

### Releases and pinning

| Pin | Example | You get |
|---|---|---|
| Commit SHA (recommended) | `rbadillap/agent-plugins-validate@<full-commit-sha> # v1.0.0` | Exactly the code you reviewed. A SHA can't be moved to point at different code. Dependabot updates it and keeps the version comment current. |
| Major tag | `rbadillap/agent-plugins-validate@v1` | Every v1 fix without touching your workflow. The `v1` tag moves with each release. |

Every release is immutable and has a build attestation:

```bash
gh attestation verify dist/index.js --repo rbadillap/agent-plugins-validate
```

A new check arrives as a `warning` (or `notice`) in a minor release, and becomes an `error` only in the next major release.

### Specification

The checks follow [Agent Plugins 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md). The official schemas ship inside this Action, in [`schemas/`](schemas/), under their own Apache-2.0 license. A manifest that declares a version this Action doesn't support gets one finding saying so, never a guess.

## License

[MIT](LICENSE). The bundled schemas keep their Apache-2.0 license.
