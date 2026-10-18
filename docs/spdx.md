# SPDX

The `license-spdx` rule checks `license` against the [SPDX License List](https://spdx.org/licenses/). The Action never fetches anything at runtime, so the list is copied into the repository.

## Where it lives

| Path | What |
| --- | --- |
| `data/spdx/<version>/` | `licenses.json` and `exceptions.json` from [spdx/license-list-data](https://github.com/spdx/license-list-data), unmodified, with `SHA256SUMS`, `LICENSE` (CC0-1.0) and `NOTICE.md` (source, tag, commit, date fetched) |
| `src/spdx/list.ts` | Loads the list: license ids, current (not deprecated) license ids, exception ids |
| `src/spdx/expression.ts` | Parses an SPDX license expression ([SPDX 3.0, Annex D](https://github.com/spdx/spdx-spec/blob/v3.0/docs/annexes/SPDX-license-expressions.md)) and returns the ids it uses |
| `src/spdx/spdx.test.ts` | Tests the parser, and recomputes `SHA256SUMS`: it fails on a mismatch or on a data file that isn't listed |
| `src/rules/license-spdx.ts` | The rule. It uses `src/spdx/` and builds the finding |

`src/spdx/` is pure, like the engine: it reads no file at runtime and knows nothing of findings or rules. A change under `data/` runs the `code` area in CI, so `make test` checks the checksums.

Never edit the files in `data/spdx/`: update them from a new tag instead.

## Updating the list

Dependabot doesn't cover the list, so it's updated by hand. The SPDX License List is released a few times a year, and [license-list-data](https://github.com/spdx/license-list-data) is tagged `vX.Y.Z` for each release. Use release tags only, never a branch.

1. Pick the newest tag of [spdx/license-list-data](https://github.com/spdx/license-list-data/tags), and note its commit.
2. Create `data/spdx/<X.Y.Z>/` with `json/licenses.json` and `json/exceptions.json` from that tag, and copy `text/CC0-1.0.txt` from the same tag as `LICENSE`.
3. Write `SHA256SUMS` in that folder: `shasum -a 256 licenses.json exceptions.json > SHA256SUMS`.
4. Write `NOTICE.md` like the previous version's, with the new tag, commit and date.
5. Point the imports in `src/spdx/list.ts` at the new folder, and delete the old folder. Only one list ships, and a test checks that the folder matches the list in use.
6. Run `make test` and `make build`. If a test or fixture fails because an id was added, deprecated or removed, users will see that change: say so in the PR.

In the PR, state the tag, the commit and the date.
