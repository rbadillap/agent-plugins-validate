# Releasing

How a version of the Action is released, and what a user can check about it. The workflow is
[`release.yml`](../.github/workflows/release.yml). Releasing is the owner's decision: nothing here
runs on its own.

## Repository settings

The owner applies these once. The workflow does not change settings.

- **Immutable releases: on** (Settings → General → Releases). Once a release is published, its tag and
  its assets can't change, so `vX.Y.Z` can't be moved or deleted by anyone.
- **A tag ruleset** that protects `v*.*.*` from deletion and from update. The major tags (`v1`, `v2`,
  …) are **not** in it, because they move by design.
- Actions → General → Workflow permissions: the default can stay read-only. `release.yml` asks for what
  it needs, job by job.

## How to release

1. Prepare the version in a pull request, as usual: set `version` in `package.json` to the new
   version, run `make build` (the bundle reports it), and merge when `gate` is green.
2. Actions → release → *Run workflow*, from the default branch, with the version, like `1.2.0` (three
   numbers: no leading `v`, no pre-release).
3. The workflow runs three jobs, one after the other:

| Job | Permissions | What it does |
| --- | --- | --- |
| `verify` | `contents: read` | Checks that the version is valid, that the run is on the default branch, that `package.json` has the same version, that the tag doesn't exist and that the version is greater than the latest release (the first release may be any valid version, and the summary says it is the first). Then runs `make lint`, `make test` and `make check-dist`: it fails if `dist/` is not current. |
| `attest` | `contents: read`, `id-token: write`, `attestations: write` | Creates a build provenance attestation for `dist/index.js`. |
| `publish` | `contents: write` | Creates the tag `vX.Y.Z` on the commit of the run, publishes the GitHub release with generated notes (a draft first, published last, so the release is complete when it becomes immutable), and moves the major tag `vX` to the same commit (it creates it the first time). |

`contents: write`, `id-token: write` and `attestations: write` exist only in this workflow, in their
own jobs, and only for a manual run from the default branch. No pull request can reach them. The
workflow uses no secret: `GITHUB_TOKEN` and OIDC cover everything.

Tags are made and moved through GitHub's REST API (`POST /repos/{owner}/{repo}/git/refs`,
`PATCH …/git/refs/tags/vX` with `force: true`), never with `git push`: no job keeps a credential in
its checkout.

If a run stops after the tag exists but before the release is published, the tag `vX.Y.Z` is
protected and can't be reused: delete the draft release, and release the next patch version.

## Versioning policy

- **Patch** (`1.2.1`): fixes that never add a finding to a manifest that had none.
- **Minor** (`1.3.0`): a new rule, always at level `warning` or `notice`.
- **Major** (`2.0.0`): promoting rules to `error`, removing a rule, or changing the finding format, the
  report format or the inputs.
- A rule id is never reused.

`vX.Y.Z` never moves. `vX` moves only to a release of the same major.

## Checking a release

A user can check that the `dist/index.js` they run was built by this repository's workflow from the
tagged source. Download the file from the tag you use, and verify it:

```bash
gh attestation verify dist/index.js --repo rbadillap/agent-plugins-validate
```

Pinning by commit SHA runs exactly the code that was reviewed. Dependabot keeps the SHA and its
`# v1.2.0` comment up to date.
