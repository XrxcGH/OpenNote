// The code commands' work (owner: WP6), loaded on first use so start-up stays small.
import type { Editor } from '@tiptap/core';
import { codeBlockAt, leaveCode } from '../../../editor/commands/code';
import { languagePicker } from '../../../editor/highlight/picker';
import { announce } from '../../../ui';
import { openLanguagePicker } from './picker';

/** Opens the language picker at the language button of the code block with the caret. */
export function openCodeLanguage(editor: Editor): boolean {
  const at = codeBlockAt(editor.state);
  if (!at) return false;
  const block = editor.view.nodeDOM(at.pos);
  const anchor =
    (block instanceof HTMLElement && block.querySelector<HTMLElement>('[data-code-language]')) ||
    (block instanceof HTMLElement ? block : editor.view.dom);
  const language = (at.node.attrs.language as string | null) ?? null;
  const request = { view: editor.view, pos: at.pos, anchor, language };
  const picker = languagePicker();
  if (picker) picker(request);
  else openLanguagePicker(request, { announce });
  return true;
}

/** Leaves the code block with the caret for a new paragraph below it. */
export function leaveCodeBlock(editor: Editor): boolean {
  return leaveCode(editor.state, editor.view.dispatch);
}
