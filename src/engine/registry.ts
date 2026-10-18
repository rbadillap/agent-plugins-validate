import type { ValidateFunction } from "ajv/dist/2020.js";
import AjvModule from "ajv/dist/2020.js";
import type { ServerType } from "./types.ts";

// ajv is CommonJS: depending on the loader, the class is the default export or the module itself.
const Ajv2020 = (
  "default" in AjvModule ? AjvModule.default : AjvModule
) as typeof AjvModule.default;

/** The `$defs` entry that holds each MCP server shape in the vendored MCP schema. */
export const SERVER_DEFS: Record<ServerType, string> = {
  stdio: "stdioServer",
  "streamable-http": "streamableHttpServer",
  sse: "sseServer",
};

export interface SchemaSource {
  plugin: object;
  mcp: object;
}

export interface CompiledSchemas {
  plugin: ValidateFunction;
  mcp: ValidateFunction;
  servers: Record<ServerType, ValidateFunction>;
}

export interface SchemaRegistry {
  /** Supported versions, newest first. */
  versions: readonly string[];
  get(version: string): CompiledSchemas | undefined;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function idOf(schema: object): string {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== "string") throw new Error("A schema has no $id");
  return id;
}

function compile(
  ajv: InstanceType<typeof Ajv2020>,
  ref: string,
): ValidateFunction {
  const validate = ajv.getSchema(ref);
  if (validate === undefined)
    throw new Error(`Schema ${ref} could not be compiled`);
  return validate;
}

/** Compiles schemas that are already in memory. Nothing is loaded from a file or the network. */
export function createRegistry(
  sources: Record<string, SchemaSource>,
): SchemaRegistry {
  const compiled = new Map<string, CompiledSchemas>();
  for (const [version, source] of Object.entries(sources)) {
    const ajv = new Ajv2020({ allErrors: true, verbose: true });
    ajv.addSchema(source.plugin);
    ajv.addSchema(source.mcp);
    const mcpId = idOf(source.mcp);
    compiled.set(version, {
      plugin: compile(ajv, idOf(source.plugin)),
      mcp: compile(ajv, mcpId),
      servers: {
        stdio: compile(ajv, `${mcpId}#/$defs/${SERVER_DEFS.stdio}`),
        "streamable-http": compile(
          ajv,
          `${mcpId}#/$defs/${SERVER_DEFS["streamable-http"]}`,
        ),
        sse: compile(ajv, `${mcpId}#/$defs/${SERVER_DEFS.sse}`),
      },
    });
  }
  return {
    versions: [...compiled.keys()].sort((a, b) => compareVersions(b, a)),
    get: (version) => compiled.get(version),
  };
}
