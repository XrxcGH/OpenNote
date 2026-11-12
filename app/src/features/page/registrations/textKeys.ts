// The keys of the text formatting commands (text program, Beta 10, ADR 0085): each ID in keys/text.ts becomes a page
// command that runs its catalog entry on the target editor. They sit behind text.v2Controls, as the commands they run.
// This file loads at start-up, so it holds only definitions; running one loads formattingBar/commands.ts.
import type { EditorCommandArgs } from '../../../editor/commands/catalog';
import type { CommandContext } from '../../../commands/types';
import type { MessageKey } from '../../../strings/t';
import { targetEditor } from '../formattingBar/target';
import { inTaskItem } from '../../../editor/commands/state';
import { registerPageCommand } from '../keys';
import type { PageCommandId } from '../keys';
import { textSeams } from '../textSeams';

interface TextKey {
  id: PageCommandId;
  title: MessageKey;
  /** The catalog entry to run, when it is not the command's own ID. */
  run?: string;
  args?: EditorCommandArgs;
}

const name = (key: string): MessageKey => `textCommands.names.${key}` as MessageKey;

const KEYED: readonly TextKey[] = [
  { id: 'format.allCaps', title: name('allCaps') },
  { id: 'format.smallCaps', title: name('smallCaps') },
  { id: 'format.cycleCase', title: name('cycleCase') },
  { id: 'format.clearCharacter', title: name('clearCharacter') },
  { id: 'format.fontSizeUp', title: name('fontSizeUp') },
  { id: 'format.fontSizeDown', title: name('fontSizeDown') },
  { id: 'format.copyFormat', title: name('copyFormat') },
  { id: 'format.pasteFormat', title: name('pasteFormat') },
  { id: 'format.repeat', title: name('repeat') },
  { id: 'para.alignStart', title: name('alignStart') },
  { id: 'para.alignCenter', title: name('alignCenter') },
  { id: 'para.alignEnd', title: name('alignEnd') },
  { id: 'para.justify', title: name('justify') },
  { id: 'para.distribute', title: name('distribute') },
  { id: 'para.lineSingle', title: 'shortcuts.textKeys.lineSingle', run: 'para.lineSpacing', args: { value: 1 } },
  { id: 'para.lineDouble', title: 'shortcuts.textKeys.lineDouble', run: 'para.lineSpacing', args: { value: 2 } },
  { id: 'para.line15', title: 'shortcuts.textKeys.line15', run: 'para.lineSpacing', args: { value: 1.5 } },
  { id: 'para.spaceBefore', title: name('spaceBefore') },
  { id: 'para.indent', title: name('indent') },
  { id: 'para.outdent', title: name('outdent') },
  { id: 'para.hanging', title: name('hanging') },
  { id: 'para.removeHanging', title: name('removeHanging') },
  { id: 'para.reset', title: name('resetParagraph') },
];

type FormattingCommands = typeof import('../formattingBar/commands');
let loaded: FormattingCommands | undefined;
const load = () => import('../formattingBar/commands').then((module) => (loaded = module));

for (const { id, title, run, args } of KEYED) {
  registerPageCommand<EditorCommandArgs | undefined>({
    id,
    title,
    keywords: 'shortcuts.textKeys.keywords',
    category: 'format',
    flag: 'text.v2Controls',
    when: () => targetEditor() !== null,
    run: (_ctx: CommandContext, given) => {
      const apply = (commands: FormattingCommands) => commands.runFormatting(run ?? id, { ...given, ...args });
      return loaded ? apply(loaded) : load().then(apply);
    },
  });
}

// Ctrl+Enter: a page break on a paginated page, outside a task item. Anywhere else the key passes on.
registerPageCommand({
  id: 'insert.pageBreak',
  title: 'shortcuts.textKeys.pageBreak',
  keywords: 'shortcuts.textKeys.pageBreakKeywords',
  category: 'insert',
  flag: 'text.v2Controls',
  when: () => {
    const editor = targetEditor();
    return editor !== null && !inTaskItem(editor.state) && (textSeams.get().canBreakPage?.() ?? false);
  },
  run: () => textSeams.get().breakPage?.(),
});

// Ctrl+Shift+S: the style box. Without a styles gallery to focus, the key passes on.
registerPageCommand({
  id: 'format.applyStyle',
  title: 'shortcuts.textKeys.applyStyle',
  keywords: 'shortcuts.textKeys.applyStyleKeywords',
  category: 'format',
  flag: 'text.v2Controls',
  when: () => targetEditor() !== null && textSeams.get().focusStyleBox !== undefined,
  run: () => textSeams.get().focusStyleBox?.(),
});
