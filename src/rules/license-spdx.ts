import type { Problem, Rule, RuleContext } from "../engine/types.ts";
import { type ExpressionId, parseExpression } from "../spdx/expression.ts";
import {
  CURRENT_LICENSE_IDS,
  EXCEPTION_IDS,
  LICENSE_IDS,
} from "../spdx/list.ts";
import { isObject, quote } from "./util.ts";

/** Lowercase letters and digits only, without the words that don't tell licenses apart. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(?:the|license|licence|version)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

const GPL = (name: string, version: string): string[] => [
  `${name}-${version}-only`,
  `${name}-${version}-or-later`,
];

// Well-known spellings that aren't an SPDX id in any case, keyed by their normalized form. A GPL
// family name without "-only" or "-or-later" has two possible meanings, so both are offered.
const SPELLINGS = new Map<string, readonly string[]>([
  ["apache2", ["Apache-2.0"]],
  ["apachev2", ["Apache-2.0"]],
  ["apachev20", ["Apache-2.0"]],
  ["gpl2", GPL("GPL", "2.0")],
  ["gplv2", GPL("GPL", "2.0")],
  ["gpl20", GPL("GPL", "2.0")],
  ["gplv20", GPL("GPL", "2.0")],
  ["gpl3", GPL("GPL", "3.0")],
  ["gplv3", GPL("GPL", "3.0")],
  ["gpl30", GPL("GPL", "3.0")],
  ["gplv30", GPL("GPL", "3.0")],
  ["lgpl21", GPL("LGPL", "2.1")],
  ["lgplv21", GPL("LGPL", "2.1")],
  ["lgpl3", GPL("LGPL", "3.0")],
  ["lgplv3", GPL("LGPL", "3.0")],
  ["lgpl30", GPL("LGPL", "3.0")],
  ["lgplv30", GPL("LGPL", "3.0")],
  ["agpl3", GPL("AGPL", "3.0")],
  ["agplv3", GPL("AGPL", "3.0")],
  ["agpl30", GPL("AGPL", "3.0")],
  ["agplv30", GPL("AGPL", "3.0")],
  ["bsd2", ["BSD-2-Clause"]],
  ["simplifiedbsd", ["BSD-2-Clause"]],
  ["bsd3", ["BSD-3-Clause"]],
  ["newbsd", ["BSD-3-Clause"]],
  ["modifiedbsd", ["BSD-3-Clause"]],
  ["mpl2", ["MPL-2.0"]],
]);

function byLowercase(ids: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of ids) map.set(id.toLowerCase(), id);
  return map;
}

// A deprecated id is matched last, so that a spelling with a current id is fixed to it.
const CURRENT_BY_LOWERCASE = byLowercase(CURRENT_LICENSE_IDS);
const LICENSES_BY_LOWERCASE = byLowercase(LICENSE_IDS);
const EXCEPTIONS_BY_LOWERCASE = byLowercase(EXCEPTION_IDS);

// Current license ids by their normalized form. Two ids with the same form are dropped: a fix
// suggests an id only when the spelling can mean nothing else.
const LICENSES_BY_FORM = (() => {
  const map = new Map<string, string | null>();
  for (const id of CURRENT_LICENSE_IDS) {
    const form = normalize(id);
    map.set(form, map.has(form) ? null : id);
  }
  return map;
})();

/** The ids a license spelling most likely means, or nothing when it is unknown. */
function suggestLicense(text: string): readonly string[] | undefined {
  const lowercase = text.trim().toLowerCase();
  const exact = CURRENT_BY_LOWERCASE.get(lowercase);
  if (exact !== undefined) return [exact];
  const form = normalize(text);
  const spelled =
    form === ""
      ? undefined
      : (SPELLINGS.get(form) ?? LICENSES_BY_FORM.get(form));
  if (typeof spelled === "string") return [spelled];
  if (spelled !== null && spelled !== undefined) return spelled;
  const deprecated = LICENSES_BY_LOWERCASE.get(lowercase);
  return deprecated === undefined ? undefined : [deprecated];
}

function suggest(id: ExpressionId): readonly string[] | undefined {
  if (id.kind === "license") return suggestLicense(id.id);
  const exact = EXCEPTIONS_BY_LOWERCASE.get(id.id.toLowerCase());
  return exact === undefined ? undefined : [exact];
}

function known(id: ExpressionId): boolean {
  return id.kind === "license"
    ? LICENSE_IDS.has(id.id)
    : EXCEPTION_IDS.has(id.id);
}

function choices(ids: readonly string[]): string {
  return ids.map(quote).join(" or ");
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const ANY_LICENSE =
  'an id from the SPDX License List, e.g. "MIT", or "LicenseRef-" and a name of your own for a license that isn\'t on the list';
const ANY_EXPRESSION =
  'use an SPDX license expression, e.g. "MIT" or "MIT OR Apache-2.0"';

/**
 * The fix for a license that isn't an SPDX expression of known ids. It names ids from the list and
 * the position of the terms to change, never the text that was written.
 */
function fixFor(license: string): string {
  // A whole value that means one license is fixed as a whole: "Apache 2" is two words.
  const whole = suggestLicense(license);
  if (whole !== undefined) return `use ${choices(whole)}`;
  const parsed = parseExpression(license);
  if (!parsed.ok) return ANY_EXPRESSION;
  if (parsed.terms === 1) return `use ${ANY_LICENSE}`;
  const parts = parsed.ids
    .filter((id) => !known(id))
    .map((id) => {
      const suggested = suggest(id);
      const what =
        suggested !== undefined
          ? choices(suggested)
          : id.kind === "license"
            ? 'an SPDX License List id or a "LicenseRef-" id'
            : "an exception id from the SPDX License List";
      return `${what} for the ${ordinal(id.term + 1)} term`;
    });
  return `use ${parts.join(", and ")}`;
}

export const licenseSpdx: Rule = {
  id: "license-spdx",
  level: "notice",
  section: "5.4",
  effect:
    "The spec recommends an SPDX identifier for the license, so that people and tools can read it the same way. Clients still load the plugin.",
  appliesTo: "plugin",
  check(ctx: RuleContext): Problem[] {
    if (!ctx.parsed.ok || !isObject(ctx.parsed.value)) return [];
    const license = ctx.parsed.value.license;
    // A license that isn't a string is a type error, reported by field-type.
    if (typeof license !== "string") return [];
    const parsed = parseExpression(license);
    if (parsed.ok && parsed.ids.every(known)) return [];
    return [{ path: ["license"], current: license, fix: fixFor(license) }];
  },
};
