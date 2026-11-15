// A ruler move changes some fields of the indent, not all of them. With several paragraphs selected, each one keeps
// the fields the move did not touch (text DESIGN.md 5.4), so a first-line drag leaves every left indent as it was.
import { selectionParaTargets, paraAt, validParaValue } from '../../../editor/commands/paragraph';
import { fromChange } from '../../../editor/commands/command';
import type { Change, Command } from '../../../editor/commands/command';
import { viaFormatTarget } from '../../../editor/commands/formatTarget';
import { META_ELEMENT_DATA } from '../../../editor/meta';
import { paraFormat } from '../../../editor/paragraph/attributes';
import type { Indent } from '../../../editor/paragraph/attributes';

const NONE: Indent = { start: 0, end: 0, first: 0 };

/** The fields of `next` that differ from `old`. */
export function indentPatch(old: Indent, next: Indent): Partial<Indent> {
  const patch: Partial<Indent> = {};
  for (const key of ['start', 'end', 'first'] as const) if (next[key] !== old[key]) patch[key] = next[key];
  return patch;
}

const merged = (old: Indent | undefined, patch: Partial<Indent>): Indent | null => {
  const next = { ...(old ?? NONE), ...patch };
  return next.start === 0 && next.end === 0 && next.first === 0 ? null : next;
};

/** Sets only the patched indent fields on every selected paragraph; each keeps its own other fields. */
export function setIndentFields(patch: Partial<Indent>): Command {
  const change: Change = (tr) => {
    let changed = false;
    for (const { node, pos } of selectionParaTargets(tr.doc, tr.selection)) {
      const old = paraFormat(node.attrs).indent;
      const next = merged(old, patch);
      if (next !== null && !validParaValue('indent', next)) continue;
      if (JSON.stringify(next) === JSON.stringify(old ?? null)) continue;
      tr.setNodeAttribute(tr.mapping.map(pos), 'indent', next);
      changed = true;
    }
    if (changed) tr.setMeta(META_ELEMENT_DATA, true);
    return changed;
  };
  return (state, dispatch) =>
    viaFormatTarget({ format: 'para', key: 'indent', value: merged(paraAt(state).indent, patch) }, fromChange(change))(
      state,
      dispatch,
    );
}
