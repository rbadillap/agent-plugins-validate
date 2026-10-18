import mcp100 from "../../schemas/1.0.0/mcp.schema.json" with { type: "json" };
import plugin100 from "../../schemas/1.0.0/plugin.schema.json" with {
  type: "json",
};
import type { SchemaRegistry } from "./registry.ts";
import { createRegistry } from "./registry.ts";

let registry: SchemaRegistry | undefined;

/** The versions vendored in `schemas/`, compiled on first use. */
export function vendoredRegistry(): SchemaRegistry {
  registry ??= createRegistry({ "1.0.0": { plugin: plugin100, mcp: mcp100 } });
  return registry;
}
