// Reads the release checklist and the device test matrix out of the development plan, so the script checks what
// the document says, and the two can't drift apart. If an item is added to the document, the checklist script fails
// until a check for it exists.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLAN_PATH = 'docs/DEVELOPMENT.md';

/** The text between a `## ` heading that starts with `title` and the next `## ` heading. */
export function sectionOf(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('## ') && line.slice(3).startsWith(title));
  if (start === -1) throw new Error(`${PLAN_PATH} has no section titled "${title}".`);
  const end = lines.findIndex((line, at) => at > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

/** The checklist items of section 10, with the check box and Markdown marks removed. */
export function checklistItems(markdown: string): string[] {
  const items = [...sectionOf(markdown, '10. Release checklist').matchAll(/^- \[[ xX]\] (.+)$/gm)];
  return items.map((match) => match[1].replace(/`/g, '').trim());
}

/** The device types in the first column of the device test matrix, section 7. */
export function deviceTypes(markdown: string): string[] {
  const rows = sectionOf(markdown, '7. Device test matrix')
    .split('\n')
    .filter((line) => line.startsWith('|'));
  return rows
    .slice(2)
    .map((row) => row.split('|')[1]?.trim() ?? '')
    .filter(Boolean);
}

/** Reads the development plan from a repository. */
export function readPlan(root: string): string {
  return readFileSync(join(root, PLAN_PATH), 'utf8');
}
