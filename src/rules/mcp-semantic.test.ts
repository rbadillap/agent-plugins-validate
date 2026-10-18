import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "../engine/check.ts";
import { MINIMAL_PLUGIN } from "../testing/fixtures.ts";
import { commandFix } from "./mcp-command.ts";
import { urlProblem } from "./mcp-url.ts";
import { canonicalSchema } from "./schema-version.ts";

function checkServers(servers: Record<string, unknown>) {
  const text = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "mcp"),
    mcpServers: servers,
  });
  return check({
    root: "",
    plugin: MINIMAL_PLUGIN,
    mcp: { path: "mcp.json", text },
  }).findings;
}

function checkPlugin(manifest: Record<string, unknown>) {
  const text = JSON.stringify({
    $schema: canonicalSchema("1.0.0", "plugin"),
    ...manifest,
  });
  return check({ root: "", plugin: { path: "plugin.json", text } }).findings;
}

const http = (url: string, extra: object = {}) => ({
  s: { type: "streamable-http", url, ...extra },
});

test("commands: valid forms pass", () => {
  for (const command of [
    "node",
    "./bin/server",
    "./a/b/../c",
    "my-tool.exe",
    '"node"',
  ]) {
    assert.equal(commandFix(command), null, command);
  }
});

test("commands: when every token is safe, the fix is exact", () => {
  assert.equal(
    commandFix("npx -y @softeria/ms-365-mcp-server"),
    'use "command": "npx", "args": ["-y", "@softeria/ms-365-mcp-server"]',
  );
  assert.equal(
    commandFix("node server.js --port 3000"),
    'use "command": "node", "args": ["server.js", "--port", "3000"]',
  );
  assert.equal(
    commandFix("npx -y @scope/pkg@1.2.3 --verbose", true),
    'use "command": "npx" and put ["-y", "@scope/pkg@1.2.3", "--verbose"] at the start of the existing "args"',
  );
  assert.equal(
    commandFix("./bin/server --debug"),
    'use "command": "./bin/server", "args": ["--debug"]',
  );
});

test("commands: if one token is not safe, nothing is listed", () => {
  for (const command of [
    "npx -y @scope/pkg --tkn=abc123secret",
    "npx -y pkg https://u:p@h.example.com/x",
    "npx -y Pkg_With_Upper",
    "npx -y pkg --api-key=abc",
    "npx 'quoted arg'",
    "../bin/x --debug",
    "bin/x --debug",
    "node $HOME/x.js",
  ]) {
    const fix = commandFix(command) ?? "";
    assert.match(
      fix,
      /^keep only the executable|^move the executable|^start the path|^use a single|^use a bare|^use a/,
      command,
    );
    assert.doesNotMatch(fix, /@scope|--debug|--verbose|https/, command);
    assert.doesNotMatch(fix, /abc|secret|api-key|quoted|HOME|Pkg_/, command);
  }
});

test("commands: each kind of mistake has its own instruction", () => {
  const cases: [string, RegExp][] = [
    ["bin/server", /start the path with "\.\/"/],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a command the spec forbids
    ["${PLUGIN_ROOT}/bin/server", /placeholders are not expanded/],
    ["../bin/server", /move the executable inside the plugin/],
    ["./../bin/x", /move the executable inside the plugin/],
    ["./a/../../x", /move the executable inside the plugin/],
    ["/usr/bin/x", /search path, or bundle the executable/],
    ["C:\\tools\\x.exe", /search path, or bundle the executable/],
    [".\\bin\\x", /"\/" as the separator/],
    ["~/bin/x", /"~" and environment variables are not expanded/],
    ["$PLUGIN_ROOT/bin/x", /"~" and environment variables are not expanded/],
    [".", /a path to a file/],
    ["./", /a path to a file/],
    ["..", /a path to a file/],
    ['"my server"', /without quotes or spaces/],
    [" node ", /remove the spaces around the executable/],
  ];
  for (const [command, pattern] of cases) {
    assert.match(commandFix(command) ?? "", pattern, command);
  }
});

test("urls: valid ones pass, and loopback hosts may use http", () => {
  for (const url of [
    "https://api.example.com/mcp",
    "http://localhost:3000/mcp",
    "http://127.0.0.1/mcp",
    "http://127.255.0.1/mcp",
    "http://[::1]/mcp",
    "https://api.example.com/mcp?owner=a@b.example",
  ]) {
    assert.equal(urlProblem(url), null, url);
  }
});

test("urls: the raw text is checked before it is parsed", () => {
  const cases: [string, RegExp][] = [
    [" https://api.example.com/mcp", /remove the spaces around the URL/],
    ["https://api.example.com/mcp ", /remove the spaces around the URL/],
    ["https://api.example.com/mcp#", /remove the fragment/],
    ["https://api.example.com/m cp", /spaces and control characters inside/],
    ["https://api.exa\tmple.com/mcp", /spaces and control characters inside/],
    ["https:api.example.com/mcp", /write ":\/\/" right after the scheme/],
    ["https:/api.example.com/mcp", /write ":\/\/" right after the scheme/],
    ["https:\\\\api.example.com/mcp", /write ":\/\/" right after the scheme/],
    ["https://@api.example.com/mcp", /remove the user info/],
    ["http://api.example.com/mcp", /use "https" instead of "http"/],
    ["http://localhost.example.com/mcp", /use "https" instead of "http"/],
    ["http://128.0.0.1/mcp", /use "https" instead of "http"/],
    ["/mcp", /absolute http or https URL/],
    ["ws://api.example.com/mcp", /absolute http or https URL/],
  ];
  for (const [url, pattern] of cases) {
    assert.match(urlProblem(url)?.fix ?? "", pattern, JSON.stringify(url));
  }
});

// Forms that a URL parser reads as a user name and a password, each with the password "s3cr3t".
const PARSED_CREDENTIALS = [
  "https://alice:s3cr3t@host.example.com/mcp",
  "https:alice:s3cr3t@host.example.com/mcp",
  "https:/alice:s3cr3t@host.example.com/mcp",
  "https:\\\\alice:s3cr3t@host.example.com/mcp",
  "https://alice:s3cr3t\tx@host.example.com/mcp",
  "https://alice:s3cr3t x@host.example.com/mcp",
  'https://alice:s3cr3t"x@host.example.com/mcp',
  "https://alice:s3cr3t'x@host.example.com/mcp",
  "https://alice:s3cr3t\nx@host.example.com/mcp",
  "https://alice:s3cr3t\u2028x@host.example.com/mcp",
  "  https://alice:s3cr3t@host.example.com/mcp  ",
  "https://alice:s3cr3t@host.example.com/mcp?token=abc#frag",
];

// Forms where the parser finds no password: it fails, or reads other parts. They are still
// reported when invalid, and nothing of them is repeated.
const OTHER_CREDENTIAL_SHAPES = [
  "alice:s3cr3t@host.example.com/mcp",
  ":s3cr3t@host.example.com/mcp",
  "//alice:s3cr3t@host.example.com/mcp",
  "alice:s3cr3t/x@host.example.com/mcp",
  "https://alice:s3cr3t#x@host.example.com/mcp",
  "https://alice:s3cr3t?x@host.example.com/mcp",
  "https://alice:s3cr3t/x@host.example.com/mcp",
  "ws://alice:s3cr3t@host.example.com/mcp",
  "node https://alice:s3cr3t'x@host.example.com/mcp",
  'node https://alice:s3cr3t"x@host.example.com/mcp',
  "run ftp://alice:s3cr3t'x@host.example.com/mcp",
  "node ssh://alice:s3cr3t/x@host.example.com",
];

test("urls: a URL that parses with a password is reported as a credential, masked", () => {
  for (const url of PARSED_CREDENTIALS) {
    const findings = checkServers(http(url));
    assert.equal(findings.length, 1, JSON.stringify(url));
    const [finding] = findings;
    assert.equal(finding?.rule, "mcp-url", JSON.stringify(url));
    assert.equal(
      finding?.current,
      "https://a****:s****@host.example.com",
      JSON.stringify(url),
    );
    assert.match(finding?.fix ?? "", /a credential is in the URL.*rotate it/);
  }
});

test("urls: only the user, the first character of the password and the host are shown", () => {
  const [finding] = checkServers(
    http("http://alice:s3cr3t@Host.Example.com:8443/path/x?token=abc#frag"),
  );
  assert.equal(finding?.current, "http://a****:s****@host.example.com:8443");
  assert.doesNotMatch(finding?.current ?? "", /path|token|frag|s3cr3t/);
  assert.doesNotMatch(finding?.fix ?? "", /alice|s3cr3t|path|token/);
  assert.doesNotMatch(finding?.current ?? "", /alice/);
});

test("urls: the user is hidden like the password, because a token is often sent as the user", () => {
  const [finding] = checkServers(
    http("https://ghp_abcdefgh:x-oauth-basic@github.com/mcp"),
  );
  assert.equal(finding?.current, "https://g****:x****@github.com");
  assert.doesNotMatch(finding?.current ?? "", /ghp_|abcdefgh|oauth/);
  // The user is decoded like the password.
  const [encoded] = checkServers(
    http("https://%67hp_abcdefgh:%78token@github.com/mcp"),
  );
  assert.equal(encoded?.current, "https://g****:x****@github.com");
});

test("urls: a long user and a long host never cut the markers off", () => {
  const url = `https://${"u".repeat(300)}:${"p".repeat(300)}@${"h".repeat(60)}.example.com/mcp`;
  const [finding] = checkServers(http(url));
  assert.ok(finding);
  assert.ok(
    finding.current.startsWith("https://u****:p****@hhhh"),
    finding.current,
  );
  assert.doesNotMatch(finding.current, /uu|pp/);
});

test("urls: a credential in a URL the parser rejects still gets the credential advice", () => {
  const rejected = [
    "ftp://u:s3cr3t@host.example.com",
    "https://u:s3cr3t@host.example.com:99999/mcp",
    "https://u:s3cr3t@/mcp",
    "alice:s3cr3t@host.example.com/mcp",
    ":s3cr3t@host.example.com/mcp",
    "//alice:s3cr3t@host.example.com/mcp",
    "https://alice:s3cr3t#x@host.example.com/mcp",
  ];
  for (const url of rejected) {
    const [finding] = checkServers(http(url));
    assert.equal(finding?.rule, "mcp-url", url);
    assert.match(finding?.fix ?? "", /absolute http or https URL/, url);
    assert.match(
      finding?.fix ?? "",
      /a credential is in the URL.*rotate it/,
      url,
    );
    assert.equal(finding?.current, `string (${url.length} chars)`, url);
  }
});

test("urls: a rejected URL without a credential gets no credential advice", () => {
  for (const url of [
    "/mcp",
    "ftp://host.example.com",
    "https://host.example.com:99999/mcp",
    "ws://host.example.com/a@b",
  ]) {
    const [finding] = checkServers(http(url));
    assert.doesNotMatch(finding?.fix ?? "", /credential/, url);
  }
});

test("urls: a user name without a password is described, not shown", () => {
  const [finding] = checkServers(http("https://tok3n@host.example.com/mcp"));
  assert.equal(
    finding?.current,
    `string (${"https://tok3n@host.example.com/mcp".length} chars)`,
  );
  assert.match(finding?.fix ?? "", /remove the user info/);
});

test("urls: the password is shown with its first character only, whatever it is", () => {
  const [finding] = checkServers(
    http("https://alice:%C3%A9secret@host.example.com"),
  );
  assert.equal(finding?.current, "https://a****:é****@host.example.com");
});

// Every kind of text a manifest can hold, with a password and a user name in it.
const PLACEMENTS: Record<string, (value: string) => object[]> = {
  url: (v) => checkServers(http(v)),
  "url on a stdio server": (v) =>
    checkServers({ s: { type: "stdio", command: "node", url: v } }),
  "server name": (v) =>
    checkServers({ [v]: { type: "stdio", command: "node bin" } }),
  "header name": (v) =>
    checkServers(
      http("https://host.example.com/mcp", { headers: { [v]: "v" } }),
    ),
  "header value": (v) =>
    checkServers(
      http("https://host.example.com/mcp", { headers: { A: `${v}\u0000` } }),
    ),
  "duplicate header names": (v) =>
    checkServers(
      http("https://host.example.com/mcp", {
        headers: { [v]: "a", [v.toUpperCase()]: "b" },
      }),
    ),
  cwd: (v) => checkServers({ s: { type: "stdio", command: "node", cwd: v } }),
  command: (v) => checkServers({ s: { type: "stdio", command: v } }),
  "command with args": (v) =>
    checkServers({ s: { type: "stdio", command: `node ${v}`, args: [v] } }),
  "args item": (v) =>
    checkServers({ s: { type: "stdio", command: "node", args: [v, 3] } }),
  "args as a string": (v) =>
    checkServers({ s: { type: "stdio", command: "node", args: v } }),
  "env value": (v) =>
    checkServers({
      s: { type: "stdio", command: "node", env: { A: v, B: 3 } },
    }),
  "env key": (v) =>
    checkServers({ s: { type: "stdio", command: "node", env: { [v]: 3 } } }),
  "unknown server field": (v) =>
    checkServers(http("https://host.example.com/mcp", { [v]: 1 })),
  "server as a string": (v) => checkServers({ s: v }),
  "transport value": (v) =>
    checkServers({ s: { transport: v, command: "node" } }),
  "server type": (v) => checkServers({ s: { type: v, command: "node" } }),
  "plugin name": (v) => checkPlugin({ name: v }),
  "plugin version": (v) => checkPlugin({ name: "example-plugin", version: v }),
  "extensions key": (v) =>
    checkPlugin({ name: "example-plugin", extensions: { [v]: {} } }),
  "extensions value": (v) =>
    checkPlugin({ name: "example-plugin", extensions: { "com.example.c": v } }),
  "keywords string": (v) =>
    checkPlugin({ name: "example-plugin", keywords: v }),
  "keywords item": (v) =>
    checkPlugin({ name: "example-plugin", keywords: [v, 3] }),
  "author string": (v) => checkPlugin({ name: "example-plugin", author: v }),
  "author field": (v) =>
    checkPlugin({ name: "example-plugin", author: { name: 3, [v]: 1 } }),
  "unknown plugin field": (v) =>
    checkPlugin({ name: "example-plugin", [v]: 1 }),
  "description as an object": (v) =>
    checkPlugin({ name: "example-plugin", description: { [v]: v } }),
};

test("no finding repeats free text: the user name and the password never appear in current or fix", () => {
  const values = [...PARSED_CREDENTIALS, ...OTHER_CREDENTIAL_SHAPES];
  let checked = 0;
  for (const value of values) {
    for (const [placement, run] of Object.entries(PLACEMENTS)) {
      const findings = run(value) as {
        rule: string;
        field: string;
        current: string;
        fix: string;
      }[];
      for (const finding of findings) {
        const where = `${placement}: ${JSON.stringify(value)}`;
        for (const text of [finding.current, finding.fix, finding.field]) {
          assert.doesNotMatch(text, /s3cr3t/, where);
          assert.ok(!text.includes(value.trim()), where);
          assert.doesNotMatch(text, /x@|host\.example\.com\/mcp/, where);
        }
        // The user name never appears, except as the plain part before the ":" of a header name
        // (`Name: value` pasted as a name): that part is a name, and is shown on purpose.
        const pastedName =
          finding.rule === "mcp-headers" && placement.includes("header name");
        assert.ok(pastedName || !finding.fix.includes("alice"), where);
        assert.ok(!finding.current.includes("alice"), where);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 500, `only ${checked} findings were checked`);
});

test("findings describe free text by its size, and show numbers and booleans as they are", () => {
  const [name] = checkPlugin({ name: "My Plugin" });
  assert.equal(name?.current, "string (9 chars)");
  const [version] = checkPlugin({ name: "example-plugin", version: 1.2 });
  assert.equal(version?.current, "1.2");
  const [license] = checkPlugin({ name: "example-plugin", license: true });
  assert.equal(license?.current, "true");
  const [command] = checkServers({
    s: { type: "stdio", command: "bin/server" },
  });
  assert.equal(command?.current, "string (10 chars)");
});

test("a plain name is shown in current, and anything else is described", () => {
  for (const type of ["http", "Local", "websocket", "uzer7q"]) {
    const finding = checkServers({ s: { type, command: "node" } }).find(
      (f) => f.rule === "mcp-server-type",
    );
    assert.equal(finding?.current, JSON.stringify(type), type);
  }
  for (const type of [
    "uzer7q pz9k3w",
    "x".repeat(65),
    "a:b",
    "https://u:p@h",
    "",
  ]) {
    const finding = checkServers({ s: { type, command: "node" } }).find(
      (f) => f.rule === "mcp-server-type",
    );
    assert.equal(
      finding?.current,
      `string (${type.length} chars)`,
      JSON.stringify(type),
    );
  }
});

test("plain names are shown for a plugin name, a namespace, a keyword and a transport", () => {
  const [name] = checkPlugin({ name: "My-Plugin" });
  assert.equal(name?.current, '"My-Plugin"');
  const [spaced] = checkPlugin({ name: "My Plugin" });
  assert.equal(spaced?.current, "string (9 chars)");
  const [namespace] = checkPlugin({
    name: "example-plugin",
    extensions: { poracode: {} },
  });
  assert.equal(namespace?.current, '"poracode"');
  assert.match(
    namespace?.fix ?? "",
    /^the namespace is the reverse domain of the client these settings are for, e\.g\. "com\.example\.myclient" for a client at example\.com\. Use the namespace that client documents: the client reads its settings by this key, so a guessed name means it stops reading them$/,
  );
  const [odd] = checkPlugin({
    name: "example-plugin",
    extensions: { "my client": {} },
  });
  assert.equal(odd?.current, "string (9 chars)");
  const [keywords] = checkPlugin({ name: "example-plugin", keywords: "ai" });
  assert.equal(keywords?.current, '"ai"');
  const [transport] = checkServers({
    s: { transport: "stdio", command: "node" },
  });
  assert.equal(transport?.current, '"stdio"');
  const [renamed] = checkServers({ s: { transport: "a b", command: "node" } });
  assert.equal(renamed?.current, "string (3 chars)");
});

test("values are described even when they look like names: env values, headers, urls, command, args, cwd", () => {
  const findings = checkServers({
    s: {
      type: "stdio",
      command: "bin",
      args: [3],
      cwd: "data",
      env: { A: 3 },
    },
  });
  for (const finding of findings) {
    assert.doesNotMatch(finding.current, /bin|data/, finding.field);
  }
});

test("field shows plain keys and […] for the others", () => {
  const findings = checkServers({
    outlook: {
      type: "stdio",
      command: "node",
      env: { "A B": 3 },
      "odd key": 1,
    },
    "odd server": { type: "stdio", command: "bin/x" },
  });
  const fields = findings.map((f) => f.field).sort();
  assert.deepEqual(
    fields,
    [
      "mcpServers.outlook.env[…]",
      "mcpServers.outlook[…]",
      "mcpServers[…].command",
    ].sort(),
  );
});

test("env: a pasted NAME=value is flagged without repeating the value", () => {
  const findings = checkServers({
    outlook: {
      type: "stdio",
      command: "node",
      env: {
        "MS365_TOKEN=abc123secret": "x",
        "weird name=value": "y",
        OK: "z",
      },
    },
  });
  assert.deepEqual(
    findings.map((f) => [f.rule, f.level, f.field, f.current]),
    [
      [
        "mcp-env-name",
        "warning",
        "mcpServers.outlook.env[…]",
        'name (24 chars) with "="',
      ],
      [
        "mcp-env-name",
        "warning",
        "mcpServers.outlook.env[…]",
        'name (16 chars) with "="',
      ],
    ],
  );
  for (const finding of findings) {
    assert.equal(
      finding.fix,
      "remove this entry: env values are visible package data, and the spec forbids credentials in them (§9.2). Let the server get the credential through its own sign-in or a client setting. Rotate it: removing it from the file doesn't remove it from the repository's history.",
    );
  }
  assert.doesNotMatch(JSON.stringify(findings), /abc123secret|weird/);
});

test("env: NAME=value, NAME= and =value each give one warning, and none of the key is shown", () => {
  const keys = [
    "EXAMPLE_TOKEN=abc123secret",
    "EXAMPLE_TOKEN=",
    "=abc123secret",
  ];
  for (const key of keys) {
    for (const value of ["", "x"]) {
      const findings = checkServers({
        s: {
          type: "stdio",
          command: "node",
          env: { [key]: value, EXAMPLE_MCP_CACHE_DIR: "x" },
        },
      });
      const where = `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
      // Only a warning, so `valid` stays true.
      assert.deepEqual(
        findings.map((f) => [f.rule, f.level, f.field]),
        [["mcp-env-name", "warning", "mcpServers.s.env[…]"]],
        where,
      );
      for (const finding of findings) {
        for (const text of [finding.current, finding.fix, finding.field]) {
          assert.doesNotMatch(text, /EXAMPLE_TOKEN|abc123secret/, where);
        }
      }
    }
  }
});

test("env: a plain name gives nothing", () => {
  assert.deepEqual(
    checkServers({
      s: {
        type: "stdio",
        command: "node",
        env: { EXAMPLE_MCP_CACHE_DIR: "cache" },
      },
    }),
    [],
  );
});

test("headers: a pasted Name: value keeps only a plain name", () => {
  const findings = checkServers(
    http("https://a.example.com/mcp", {
      headers: { "Authorization: Bearer s3cr3t": "x", "we ird: v": "y" },
    }),
  );
  assert.equal(findings.length, 2);
  assert.equal(findings[0]?.current, 'name (28 chars) with ":"');
  assert.match(
    findings[0]?.fix ?? "",
    /^use "Authorization" as the header name and put the value in the value\..*Rotate it: removing it from the file doesn't remove it from the repository's history\.$/,
  );
  assert.match(findings[1]?.fix ?? "", /^a header name can't contain ":"/);
  assert.doesNotMatch(JSON.stringify(findings), /s3cr3t|Bearer|we ird/);
});

test("headers: a tab in a value is fine, a CR, LF or NUL is not", () => {
  const ok = checkServers(
    http("https://a.example.com/mcp", { headers: { A: "x\ty" } }),
  );
  assert.deepEqual(ok, []);
  for (const bad of ["x\ry", "x\ny", "x\u0000y", "x\u007fy"]) {
    const findings = checkServers(
      http("https://a.example.com/mcp", { headers: { A: bad } }),
    );
    assert.deepEqual(
      findings.map((f) => f.rule),
      ["mcp-headers"],
    );
  }
});

test("headers: names follow the token grammar", () => {
  for (const name of ["X-Tenant", "Accept", "x_y", "A.B", "!#$%&'*+-.^_`|~"]) {
    const findings = checkServers(
      http("https://a.example.com/mcp", { headers: { [name]: "v" } }),
    );
    assert.deepEqual(findings, [], name);
  }
});

test("headers: three spellings of one name are one finding", () => {
  const findings = checkServers(
    http("https://a.example.com/mcp", {
      headers: { "x-tenant": "a", "X-Tenant": "b", "X-TENANT": "c" },
    }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.field, "mcpServers.s.headers.X-Tenant");
});

test("semantic rules ignore servers whose shape can't be told", () => {
  const findings = checkServers({
    s: { command: "node server.js", url: "http://a.example.com/mcp" },
  });
  assert.deepEqual(
    findings.map((f) => f.rule),
    ["mcp-server-type"],
  );
});

test("the semantic rules run on the inferred shape when the type is wrong", () => {
  const findings = checkServers({
    s: { type: "http", url: "http://a.example.com/mcp" },
  });
  assert.deepEqual(
    findings.map((f) => [f.rule, f.fix.slice(0, 16)]),
    [
      ["mcp-server-type", 'use "streamable-'],
      ["mcp-url", 'use "https" inst'],
    ],
  );
});
