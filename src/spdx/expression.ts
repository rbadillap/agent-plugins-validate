// A parser for SPDX license expressions, following the grammar in Annex D of the SPDX 3.0
// specification: https://github.com/spdx/spdx-spec/blob/v3.0/docs/annexes/SPDX-license-expressions.md
//
//   simple-expression   = license-id / license-id"+" / license-ref
//   addition-expression = license-exception-id / addition-ref
//   compound-expression = simple-expression
//                       / simple-expression ("WITH" / "with") addition-expression
//                       / compound-expression ("AND" / "and") compound-expression
//                       / compound-expression ("OR" / "or") compound-expression
//                       / "(" compound-expression ")"
//
// WITH binds tighter than AND, and AND tighter than OR. Operators are all upper or all lower case.
// Whether an id is on the SPDX License List is not decided here: the parser only returns the ids.

const IDSTRING = "[A-Za-z0-9.-]+";
const LICENSE_REF = new RegExp(
  `^(?:DocumentRef-${IDSTRING}:)?LicenseRef-${IDSTRING}$`,
);
const ADDITION_REF = new RegExp(
  `^(?:DocumentRef-${IDSTRING}:)?AdditionRef-${IDSTRING}$`,
);
// No white space is allowed between an id and its "+".
const LICENSE_ID = new RegExp(`^(${IDSTRING})\\+?$`);
const EXCEPTION_ID = new RegExp(`^${IDSTRING}$`);

// Deeper nesting is refused rather than parsed, so that a crafted value can't exhaust the stack.
const MAX_DEPTH = 64;

const OPERATORS = new Map<string, "AND" | "OR" | "WITH">([
  ["AND", "AND"],
  ["and", "AND"],
  ["OR", "OR"],
  ["or", "OR"],
  ["WITH", "WITH"],
  ["with", "WITH"],
]);

/** An id the list has to vouch for. `LicenseRef-` and `AdditionRef-` terms are not ids. */
export interface ExpressionId {
  kind: "license" | "exception";
  /** The id, without a trailing "+". */
  id: string;
  /** Position among all the terms of the expression, from 0. Refs count too. */
  term: number;
}

export type ParsedExpression =
  | { ok: true; ids: ExpressionId[]; terms: number }
  | { ok: false };

/** Words and parentheses. White space only separates; a word is a run of anything else. */
function tokenize(text: string): string[] {
  return text.match(/[()]|[^\s()]+/g) ?? [];
}

class Invalid extends Error {}

export function parseExpression(text: string): ParsedExpression {
  // White space separates the parts of an expression; it doesn't surround one.
  if (text.trim() !== text) return { ok: false };
  const tokens = tokenize(text);
  const ids: ExpressionId[] = [];
  let position = 0;
  let terms = 0;
  let depth = 0;

  const peek = () => tokens[position];
  const operator = () => OPERATORS.get(tokens[position] ?? "");
  const fail = (): never => {
    throw new Invalid();
  };

  /** The next word, which must be a term: an id or a ref, not an operator or a parenthesis. */
  const term = (): { text: string; index: number } => {
    const text = peek();
    if (text === undefined || text === "(" || text === ")" || operator()) {
      return fail();
    }
    position++;
    return { text, index: terms++ };
  };

  const simple = (): void => {
    const token = term();
    if (LICENSE_REF.test(token.text)) return;
    const id = LICENSE_ID.exec(token.text)?.[1] ?? fail();
    ids.push({ kind: "license", id, term: token.index });
  };

  const addition = (): void => {
    const token = term();
    if (ADDITION_REF.test(token.text)) return;
    if (!EXCEPTION_ID.test(token.text)) fail();
    ids.push({ kind: "exception", id: token.text, term: token.index });
  };

  const primary = (): void => {
    if (peek() === "(") {
      if (++depth > MAX_DEPTH) fail();
      position++;
      or();
      if (peek() !== ")") fail();
      position++;
      depth--;
      return;
    }
    simple();
    if (operator() === "WITH") {
      position++;
      addition();
    }
  };

  const and = (): void => {
    primary();
    while (operator() === "AND") {
      position++;
      primary();
    }
  };

  const or = (): void => {
    and();
    while (operator() === "OR") {
      position++;
      and();
    }
  };

  try {
    or();
    if (position !== tokens.length) fail();
  } catch (error) {
    if (error instanceof Invalid) return { ok: false };
    throw error;
  }
  return { ok: true, ids, terms };
}
