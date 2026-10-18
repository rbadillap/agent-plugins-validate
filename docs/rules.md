# Rules

Every rule cites a section of the [Agent Plugins specification 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/spec/1.0.0.md). A rule id never changes meaning and is never reused.

The level follows what the spec says a client does with the problem: an `error` is a plugin or an MCP server that a client rejects, turns off or skips; a `warning` is reported by a client that keeps loading; a `notice` is a SHOULD or RECOMMENDED. A new rule starts as a `warning` in a minor release and becomes an `error` only in the next major.

Each finding carries its `rule`, so you can look it up here. The format of a finding is in [the report](report.md).

## `plugin.json`

| Rule | Level | What it checks | Spec |
|---|---|---|---|
| `required-fields` | error | `name` is present, a string and not empty | §5.3 |
| `plugin-name` | error | `name` is lowercase kebab-case of 1–64 characters (`a-z`, `0-9`, `-`, `.`), starting and ending with a letter or digit | §5.5 |
| `field-type` | error | `version`, `description`, `homepage`, `repository`, `license`, `keywords` and `author` have the right type | §5.4 |
| `unknown-field` | warning | no top-level field the spec doesn't define | §5.2 |
| `extensions-type` | warning | `extensions` is an object keyed by namespace, and each value is an object | §8.1 |
| `extensions-namespace` | warning | each key of `extensions` is a reverse-domain name | §8 |
| `version-semver` | notice | `version` is a Semantic Versioning string | §10.2 |
| `manifest-containment` | error | the file resolves inside the plugin root and is a regular file | §4.1 |

## `mcp.json`

| Rule | Level | What it checks | Spec |
|---|---|---|---|
| `mcp-top-level` | error | `mcpServers` is present and is the only top-level field besides `$schema` | §7.2.1 |
| `mcp-server-type` | error | each server's `type` is `stdio`, `streamable-http` or `sse` | §7.2.1 |
| `mcp-server-fields` | error | each server has the fields of its type, and none of another type's | §7.2.1 |
| `mcp-command` | error | `command` is a single executable, not a command line | stdio |
| `mcp-cwd` | error | `cwd` starts with `./`, `${PLUGIN_ROOT}` or `${PLUGIN_DATA}` and stays inside it | stdio |
| `mcp-env-reserved` | error | `env` doesn't set `PLUGIN_ROOT` or `PLUGIN_DATA`, which the client sets itself | §9.2 |
| `mcp-env-name` | warning | no `env` name contains `=` (usually a pasted `NAME=value`) | §9.2 |
| `mcp-url` | error | `url` is an absolute `http` or `https` URL without a user or password | Streamable HTTP and legacy HTTP+SSE |
| `mcp-headers` | error | header names and values are valid, and no name is repeated in another case | Streamable HTTP and legacy HTTP+SSE |
| `plugin-manifest-missing` | error | a `plugin.json` sits next to the `mcp.json` | §4.1 |
| `mcp-component-location` | error | the file resolves inside the plugin root and is a regular file | §6.2 |

## Both files

| Rule | Level | What it checks | Spec |
|---|---|---|---|
| `json-syntax` | error | the file is valid JSON and its top level is an object | §5.2 (`plugin.json`), §7.2.2 (`mcp.json`) |
| `schema-version` | error | `$schema` names a version this Action supports | §5.2 (`plugin.json`), §7.2.1 (`mcp.json`) |
| `mcp-version-match` | error | `mcp.json` and its `plugin.json` declare the same spec version | §10.1 |
| `schema-violation` | error | anything else the bundled JSON schema rejects | §5.2 (`plugin.json`), §7.2.1 (`mcp.json`) |

`mcp-version-match` can't fail while 1.0.0 is the only supported version.

## Problems with the workflow

These are about the `manifests` input, not about a manifest. They fail the step: `manifests-invalid-pattern`, `manifests-no-match`, `manifests-too-many` and `manifest-too-large`. See [the report](report.md).
