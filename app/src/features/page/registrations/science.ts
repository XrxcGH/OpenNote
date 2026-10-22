// Science helpers' registrations: the constants picker, Insert LaTeX, and the significant-figures helper. Each opens a
// tool window from the palette, the Insert tab, the slash menu, a shortcut, and the text context menu. The windows
// load only when opened. Typing $x^2$ already makes an equation, and pasting LaTeX does too (editor/extensions/math.ts).
import type { FlagId } from '../../../app/flags';
import { chord } from '../../../commands/registry';
import { commandBar, commands, contextMenus } from '../../../registries';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce } from '../../../ui';
import type { IconName } from '../../../ui/icons';
import { targetEditor } from '../formattingBar/target';
import { slashItems } from '../registries';
import { shownQueue } from '../sync/shown';

interface Spec {
  id: `${string}.${string}`;
  title: MessageKey;
  keywords: MessageKey;
  icon: IconName;
  flag: FlagId;
  keys?: readonly string[];
  slash?: { order: number };
  bar?: { priority: number };
  menu?: { order: number };
  when?: () => boolean;
  run(): void | Promise<void>;
}

const hasPage = () => shownQueue.get() !== null;

function add(spec: Spec): void {
  commands.register({
    id: spec.id,
    title: spec.title,
    keywords: spec.keywords,
    category: 'insert',
    icon: spec.icon,
    flag: spec.flag,
    ...(spec.keys ? { keys: spec.keys.map(chord), scope: 'editor' as const, allowInTextInput: true } : {}),
    when: spec.when ?? (() => true),
    run: spec.run,
  });
  if (spec.slash) {
    slashItems.register({
      id: spec.id,
      title: spec.title,
      keywords: spec.keywords,
      icon: spec.icon,
      flag: spec.flag,
      command: spec.id,
      group: 'advanced',
      order: spec.slash.order,
    });
  }
  if (spec.bar) {
    commandBar.register({
      id: spec.id,
      tab: 'insert',
      command: spec.id,
      flag: spec.flag,
      group: 'math',
      priority: spec.bar.priority,
    });
  }
  if (spec.menu) {
    contextMenus.register({
      id: `page.text.${spec.id}`,
      menu: 'page.text',
      command: spec.id,
      group: 'science',
      order: spec.menu.order,
      flag: spec.flag,
    });
  }
}

const openTool = async (tool: 'constants' | 'latex' | 'sigfigs') => (await import('../../tools')).openTool(tool);

/** The text selected in the editor that has the caret, or ''. */
function selectedText(): string {
  const editor = targetEditor();
  if (!editor) return '';
  const { from, to } = editor.state.selection;
  return from === to ? '' : editor.state.doc.textBetween(from, to, ' ', ' ').trim();
}

/** The selection when it is a number, else null. */
async function selectedNumber(): Promise<string | null> {
  const text = selectedText();
  if (text === '' || text.length > 60) return null;
  const { countFigures } = await import('../../tools');
  return countFigures(text) === null ? null : text;
}

/** A quick, synchronous guess for `when`: it looks like a number. The command checks it properly when it runs. */
const looksNumeric = (): boolean => /^[+\-−]?[\d.,\s]*\d[\d.,\seE×x^+\-−·*()⁰¹²³⁴⁵⁶⁷⁸⁹⁻]*$/.test(selectedText());

add({
  id: 'tools.latex',
  title: 'science.latex.open',
  keywords: 'science.latex.keywords',
  icon: 'Function',
  flag: 'math.latexInsert',
  keys: ['Ctrl+Alt+X'],
  slash: { order: 23 },
  bar: { priority: 41 },
  menu: { order: 10 },
  run: () => openTool('latex'),
});

add({
  id: 'tools.constants',
  title: 'science.constants.open',
  keywords: 'science.constants.keywords',
  icon: 'Atom',
  flag: 'tools.constants',
  keys: ['Ctrl+Alt+N'],
  slash: { order: 24 },
  bar: { priority: 42 },
  menu: { order: 20 },
  run: () => openTool('constants'),
});

add({
  id: 'tools.sigfigs',
  title: 'science.sigfigs.open',
  keywords: 'science.sigfigs.keywords',
  icon: 'Hash',
  flag: 'tools.sigfigs',
  keys: ['Ctrl+Alt+F'],
  bar: { priority: 43 },
  run: async () => {
    const number = await selectedNumber();
    if (number !== null) (await import('../../tools')).seedSigFigs(number);
    await openTool('sigfigs');
  },
});

add({
  id: 'sigfigs.countSelection',
  title: 'science.sigfigs.countSelection',
  keywords: 'science.sigfigs.keywords',
  icon: 'Hash',
  flag: 'tools.sigfigs',
  menu: { order: 30 },
  when: () => hasPage() && looksNumeric(),
  run: async () => {
    const text = await selectedNumber();
    if (text === null) return void announce(t('science.sigfigs.selectFirst'));
    const { countFigures } = await import('../../tools');
    const counted = countFigures(text);
    if (counted) announce(t('science.sigfigs.selectionCount', { text, count: counted.figures }));
  },
});

add({
  id: 'sigfigs.roundSelection',
  title: 'science.sigfigs.roundSelection',
  keywords: 'science.sigfigs.keywords',
  icon: 'Hash',
  flag: 'tools.sigfigs',
  menu: { order: 31 },
  when: () => hasPage() && looksNumeric(),
  run: async () => {
    const number = await selectedNumber();
    if (number === null) return void announce(t('science.sigfigs.selectFirst'));
    (await import('../../tools')).seedSigFigs(number);
    await openTool('sigfigs');
  },
});
