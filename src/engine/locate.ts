import type { Node, ParseError } from "jsonc-parser";
import { parseTree } from "jsonc-parser";
import type { PathPart } from "./types.ts";

export interface Position {
  line: number;
  column: number;
}

export type Locator = (path: readonly PathPart[]) => Position | undefined;

/**
 * Where JSON.parse says the text is wrong, as an offset. `JSON.parse` stays the authority on
 * validity: jsonc-parser is only asked where things are, and never decides whether a file is valid.
 */
function parseErrorOffset(text: string, message: string): number {
  const fromMessage = /at position (\d+)/.exec(message)?.[1];
  if (fromMessage !== undefined) return Number(fromMessage);
  const errors: ParseError[] = [];
  parseTree(text, errors, {
    disallowComments: true,
    allowTrailingComma: false,
  });
  return errors[0]?.offset ?? text.length;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function toPosition(starts: readonly number[], offset: number): Position {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
}

/** The node a path leads to, and the offset to point at: the key of a property, or the item itself. */
function find(
  root: Node,
  path: readonly PathPart[],
): { offset: number } | undefined {
  let node: Node = root;
  let offset = root.offset;
  for (const part of path) {
    const children = node.children ?? [];
    if (node.type === "object" && typeof part === "string") {
      // With duplicate keys the last one wins, as in JSON.parse.
      const property = children.findLast(
        (child) => child.children?.[0]?.value === part,
      );
      const key = property?.children?.[0];
      const value = property?.children?.[1];
      if (key === undefined || value === undefined) return undefined;
      node = value;
      offset = key.offset;
    } else if (node.type === "array" && typeof part === "number") {
      const item = children[part];
      if (item === undefined) return undefined;
      node = item;
      offset = item.offset;
    } else {
      return undefined;
    }
  }
  return { offset };
}

/** Builds a locator for one file. Parsing happens once, however many findings point into the file. */
export function createLocator(text: string): Locator {
  const root = parseTree(text, [], {
    disallowComments: true,
    allowTrailingComma: false,
  });
  const starts = lineStarts(text);
  return (path) => {
    if (root === undefined) return undefined;
    // A missing field is reported where its parent is: the parent's key, or its opening brace.
    for (let length = path.length; length >= 0; length--) {
      const found = find(root, path.slice(0, length));
      if (found !== undefined) return toPosition(starts, found.offset);
    }
    return undefined;
  };
}

/**
 * Line and column (both 1-based) of a value in the text. `path` is the keys and indexes of a
 * finding's field.
 */
export function locate(
  text: string,
  path: readonly PathPart[],
): Position | undefined {
  return createLocator(text)(path);
}

/** Line and column of the syntax error `JSON.parse` reported with `message`. */
export function locateParseError(text: string, message: string): Position {
  return toPosition(lineStarts(text), parseErrorOffset(text, message));
}
