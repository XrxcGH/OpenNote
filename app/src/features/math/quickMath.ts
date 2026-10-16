// Quick math in text (Productivity and study tools): type a sum and an equals sign, such as 2.5*9.81=, then Space,
// and the answer follows. One Ctrl+Z takes the Space and the answer back out. A setting turns it off. The
// calculation is the table engine's, so a formula and a quick sum always agree.
import type { Editor } from '@tiptap/core';
import { EN_US, quickMath } from '../tables';
import type { Locale } from '../tables';
import { t } from '../../strings/t';

const KEY = 'opennote.math.quickMath';

export function quickMathEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setQuickMathEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // The choice lasts until the window closes.
  }
}

/** The person's number marks, from the browser's locale. */
export function browserLocale(): Locale {
  const tag = typeof navigator === 'undefined' || !navigator.language ? EN_US.tag : navigator.language;
  const parts = new Intl.NumberFormat(tag).formatToParts(1234567.5);
  const decimal = parts.find((part) => part.type === 'decimal')?.value === ',' ? ',' : '.';
  const group = parts.find((part) => part.type === 'group')?.value ?? ',';
  return { ...EN_US, tag, decimal, group: /\s/.test(group) ? ' ' : group, list: decimal === ',' ? ';' : ',' };
}

/**
 * Called right after a Space was typed. If the text before the caret is a sum that ends in an equals sign and a
 * space, the answer is added after the space. Returns whether it added one.
 */
export function applyQuickMath(editor: Editor, announce: (text: string) => void): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\u0000');
  if (!/=\s$/.test(before)) return false;
  const result = quickMath(before.slice(0, -1), browserLocale());
  if (!result) return false;
  if (result.kind === 'error') {
    announce(t('study.quickMath.error', { sum: result.expression }));
    return false;
  }
  return editor.chain().insertContent(result.text).run();
}
