# Issues for regressions

Issues are off by default. This page describes what happens when you turn them on, with `open-issues: true` and `issues: write` on the job. The short version, with the workflow to copy, is in the [README](../README.md#open-issues-on-regressions-optional).

## When it runs

- **Only on your default branch.** The branch comes from GitHub's event data (`github.event.repository.default_branch`), so it doesn't have to be `main`. On other branches and on pull requests, `open-issues` does nothing, and the summary doesn't mention issues on pull requests.
- **Only on pushes.** A push to the default branch can open an issue. Force-pushes and manual runs only update and close existing ones, and scheduled runs do nothing.
- **One run at a time.** The `concurrency` group in the README's workflow keeps two pushes from racing to open the same issue.

## Which problems become issues

- **Only real regressions.** A regression is a check that passed at the commit before the push and fails now. The Action proves it by reading the previous version of your manifests through GitHub's API: both of a plugin's files (`plugin.json` and `mcp.json`) at that commit, because some checks compare them. Problems that already existed when you turned issues on appear in the summary, never as issues.
- **No proof, no issue.** When the Action can't show that a check passed before, it opens nothing: on the first push of a branch, after a force-push, when the previous commit can't be reached, or for a manifest that didn't exist before.
- **Errors and warnings only.** Notices never open issues.
- **`mcp-version-match`.** The one check that compares a plugin's two files, the matching `$schema` versions, can't fail while 1.0.0 is the only supported version, so no issue depends on it yet.

## How an issue is tracked

- **One issue per problem, never repeated.** A problem is identified by a fingerprint of its rule, file and field. Each issue carries the `agent-plugins-validate` label and a hidden marker with four attributes: the fingerprint, a hash of the value as the finding shows it, a hash of the file path, and the rule's id. The next run finds the issue by them instead of opening another.
- **Only its own issues.** The Action acts only on issues it opened itself: the issue must have the label, a well-formed marker and the Action's own author (the user of your personal token, or `github-actions[bot]` for the workflow's token). A label and a marker on someone else's issue, or on an issue another bot opened, aren't enough.
- **Title.** The title holds the file and the field in code spans.
- **Reopened only when it was completed.** If a fixed problem comes back, its issue is reopened, but only if it was closed as completed. An issue you closed as "not planned", or in any other way, stays closed.
- **Kept current.** If the value changes while the issue is open, the Action updates the issue and adds one short comment. It compares what the finding shows about the value, and for text that is its size (`string (54 chars)`), so an edit that keeps the same size isn't noticed.
- **Closed by the fix.** When the check passes again, the Action closes the issue with a comment naming the commit that fixed it. If the file is no longer checked at all, the issue stays open, and the summary says why.

## Limits and failures

- **Small and bounded.** At most 10 new issues and 50 changes per run. Anything beyond that is listed in the summary.
- **Rate limits or outages** on GitHub's side skip the issues for that run, with a note in the summary. Your results don't change.
- **Without `issues: write`**, the summary and a warning say so. Your results don't change, and the check doesn't fail for it.

## What it can reach

With `open-issues` on, the Action talks only to GitHub's API: it reads the previous version of the manifests, and it creates its label and manages its own issues. It makes no other request, and the list of requests it can make is fixed in [`src/github/api.ts`](../src/github/api.ts), the only code that uses the network.
