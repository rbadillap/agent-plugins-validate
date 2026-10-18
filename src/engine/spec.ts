import { headings100 } from "./spec-headings.ts";

const SPEC_REPOSITORY =
  "https://github.com/agentplugins/agent-plugins-spec/blob";

const HEADINGS: Record<string, readonly string[]> = { "1.0.0": headings100 };

/** GitHub's anchor for a heading. */
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function headingsFor(version: string): readonly string[] {
  // A test-only version has no list of its own; it reuses the newest vendored one.
  return HEADINGS[version] ?? headings100;
}

/**
 * URL of a section of the tag-pinned specification. `section` is a numbered section such as "7.2.1",
 * or the text of an unnumbered heading such as "stdio". Throws when the section doesn't exist.
 */
export function specUrl(version: string, section: string): string {
  const heading = headingsFor(version).find(
    (h) => h === section || /^\d+(?:\.\d+)*/.exec(h)?.[0] === section,
  );
  if (heading === undefined) {
    throw new Error(
      `Section ${section} not found in the Agent Plugins ${version} specification`,
    );
  }
  return `${SPEC_REPOSITORY}/v${version}/spec/${version}.md#${slug(heading)}`;
}
