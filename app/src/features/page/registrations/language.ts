// The registrations of Language, "Do not check spelling", paragraph direction, and automatic hyphenation (lane
// text:language-direction). This file loads at start-up, so it holds only definitions; the code loads when a
// command runs. Word keeps Language on the Review tab, the direction buttons in the Home tab's Paragraph group,
// and hyphenation on the Layout tab, and so does OpenNote.
import type { Editor } from '@tiptap/core';
import { commandBar, commands } from '../../../registries';
import type { CommandBarItem } from '../../../registries/types';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import type { IconName } from '../../../ui/icons';
import { announce } from '../../../ui';
import { targetEditor } from '../formattingBar/target';
import { shownQueue } from '../sync/shown';
import { say } from './say';

type Spec = {
  id: `${string}.${string}`;
  title: MessageKey;
  keywords: MessageKey;
  icon: IconName;
  checked?: (editor: Editor) => boolean;
  bar?: Pick<CommandBarItem, 'tab' | 'group' | 'priority' | 'presentation'>;
  run(editor: Editor): void | Promise<void>;
};

const PARAGRAPHS = new Set(['paragraph', 'heading', 'listItem']);

/** A paragraph attribute at the editor's caret, read without loading the editor's code. */
function paraAttr(editor: Editor, name: string): unknown {
  const { $head } = editor.state.selection;
  for (let depth = $head.depth; depth > 0; depth--) {
    const node = $head.node(depth);
    if (PARAGRAPHS.has(node.type.name) && node.attrs[name] != null) return node.attrs[name];
  }
  return null;
}

function add(spec: Spec): void {
  commands.register({
    id: spec.id,
    title: spec.title,
    keywords: spec.keywords,
    category: 'format',
    icon: spec.icon,
    flag: 'text.language',
    when: () => shownQueue.get() !== null,
    ...(spec.checked
      ? {
          checked: () => {
            const editor = targetEditor();
            return editor ? spec.checked!(editor) : false;
          },
        }
      : {}),
    run: async () => {
      const editor = targetEditor();
      if (editor) await spec.run(editor);
      else say(t('textLanguage.needsText'));
    },
  });
  if (spec.bar) commandBar.register({ id: spec.id, command: spec.id, flag: 'text.language', ...spec.bar });
}

const languageCode = () => import('../spelling/languageMenu');
const directionCode = () => import('../../../editor/extensions/direction');

add({
  id: 'text.setLanguage',
  title: 'textLanguage.language',
  keywords: 'textLanguage.languageKeywords',
  icon: 'Translate',
  bar: { tab: 'review', group: 'language', priority: 60, presentation: 'button' },
  run: async (editor) => void (await languageCode()).openLanguageMenu(editor),
});

add({
  id: 'text.noProof',
  title: 'textLanguage.noProof',
  keywords: 'textLanguage.noProofKeywords',
  icon: 'TextAa',
  checked: (editor) =>
    paraAttr(editor, 'lang') === 'zxx' || editor.state.selection.$from.marks().some((m) => m.attrs.lang === 'zxx'),
  run: async (editor) => {
    const { toggleNoProof, selectionLanguage } = await import('../spelling/setLanguage');
    if (!toggleNoProof(editor.state, editor.view.dispatch)) return;
    announce(t(selectionLanguage(editor.state) === 'zxx' ? 'textLanguage.noProofOn' : 'textLanguage.noProofOff'));
  },
});

const DIRECTIONS = [
  { dir: 'rtl', id: 'text.paragraphRtl', icon: 'ArrowLineLeft', priority: 25 },
  { dir: 'ltr', id: 'text.paragraphLtr', icon: 'ArrowLineRight', priority: 24 },
] as const;
for (const { dir, id, icon, priority } of DIRECTIONS) {
  add({
    id,
    title: `textLanguage.${dir}`,
    keywords: `textLanguage.${dir}Keywords`,
    icon,
    checked: (editor) => (paraAttr(editor, 'dir') === 'rtl') === (dir === 'rtl'),
    bar: { tab: 'home', group: 'paragraph', priority, presentation: 'toggle' },
    run: async (editor) => {
      if ((await directionCode()).setParagraphDirection(editor.state, editor.view.dispatch, dir)) {
        announce(t(`textLanguage.${dir}On`));
      }
    },
  });
}

add({
  id: 'text.hyphenate',
  title: 'textLanguage.hyphenate',
  keywords: 'textLanguage.hyphenateKeywords',
  icon: 'TextColumns',
  checked: (editor) => paraAttr(editor, 'hyphenate') === true,
  bar: { tab: 'layout', group: 'hyphenation', priority: 40, presentation: 'toggle' },
  run: async (editor) => {
    const on = paraAttr(editor, 'hyphenate') !== true;
    if ((await directionCode()).setParagraphAttr(editor.state, editor.view.dispatch, 'hyphenate', on)) {
      announce(t(on ? 'textLanguage.hyphenateOn' : 'textLanguage.hyphenateOff'));
    }
  },
});

// The extension that draws direction, language, and hyphenation loads after start-up, as the other editor
// extensions do, so the first load stays small. The registry is read when an editor mounts.
void directionCode().catch(() => undefined);
