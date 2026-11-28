// Corrects a bug in a dependency after every install (npm's postinstall). Run by hand with:
// node app/scripts/patch-dependencies.ts
//
// prosemirror-transform's replace fitter can join two nodes whose content doesn't match. Deleting from a callout's
// title into a quote that follows, or from a quote into a callout's body, makes a step that joins a callout and a
// quote. Applying it threw "Cannot join blockquote onto callout", so typing, Backspace, cut, or a command over such a
// selection crashed the page. The fitter checks that the two nodes' content matches only when nothing follows the
// end of the range. The step joins them in both cases, so the check belongs in both. A callout's content starts
// with its title, which no other node holds, so the callout is the node this reaches.
//
// prosemirror-view writes its hide-selection class on the editor each time it draws the selection. It removes the
// class when the selection shows and adds it when it doesn't, whether the editor has it or not. Removing a class the
// element lacks still writes its class attribute. So an update between two keys wrote the editor's class with the
// value it had, as when a table's feature joins its editor (typing-writes spec). The patch toggles the class with the
// state it should have, which writes nothing when the editor has that state already.
//
// Each patch names the exact text it replaces. When a new version of the dependency changes that text, the install
// fails here, so the patch is looked at again rather than lost.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Patch {
  /** The file, from the repository's root. */
  file: string;
  /** The text the dependency ships. */
  from: RegExp;
  /** The text it becomes. */
  to: string;
}

const FITTER = /if \(index == node\.childCount && !type\.compatibleContent\(node\.type\)\)/;
const FITTER_FIXED = 'if (!type.compatibleContent(node.type))';

const HIDE = new RegExp(
  String.raw`if \(sel\.visible\) \{\s*view\.dom\.classList\.remove\("ProseMirror-hideselection"\);\s*\}` +
    String.raw`\s*else \{\s*view\.dom\.classList\.add\("ProseMirror-hideselection"\);`,
);
const HIDE_FIXED = 'view.dom.classList.toggle("ProseMirror-hideselection", !sel.visible); if (!sel.visible) {';

export const PATCHES: readonly Patch[] = [
  { file: 'node_modules/prosemirror-transform/dist/index.js', from: FITTER, to: FITTER_FIXED },
  { file: 'node_modules/prosemirror-transform/dist/index.cjs', from: FITTER, to: FITTER_FIXED },
  { file: 'node_modules/prosemirror-view/dist/index.js', from: HIDE, to: HIDE_FIXED },
  { file: 'node_modules/prosemirror-view/dist/index.cjs', from: HIDE, to: HIDE_FIXED },
];

/** The file's text with the patch made, the same text when it was made before, or an error when neither fits. */
export function patched(text: string, patch: Patch): string {
  if (text.includes(patch.to) && !patch.from.test(text)) return text;
  const count = text.split(patch.from).length - 1;
  if (count !== 1) {
    throw new Error(`${patch.file}: the text to patch appears ${count} times, not once. Look at the patch again.`);
  }
  return text.replace(patch.from, patch.to);
}

function main(): void {
  const root = join(import.meta.dirname, '..', '..');
  for (const patch of PATCHES) {
    const path = join(root, patch.file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const next = patched(text, patch);
    if (next !== text) writeFileSync(path, next);
  }
}

if (import.meta.main) main();
