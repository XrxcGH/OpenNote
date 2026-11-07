// The registrations of the symbol dialog, Alt+X, the special spaces and hyphens, and Show formatting marks (lane
// text:special-chars). This file loads at start-up, so it holds only definitions; the code loads when a command runs.
import { chord } from '../../../commands/registry';
import { formattingMarks } from '../../../editor/extensions/invisibles';
import { commandBar, commands } from '../../../registries';
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
  keys?: readonly string[];
  /** The Insert tab's group, when the command has a button there. */
  insert?: { group: string; priority: number };
  run(editor: import('@tiptap/core').Editor): void | Promise<void>;
};

function add(spec: Spec): void {
  commands.register({
    id: spec.id,
    title: spec.title,
    keywords: spec.keywords,
    category: 'insert',
    icon: spec.icon,
    flag: 'text.symbols',
    ...(spec.keys ? { keys: spec.keys.map(chord), scope: 'editor' as const, allowInTextInput: true } : {}),
    when: () => shownQueue.get() !== null,
    run: async () => {
      const editor = targetEditor();
      if (editor) await spec.run(editor);
      else say(t('textSymbols.needsText'));
    },
  });
  if (spec.insert) {
    commandBar.register({ id: spec.id, tab: 'insert', command: spec.id, flag: 'text.symbols', ...spec.insert });
  }
}

add({
  id: 'insert.symbol',
  title: 'textSymbols.insertSymbol',
  keywords: 'textSymbols.insertSymbolKeywords',
  icon: 'Omega',
  insert: { group: 'symbol', priority: 50 },
  run: async (editor) => (await import('../symbols/commands')).openSymbolDialog(editor),
});

add({
  id: 'text.altX',
  title: 'textSymbols.altX',
  keywords: 'textSymbols.altXKeywords',
  icon: 'Keyboard',
  keys: ['Alt+X'],
  run: async (editor) => {
    if (!(await import('../symbols/commands')).runAltX(editor)) announce(t('textSymbols.altXNone'));
  },
});

const SPECIALS = [
  {
    id: 'text.nbsp',
    char: 'nbsp',
    title: 'textSymbols.nbsp',
    keywords: 'textSymbols.nbspKeywords',
    keys: ['Ctrl+Shift+Space'],
  },
  { id: 'text.nbHyphen', char: 'nbHyphen', title: 'textSymbols.nbHyphen', keywords: 'textSymbols.nbHyphenKeywords' },
  {
    id: 'text.softHyphen',
    char: 'softHyphen',
    title: 'textSymbols.softHyphen',
    keywords: 'textSymbols.softHyphenKeywords',
  },
  { id: 'text.emDash', char: 'emDash', title: 'textSymbols.emDash', keywords: 'textSymbols.emDashKeywords' },
  { id: 'text.enDash', char: 'enDash', title: 'textSymbols.enDash', keywords: 'textSymbols.enDashKeywords' },
] as const;
for (const spec of SPECIALS) {
  add({
    id: spec.id,
    title: spec.title,
    keywords: spec.keywords,
    icon: 'TextAa',
    ...('keys' in spec ? { keys: spec.keys } : {}),
    run: async (editor) => {
      const { SPECIAL, insertChar } = await import('../symbols/commands');
      insertChar(editor, SPECIAL[spec.char]);
    },
  });
}

// Show formatting marks: a toggle on the Home tab's Paragraph group. It works without a text editor in focus.
commands.register({
  id: 'text.formattingMarks',
  title: 'textSymbols.marks',
  keywords: 'textSymbols.marksKeywords',
  category: 'view',
  icon: 'Paragraph',
  flag: 'text.symbols',
  keys: [chord('Ctrl+Alt+8')],
  scope: 'editor',
  allowInTextInput: true,
  when: () => shownQueue.get() !== null,
  checked: () => formattingMarks.get(),
  run: () => formattingMarks.set((on) => !on),
});
commandBar.register({
  id: 'text.formattingMarks',
  tab: 'home',
  group: 'paragraph',
  command: 'text.formattingMarks',
  flag: 'text.symbols',
  priority: 30,
  presentation: 'toggle',
});
