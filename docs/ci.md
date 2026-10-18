# CI

Status: implemented by the issues #3 (workflows and gate), #4 (audits) and #5 (updates).

## Design

A change to the README shouldn't pay for a full build, and a change to a rule must run the tests. So the checks are split by **area**, and each area runs only when its files change. A filtered workflow that didn't run never reports, which would leave a required check waiting forever. So a single job, `gate`, always reports.

| Workflow | Area: runs when these change | Runs |
| --- | --- | --- |
| `test-code.yml` | `src/**`, `fixtures/**`, `schemas/**`, `dist/**`, `package.json`, `package-lock.json`, `tsconfig.json`, `biome.json`, `Makefile`, `.npmrc`, `.gitattributes`, and the workflows that run it (`.github/actions/setup/**`, `test-code.yml`, `gate.yml`) | `make lint`, `make test`, `make check-dist` |
| `check-schemas.yml` | `schemas/**`, `.github/workflows/schemas.yml` | `make check-schemas` |
| `audit-workflows.yml` | `.github/**`, `action.yml` | zizmor and actionlint (#4). They run as pinned tools, not through `make`: the one exception to the `make`-only rule |
| `gate.yml` | everything (`pull_request`, and `push` to `main`) | Detects the changed areas and calls their workflows |

A change to a workflow also runs the area it defines, because the `workflows` area only audits the files: an edit to the setup action (for example a Dependabot bump of `setup-node` or `checkout`) must still install and build. `dist/**` and `schemas/**` are in the `code` area on purpose: `dist/` is what runs in other people's workflows, so a change to it must always be checked against a fresh build, and the bundle embeds the schemas.

## The gate

`gate.yml` is the only workflow with triggers. It has three kinds of jobs:

1. **`changes`** lists the changed files with `git diff --name-only` and decides which areas changed. The base is the pull request's base commit, or the push's `before` commit. When there is no usable base (a new branch, or a force-push that left it unreachable), every area runs.
2. **One job per area** calls that area's workflow, only when the area changed. The area workflows have `on: workflow_call` and nothing else, so nothing runs twice and nothing has to be polled (polling would need `actions: read`).
3. **`gate`** always runs, waits for the jobs above, and fails if any of them failed or was cancelled. A skipped area counts as passed.

**`gate` is the only check a branch ruleset would ever require.** A README-only change passes it at once.

## Rules every workflow follows

- Top-level `permissions: contents: read`. A job asks for more only where it needs it.
- `timeout-minutes` on every job: 10 for `code`, 5 for the rest.
- Third-party actions are pinned by full commit SHA with a version comment, from a release at least seven days old.
- `actions/checkout` runs with `persist-credentials: false`.
- A `concurrency` group cancels superseded runs on pull requests.
- Steps call `make`, never tool binaries directly. The composite action `.github/actions/setup` installs Node 24 and runs `make install`, so setup is written once.
- No `pull_request_target`, and no `${{ github.event.* }}` text inside a `run:` script: those values go through `env:`.
- No secrets. The token stays read-only.
