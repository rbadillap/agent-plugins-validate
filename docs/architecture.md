# Architecture

Status: designed, not implemented. Each piece below is built from an issue labeled `approved`.

## Flow

```text
manifests input ──► discover ──► read ──► engine ──► findings ──┬─► annotations
 (patterns)          (safe paths)  (text)   (pure)                ├─► job summary
                                                                  ├─► outputs + report.json
                                                                  └─► issues (opt-in, default branch only)
```

1. **Discover** turns the `manifests` patterns into a list of files. Every path is resolved inside the checkout; anything that escapes it, or a symlink that leaves the repository, is rejected. Only files named `plugin.json` or `mcp.json` are kept, up to a cap.
2. **Read** loads each file as text. Nothing is executed or imported.
3. **The engine** takes the text of the manifests of one plugin (its `plugin.json` and, if present, the `mcp.json` beside it) and returns findings. It has no IO: no filesystem, no environment, no network. The same engine can later back a CLI or an editor check without changes.
4. **Reporters** turn findings into GitHub's native surfaces.
5. **Issues** run only when `open-issues` is `true` and the run is on the default branch.

## The engine

- **Parse** the JSON while keeping the source position of every value, so each finding points at an exact line.
- **Select the version** from `$schema`. Only versions vendored under `schemas/` are supported. An unknown version produces a single `schema-version` finding and stops there for that file: the engine never guesses which rules apply.
- **Validate** with the vendored JSON Schema (draft 2020-12, through Ajv).
- **Translate** each schema error into a rule's finding, with a concrete fix. Schema errors that a rule can't translate are a bug, caught by tests.
- **Run semantic rules** for requirements the schema can't express (for example, an MCP `command` must be a single token, and the `mcp.json` version must match `plugin.json`).

## Rules

A rule is a small module in `src/rules/`:

| Part | Example |
| --- | --- |
| `id` | `mcp-server-type` |
| `level` | `error` |
| `spec` | the URL of §7.2.1 in the specification at the `v1.0.0` tag |
| `check` | finds the problems in a parsed manifest |
| `fix` | builds the concrete fix for each problem |

Each rule has fixtures in `fixtures/<rule-id>/`: at least one manifest that passes and one that fails, with the expected findings next to them.

## Folder map

| Path | What lives there |
| --- | --- |
| `action.yml` | The Action's interface: inputs, outputs, runtime |
| `src/main.ts` | Entry point. The only place that reads inputs, files and the environment |
| `src/engine/` | Parsing, version selection, schema validation, error translation |
| `src/rules/` | One module per rule |
| `src/report/` | Annotations, job summary, outputs, JSON report |
| `src/github/` | Opt-in issues: the only code that talks to the network |
| `schemas/<version>/` | Vendored official schemas, their checksum and Apache-2.0 notice |
| `fixtures/` | Pass and fail manifests per rule |
| `dist/` | The bundled Action, built from `src/` and committed |
| `.github/workflows/` | CI by area, an always-reporting `gate`, releases |
| `docs/` | Design documents like this one |

Folders appear as their issue lands; the map describes the target layout.
