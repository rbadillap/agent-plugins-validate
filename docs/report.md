# The JSON report

Every run writes one report, as data for scripts and AI agents. Its path is the `report` output, and it is
`$RUNNER_TEMP/agent-plugins-validate/<step>/report.json`, where `<step>` is the step's id with every
character outside letters, digits, `_` and `-` replaced by `_`. A job that runs the Action twice gets two
reports, and neither overwrites the other. The schema is [`report.schema.json`](report.schema.json).

```json
{
  "reportVersion": 1,
  "action": { "name": "agent-plugins-validate", "version": "1.0.0" },
  "valid": false,
  "counts": { "error": 1, "warning": 0, "notice": 0 },
  "files": [
    { "file": "plugin.json", "kind": "plugin", "specVersion": "1.0.0", "status": "pass" },
    { "file": "mcp.json", "kind": "mcp", "specVersion": "1.0.0", "status": "fail" }
  ],
  "findings": [
    {
      "rule": "mcp-server-type",
      "level": "error",
      "file": "mcp.json",
      "field": "mcpServers.docs.type",
      "current": "\"http\"",
      "fix": "use \"streamable-http\"",
      "spec": "https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md#721-discovery-and-configuration",
      "line": 4
    }
  ],
  "configErrors": []
}
```

| Field | Meaning |
| --- | --- |
| `reportVersion` | `1`. It changes only in a major release. |
| `valid` | `true` when no finding is an `error` and `configErrors` is empty. |
| `counts` | Findings at each level. |
| `files[].status` | `pass`, `warn` (warnings, no errors) or `fail` (at least one error). Notices alone are `pass`. |
| `files[].specVersion` | The version the file declares in `$schema`, or `null` when it is missing, not canonical or unsupported. |
| `findings[]` | The seven fields of a finding, plus `line` (1-based) when the finding has a place in the file. |
| `configErrors[]` | Problems with the workflow, not with a manifest: `manifests-invalid-pattern`, `manifests-no-match`, `manifests-too-many`, `manifest-too-large`. |

## What `current` and `field` hold

The report never repeats text from your manifests. `current` describes a value (`string (54 chars)`,
`array (2 items)`, `(missing)`). It shows a number or a boolean as it is, and a plain name (a plugin name,
a namespace, a server, header or variable name, a transport) as it is. `fix` is an instruction with a
generic example. A key in `field` that is not a plain name is written `[…]`, and `line` says where it is.
The one exception is a URL that holds a password: `current` is `https://u****:p****@host`.
