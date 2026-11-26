// The Language menu (lane text:language-direction): the page's languages and the installed spell checkers'
// languages by name, "Use the page language", and "Do not check spelling". It loads when the command runs.
import type { Editor } from '@tiptap/core';
import { spellingLanguages } from '../../../state/language';
import { t } from '../../../strings/t';
import { announce, openMenu } from '../../../ui';
import { spellingEngine } from './current';
import { caretAnchor, languageChoices, languageItems, selectionLanguage } from './setLanguage';

/** Opens the Language menu at the caret. Resolves with the chosen item's id, or null. */
export async function openLanguageMenu(editor: Editor): Promise<string | null> {
  const installed =
    (await spellingEngine()
      ?.languages()
      .catch(() => [])) ?? [];
  const tags = languageChoices(
    spellingLanguages(),
    installed.map((language) => language.tag),
    selectionLanguage(editor.state),
  );
  const label = editor.state.selection.empty ? 'textLanguage.paragraphMenuLabel' : 'textLanguage.menuLabel';
  return openMenu({
    label: t(label),
    items: languageItems(editor, tags, (text) => announce(text)),
    anchor: caretAnchor(editor),
  });
}
