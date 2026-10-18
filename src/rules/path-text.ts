// Text-only path handling for the MCP rules. Nothing here touches the filesystem.

/** The segments that name something: no empty ones, no ".", and no "..". */
export function namedSegments(path: string): string[] {
  return path.split("/").filter((s) => s !== "" && s !== "." && s !== "..");
}

/** True when resolving "." and ".." segments climbs above the starting directory. */
export function escapes(path: string): boolean {
  let depth = 0;
  for (const segment of path.split("/")) {
    if (segment === "..") depth -= 1;
    else if (segment !== "" && segment !== ".") depth += 1;
    if (depth < 0) return true;
  }
  return false;
}

export function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}
