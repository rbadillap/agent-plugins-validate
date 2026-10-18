# Vendored data

The Action never fetches anything at runtime. Everything it checks against ships inside it, copied unmodified from a release tag of its source:

| Folder | What | Source | License |
| --- | --- | --- | --- |
| `schemas/<version>/` | The Agent Plugins JSON Schemas, `plugin.schema.json` and `mcp.schema.json` | [agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec), `schemas/<version>/` | Apache-2.0 |
| `data/spdx/<version>/` | The SPDX License List, `licenses.json` and `exceptions.json`, used by `license-spdx` | [spdx/license-list-data](https://github.com/spdx/license-list-data), `json/` | CC0-1.0 |

Each folder holds its data files, plus:

- `SHA256SUMS`: one line per data file, in `shasum -a 256` format;
- `LICENSE`: the license text, copied from the same tag;
- `NOTICE.md`: the source, tag, commit, date fetched and license.

`make check-schemas` recomputes every `SHA256SUMS` and fails on any mismatch, or on a data file that no checksum line lists. CI runs it whenever a file under `schemas/` or `data/` changes. Never edit a vendored file: update it from a new tag instead.

Release tags only. Never fetch from a branch, and never vendor a draft. In the PR, state the tag, the commit and the date.

## Adding a schema version

The steps are in [`schemas/README.md`](../schemas/README.md). A new version also needs its spec headings in `src/engine/spec-headings.ts` and an entry in `src/engine/vendored.ts`.

## Updating the SPDX License List

Dependabot doesn't cover the list, so it's updated by hand. The SPDX License List is released a few times a year; [license-list-data](https://github.com/spdx/license-list-data) is tagged `vX.Y.Z` for each release.

1. Pick the newest tag of [spdx/license-list-data](https://github.com/spdx/license-list-data/tags), and note its commit.
2. Create `data/spdx/<X.Y.Z>/` with `json/licenses.json` and `json/exceptions.json` from that tag, and `text/CC0-1.0.txt` from the same tag as `LICENSE`.
3. Write `SHA256SUMS` in that folder: `shasum -a 256 licenses.json exceptions.json > SHA256SUMS`.
4. Write `NOTICE.md` like the previous version's, with the new tag, commit and date.
5. Point the imports in `src/spdx/list.ts` at the new folder, and delete the old folder: only one list ships, and a test checks that the folder matches the list in use.
6. Run `make check-schemas`, `make test` and `make build`. A test or fixture that fails because an id was added, deprecated or removed is a change users will see: say so in the PR.
