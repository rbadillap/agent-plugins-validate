# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| `v1` (latest `1.x.y`) | ✅ |

Fixes ship as a new `1.x.y` release, and `v1` moves to it. If you pin a commit SHA, Dependabot proposes the update.

## Reporting a vulnerability

Please report it privately, through GitHub: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/rbadillap/agent-plugins-validate/security/advisories/new)). Don't open a public issue.

Include what you can:
- the version or commit SHA you use;
- the workflow and the manifest that trigger it, with any real secret removed;
- what happens, and what you expected.

You'll get an answer within 7 days. A fix and a GitHub security advisory follow once the report is confirmed.

## What's in scope

- Anything that makes the Action read outside the workspace, reach a host other than `api.github.com`, or use the token beyond what the README's permissions section describes.
- Any way for text from a manifest (a secret, a path, a key) to appear in an annotation, the job summary, the report or an issue.
- Issue writes that the README says the Action never makes.
- The integrity of a release: a `dist/index.js` that `gh attestation verify` rejects.
