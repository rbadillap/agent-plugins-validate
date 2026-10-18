# Vendored schemas

Each folder holds the official Agent Plugins JSON Schemas for one released version of the specification, exactly as published. The Action never fetches a schema at runtime.

```text
schemas/<version>/
├── plugin.schema.json
├── mcp.schema.json
├── SHA256SUMS
├── LICENSE
└── NOTICE.md
```

`make check-schemas` recomputes every `SHA256SUMS` and fails on any mismatch, or on a schema file that no checksum line lists. Never edit a vendored schema.

## Adding a version

Release tags only. Never fetch from a branch, and never vendor a draft version.

1. Fetch the schemas from the spec repository ([agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec)) at the release tag, `schemas/<version>/`. Also copy `LICENSES/Apache-2.0.txt` from the same tag as `LICENSE`.
2. Create `schemas/<version>/` with the files above. Each schema's `$id` must be `https://agent-plugins.org/schemas/<version>/<file>`; a test checks it.
3. Write `SHA256SUMS` in `shasum -a 256` format, one line per schema.
4. Write `NOTICE.md` with the source, tag, commit, date fetched and license.
5. In the PR, state the tag, the commit and the date.
