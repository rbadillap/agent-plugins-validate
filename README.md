# agent-plugins-validate

A GitHub Action that checks your `plugin.json` and `mcp.json` against the [Agent Plugins specification](https://agent-plugins.org/specification). For every problem it reports the exact field, its current value, a concrete fix, and the section of the spec that requires it.

> **Status:** in design. There is no release yet, and the usage below describes v1 as it will ship. The roadmap is in the [issues](https://github.com/rbadillap/agent-plugins-validate/issues).

- **Spec only.** It checks what the spec requires, and nothing else: no style opinions, no recommendations of its own.
- **Read-only by default.** It reads your manifests and reports. It writes nothing unless you turn issues on.
- **Offline.** The official schemas ship inside the Action. It never downloads anything while it runs.

## Usage

```yaml
on: [push, pull_request]
permissions:
  contents: read
jobs:
  manifests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: rbadillap/agent-plugins-validate@<full-commit-sha> # v1.0.0
```

That checks `plugin.json` and `mcp.json` at the root of your repository, where the spec puts them, and fails the step when the spec is broken.

## What you get

**An annotation on the exact line**, in the pull request and in the run:

```text
Error: mcp.json line 6: mcpServers.docs.type is "http".
Fix: use "streamable-http". Spec: §7.2.1
```

**A job summary** that starts with what passes:

```markdown
### Agent Plugins manifests

plugin.json follows the Agent Plugins spec (1.0.0). mcp.json has 1 error.

| Level | File | Field | Current | Fix | Spec |
| --- | --- | --- | --- | --- | --- |
| error | mcp.json | mcpServers.docs.type | "http" | use "streamable-http" | §7.2.1 |

Issues: off. [How to turn issues on](https://github.com/rbadillap/agent-plugins-validate#issues)
```

**A JSON report** for agents and scripts, at the path in the `report` output. Every finding has the same seven fields:

| Field | Example | Meaning |
| --- | --- | --- |
| `rule` | `mcp-server-type` | Stable id. It never changes meaning. |
| `level` | `error` | `error`, `warning` or `notice`, GitHub's annotation levels |
| `file` | `mcp.json` | Path from the repository root |
| `field` | `mcpServers.docs.type` | Dotted path inside the file |
| `current` | `"http"` | The value as written, or `(missing)` |
| `fix` | `use "streamable-http"` | What to change, concretely |
| `spec` | link to §7.2.1 | The section that requires it |

Levels follow what the spec says a client does:
- `error`: a client rejects the plugin, disables its MCP servers, or skips a server.
- `warning`: a client reports the problem and keeps loading, such as an unknown top-level field in `plugin.json` (§5.2).
- `notice`: something the spec recommends (SHOULD) but doesn't require.

Only errors fail the step.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `manifests` | `plugin.json`<br>`mcp.json` | Files or glob patterns, one per line, relative to the repository root. Only files named `plugin.json` or `mcp.json` are read. Use it when your plugin lives in a subfolder, for example `plugins/*/plugin.json`. A missing `mcp.json` is fine: it's optional in the spec. |
| `open-issues` | `false` | Open one issue per regression on the default branch. See [Issues](#issues). |

## Outputs

| Output | Example | Description |
| --- | --- | --- |
| `valid` | `true` | `true` when there are no errors. Warnings and notices don't change it. |
| `findings` | `3` | Number of findings at any level |
| `report` | `/home/runner/work/_temp/agent-plugins-validate/report.json` | Path of the JSON report |

## Permissions

| Permission | When | What it's for | Without it | What the Action never does with it |
| --- | --- | --- | --- | --- |
| `contents: read` | Always | Lets `actions/checkout` fetch your code. The Action reads the manifests from that checkout. | `actions/checkout` can't fetch a private repository. | Writes, pushes, or reads files other than the manifests. |
| `issues: write` | Only with `open-issues: true` | Open, update and close the issues this Action created, and create its label. | The run reports that it can't write issues. Validation results don't change. | Reads, edits or closes issues it didn't open, or comments anywhere else. |

### What this Action never asks for

- **Secrets.** It needs none and reads none.
- **Tokens of its own.** It uses the workflow's `GITHUB_TOKEN`, and only when `open-issues` is on.
- **Network access.** It makes no network calls. The one exception is GitHub's API, to manage its own issues, and only when `open-issues` is on. No telemetry.
- **Pull request permissions.** It never comments on pull requests. Annotations and the summary cover them.

It also has no opinion on how your MCP servers authenticate or confirm writes. The spec leaves those to the client, so this Action leaves them alone.

## Issues

Issues are off by default. Turn them on to get one issue for each regression on your default branch:

```yaml
on:
  push:
permissions:
  contents: read
  issues: write
jobs:
  manifests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: rbadillap/agent-plugins-validate@<full-commit-sha> # v1.0.0
        with:
          open-issues: true
```

- **Only on the default branch.** The branch comes from GitHub's event data, so it doesn't have to be `main`. On every other branch and on pull requests, `open-issues` does nothing.
- **Only regressions.** A regression is a rule that passed on the default branch and fails now. Problems that already existed when you turned issues on appear in the summary, never as issues.
- **One issue per regression, never repeated.** Each issue carries a hidden fingerprint (rule, file, field) and the `agent-plugins-validate` label, so a second run finds it instead of opening another.
- **Kept current.** If the value changes while the issue is open, the Action adds one short comment.
- **Closed by the fix.** When the rule passes again, the Action closes the issue with a comment naming the commit that fixed it.

## Pinning

Both forms work. Choose one.

| Pin | Example | You get |
| --- | --- | --- |
| Commit SHA (recommended) | `rbadillap/agent-plugins-validate@<full-commit-sha> # v1.0.0` | Exactly the code you reviewed. A SHA can't be moved to point at different code. Dependabot updates it and keeps the version comment current. |
| Major tag | `rbadillap/agent-plugins-validate@v1` | Every v1 fix without touching your workflow. The `v1` tag moves with each release, so you trust each release as it lands. |

Every release is immutable and has a build attestation you can verify with `gh attestation verify`.

**No surprise failures.** A new check arrives as a `warning` in a minor release. It becomes an `error` only in the next major release, so `@v1` never starts failing your CI on its own.

## Specification

The checks come from the [Agent Plugins specification 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md) and its official JSON Schemas, which ship in [`schemas/`](schemas/) under their own Apache-2.0 license. A manifest that declares a version this Action doesn't support gets one finding saying so, never a guess.

## License

[MIT](LICENSE). The vendored schemas keep their Apache-2.0 license.
