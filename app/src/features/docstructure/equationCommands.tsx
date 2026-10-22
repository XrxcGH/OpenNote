// What the equation commands do (flag doc.equationNumbers): number or unnumber a display equation, number them all, and
// insert a reference to a numbered one. The commands are defined in features/page/registrations/docStructure.ts and
// load this file when first run.
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { numberingOf } from '../../editor/extensions/equationNumbers';
import { freeLabel, labelOf, refSource, stripLabels, withLabel } from '../../editor/equations';
import { META_COMMAND } from '../../editor/meta';
import { t } from '../../strings/t';
import { Dialog, RadioCard, RadioGroup, announce, showToast } from '../../ui';

/** The display equation the selection is on or in, with its place. */
function equationAt(editor: Editor): { pos: number; source: string } | null {
  const { selection, doc } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === 'mathBlock') {
    return { pos: selection.from, source: selection.node.attrs.source as string };
  }
  const $from = doc.resolve(selection.from);
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'mathBlock') {
      return { pos: $from.before(depth), source: $from.node(depth).attrs.source as string };
    }
  }
  const after = doc.nodeAt(selection.from);
  return after?.type.name === 'mathBlock' ? { pos: selection.from, source: after.attrs.source as string } : null;
}

const labelsIn = (editor: Editor): Set<string> =>
  new Set(
    numberingOf(editor.state.doc).blocks.flatMap((b) => {
      const label = labelOf(b.node.attrs.source as string);
      return label === null ? [] : [label];
    }),
  );

function setSource(editor: Editor, edits: readonly { pos: number; source: string }[]): void {
  const tr = editor.state.tr.setMeta(META_COMMAND, true);
  for (const { pos, source } of edits) {
    const node = tr.doc.nodeAt(pos);
    if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, source });
  }
  editor.view.dispatch(tr);
}

/** Gives the equation at the caret a label, so it has a number. */
export function numberEquation(editor: Editor): boolean {
  const found = equationAt(editor);
  if (!found) {
    announce(t('docStructure.eq.noEquation'));
    return false;
  }
  if (labelOf(found.source) === null) setSource(editor, [{ pos: found.pos, source: withLabel(found.source, freeLabel(labelsIn(editor))) }]);
  const { blocks, numbering } = numberingOf(editor.state.doc);
  const index = blocks.findIndex((b) => b.pos === found.pos);
  const message = t('docStructure.eq.numbered', { number: numbering.numbers[index] ?? 0 });
  announce(message);
  showToast({ message });
  return true;
}

/** Takes the label off the equation at the caret. */
export function unnumberEquation(editor: Editor): boolean {
  const found = equationAt(editor);
  if (!found) {
    announce(t('docStructure.eq.noEquation'));
    return false;
  }
  if (labelOf(found.source) === null) {
    announce(t('docStructure.eq.notNumbered'));
    return false;
  }
  setSource(editor, [{ pos: found.pos, source: stripLabels(found.source) }]);
  announce(t('docStructure.eq.unnumbered'));
  return true;
}

/** Labels every display equation that has no label. Returns how many it numbered. */
export function numberAllEquations(editor: Editor): number {
  const taken = labelsIn(editor);
  const edits: { pos: number; source: string }[] = [];
  for (const b of numberingOf(editor.state.doc).blocks) {
    const source = b.node.attrs.source as string;
    if (labelOf(source) !== null || source.trim() === '') continue;
    const label = freeLabel(taken);
    taken.add(label);
    edits.push({ pos: b.pos, source: withLabel(source, label) });
  }
  if (edits.length > 0) setSource(editor, edits);
  announce(t('docStructure.eq.numberedAll', { count: edits.length }));
  return edits.length;
}

interface Choice {
  key: string;
  number: number;
  source: string;
}

/** The numbered equations of the document, for the picker. */
export function choicesIn(editor: Editor): Choice[] {
  const { blocks, numbering } = numberingOf(editor.state.doc);
  return blocks.flatMap((b, i) => {
    const number = numbering.numbers[i];
    const key = labelOf(b.node.attrs.source as string);
    return number === null || key === null ? [] : [{ key, number, source: stripLabels(b.node.attrs.source as string) }];
  });
}

function Picker(props: { choices: readonly Choice[]; done(key: string | null): void }) {
  const [key, setKey] = useState(props.choices[0].key);
  return (
    <Dialog
      title={t('docStructure.eq.refTitle')}
      description={t('docStructure.eq.refDescription')}
      onDismiss={() => props.done(null)}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', leastDestructive: true, onPress: () => props.done(null) },
        { id: 'ok', label: t('docStructure.eq.refAction'), variant: 'primary', onPress: () => props.done(key) },
      ]}
    >
      <RadioGroup<string> label={t('docStructure.eq.refTitle')} value={key} onChange={setKey}>
        {props.choices.map((choice) => (
          <RadioCard<string>
            key={choice.key}
            value={choice.key}
            label={t('docStructure.eq.refChoice', { number: choice.number, source: choice.source.replace(/\s+/g, ' ').slice(0, 60) })}
          />
        ))}
      </RadioGroup>
    </Dialog>
  );
}

function pick(choices: readonly Choice[]): Promise<string | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    root.render(
      <Picker
        choices={choices}
        done={(key) => {
          queueMicrotask(() => {
            root.unmount();
            host.remove();
          });
          resolve(key);
        }}
      />,
    );
  });
}

/** Puts a reference to a numbered equation at the caret: an inline equation that shows the equation's number. */
export async function insertReference(editor: Editor): Promise<boolean> {
  const choices = choicesIn(editor);
  if (choices.length === 0) {
    announce(t('docStructure.eq.none'));
    showToast({ message: t('docStructure.eq.none') });
    return false;
  }
  const key = choices.length === 1 ? choices[0].key : await pick(choices);
  const type = editor.schema.nodes.mathInline;
  if (!key || !type || editor.isDestroyed) return false;
  const node = type.create({ source: refSource(key) });
  editor.view.dispatch(editor.state.tr.replaceSelectionWith(node, false).setMeta(META_COMMAND, true));
  editor.view.focus();
  const number = choices.find((c) => c.key === key)?.number ?? 0;
  announce(t('docStructure.eq.inserted', { number }));
  return true;
}
