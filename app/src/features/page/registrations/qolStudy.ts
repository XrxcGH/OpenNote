// The quality-of-life lane's registrations (tables, math, study tools, and productivity): the panel blocks, their
// commands, slash items and bar items, and the hooks that watch the page. This file loads at start-up, so it holds
// only definitions; each command loads its feature on first use.
import { isEnabled } from '../../../app/flags';
import type { FlagId } from '../../../app/flags';
import { chord, defineCommand } from '../../../commands/registry';
import type { CommandCategory } from '../../../commands/types';
import { commandBar, commands, contextMenus } from '../../../registries';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { getLocation } from '../../../app/location';
import { announce } from '../../../ui';
import type { IconName } from '../../../ui/icons';
import { currentSection } from '../../tree';
import { transcriptActions } from '../audio/transcripts/actionRegistry';
import { targetEditor } from '../formattingBar/target';
import type { MountedPage } from '../mount';
import { mountedPageHooks, shownMounted } from '../pagesApi';
import { panelRenderer } from '../panels/kinds';
import { blockRenderers, editingSettingsParts, slashItems } from '../registries';
import type { SlashItemDef } from '../registries';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync/shown';
import { currentTable } from '../tables/current';
import { later } from '../tables/later';
import { INSERT_EVENT } from '../../tools/flags';

interface Spec {
  id: `${string}.${string}`;
  title: MessageKey;
  keywords?: MessageKey;
  icon: IconName;
  flag: FlagId;
  category?: CommandCategory;
  keys?: readonly string[];
  /** Whether the command needs a page to be shown (the default) or works anywhere. */
  anywhere?: boolean;
  slash?: Pick<SlashItemDef, 'group' | 'order'>;
  bar?: { group: string; priority: number };
  run(): void | Promise<void>;
}

/** Registers a command with its optional slash item and Insert tab button. */
export function addCommand(spec: Spec): void {
  commands.register({
    id: spec.id,
    title: spec.title,
    ...(spec.keywords ? { keywords: spec.keywords } : {}),
    category: spec.category ?? 'insert',
    icon: spec.icon,
    flag: spec.flag,
    ...(spec.keys ? { keys: spec.keys.map(chord), scope: 'editor' as const, allowInTextInput: true } : {}),
    when: spec.anywhere ? () => true : () => shownQueue.get() !== null,
    run: spec.run,
  });
  if (spec.slash && spec.keywords) {
    slashItems.register({
      id: spec.id,
      title: spec.title,
      keywords: spec.keywords,
      icon: spec.icon,
      flag: spec.flag,
      command: spec.id,
      ...spec.slash,
    });
  }
  if (spec.bar) commandBar.register({ id: spec.id, tab: 'insert', command: spec.id, flag: spec.flag, ...spec.bar });
}

/** The text of the shown page's text blocks, and its title. */
function shownText(): { text: string; title: string } | null {
  const mounted = shownMounted.get();
  if (!mounted) return null;
  const text = mounted.layer
    .blocks()
    .filter((block) => block.type === 'text')
    .map((block) => String(block.data.markdown ?? ''))
    .join('\n\n');
  return { text, title: mounted.page.initial.title };
}

// Flashcards: a deck block, the Flashcards window, and cards made from the page.
blockRenderers.register(
  panelRenderer({
    type: 'deck',
    label: 'study.deck.block',
    flag: 'study.cards',
    load: async () => {
      const { mountDeck } = await import('../../study');
      return { mount: (container, props) => mountDeck(container, props) };
    },
  }),
);

addCommand({
  id: 'insert.flashcards',
  title: 'study.deck.insert',
  keywords: 'study.deck.insertKeywords',
  icon: 'Cards',
  flag: 'study.cards',
  slash: { group: 'advanced', order: 30 },
  bar: { group: 'study', priority: 36 },
  run: async () => {
    const mounted = shownMounted.get();
    if (!mounted) return;
    const study = await import('../../study');
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const deck =
      study.deckById(study.pageDeckId(mounted.page.id)) ??
      study.createDeck(
        mounted.page.initial.title || t('study.deck.untitled', { number: study.decksStore.get().length + 1 }),
      );
    const id = await insertPanelBlock('deck', { deck: deck.id }, t('study.deck.blockFallback', { name: deck.name }));
    if (id) announce(t('study.deck.inserted'));
  },
});

// Quiz: a block that asks random questions from a deck and counts the right answers.
blockRenderers.register(
  panelRenderer({
    type: 'quiz',
    label: 'study.quiz.block',
    flag: 'study.cards',
    load: async () => {
      const { mountQuiz } = await import('../../study');
      return { mount: (container, props) => mountQuiz(container, props) };
    },
  }),
);

addCommand({
  id: 'insert.quiz',
  title: 'study.quiz.insert',
  keywords: 'study.quiz.insertKeywords',
  icon: 'Cards',
  flag: 'study.cards',
  slash: { group: 'advanced', order: 34 },
  bar: { group: 'study', priority: 34 },
  run: async () => {
    const mounted = shownMounted.get();
    if (!mounted) return;
    const study = await import('../../study');
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const deck =
      study.deckById(study.pageDeckId(mounted.page.id)) ??
      study.createDeck(
        mounted.page.initial.title || t('study.deck.untitled', { number: study.decksStore.get().length + 1 }),
      );
    const id = await insertPanelBlock(
      'quiz',
      { deck: deck.id, count: 10 },
      t('study.quiz.blockFallback', { name: deck.name }),
    );
    if (id) announce(t('study.quiz.inserted'));
  },
});

addCommand({
  id: 'tools.flashcards',
  title: 'study.deck.open',
  keywords: 'study.deck.insertKeywords',
  category: 'general',
  icon: 'Cards',
  flag: 'study.cards',
  anywhere: true,
  run: async () => (await import('../../tools')).openTool('flashcards'),
});

async function makeCards(selection: boolean): Promise<void> {
  const shown = shownText();
  if (!shown) return void announce(t('study.generate.noPage'));
  let text = shown.text;
  if (selection) {
    const editor = targetEditor();
    const { from, to } = editor?.state.selection ?? { from: 0, to: 0 };
    text = editor && from !== to ? editor.state.doc.textBetween(from, to, '\n') : '';
    if (!text.trim()) return void announce(t('study.generate.emptySelection'));
  } else if (!text.trim()) return void announce(t('study.generate.emptyPage'));
  const [{ requestCards }, { openTool }] = await Promise.all([import('../../study'), import('../../tools')]);
  requestCards(text, shown.title || t('study.deck.untitled', { number: 1 }));
  openTool('flashcards');
}

addCommand({
  id: 'study.generatePage',
  title: 'study.generate.page',
  keywords: 'study.generate.keywords',
  category: 'general',
  icon: 'MagicWand',
  flag: 'study.cards',
  run: () => makeCards(false),
});
addCommand({
  id: 'study.generateSelection',
  title: 'study.generate.selection',
  keywords: 'study.generate.keywords',
  category: 'general',
  icon: 'MagicWand',
  flag: 'study.cards',
  run: () => makeCards(true),
});

// Cards from a section: the tree's section menu and the palette read the pages of the section (the one the menu
// opened on, or the open one), and the Flashcards window shows what was found for the person to keep or leave.
commands.register(
  defineCommand({
    id: 'study.generateSection',
    title: 'study.generate.section',
    keywords: 'study.generate.keywords',
    category: 'general',
    icon: 'MagicWand',
    flag: 'study.cards',
    run: async (ctx) => {
      const section = currentSection(ctx);
      if (!section) return void announce(t('study.generate.noSection'));
      const { sectionText } = await import('../../study');
      const words = await sectionText(ctx.notes, ctx.platform.pages, section);
      if (!words.text.trim()) return void announce(t('study.generate.emptySection'));
      const [{ requestCards }, { openTool }] = await Promise.all([import('../../study'), import('../../tools')]);
      requestCards(words.text, section.title);
      openTool('flashcards');
      if (words.skipped > 0) announce(t('study.generate.sectionSkipped', { count: words.skipped }));
    },
  }),
);
contextMenus.register({
  id: 'tree.section.study.cards',
  menu: 'tree.section',
  command: 'study.generateSection',
  group: 'qol',
  order: 40,
  flag: 'study.cards',
});

// "Make cards" on a transcript: the transcript block draws a button for each registered action.
transcriptActions.register({
  id: 'study.cards',
  label: 'study.generate.transcript',
  flag: 'study.cards',
  run: async ({ text, source }) => {
    if (!text.trim()) return void announce(t('study.generate.emptyTranscript'));
    const [{ requestCards }, { openTool }] = await Promise.all([import('../../study'), import('../../tools')]);
    requestCards(text, source || t('study.deck.untitled', { number: 1 }));
    openTool('flashcards');
  },
});

// Citations and a bibliography that follow the chosen style: the blocks name their sources and the style is looked up
// when they are drawn, so a style change (or a change to a source) updates them. They are added from the Citations
// window, and the bibliography also from the palette and the slash menu.
for (const [type, label, mount] of [
  ['citation', 'study.citations.live.blockCitation', 'mountCitation'],
  ['bibliography', 'study.citations.live.blockBibliography', 'mountBibliography'],
] as const) {
  blockRenderers.register(
    panelRenderer({
      type,
      label,
      flag: 'tools.citations',
      load: async () => {
        const citations = await import('../../citations');
        return { mount: (container, props) => citations[mount](container, props) };
      },
    }),
  );
}

addCommand({
  id: 'insert.bibliography',
  title: 'study.citations.live.insertBibliographyCommand',
  keywords: 'study.citations.live.insertBibliographyKeywords',
  icon: 'Quotes',
  flag: 'tools.citations',
  slash: { group: 'advanced', order: 35 },
  bar: { group: 'study', priority: 35 },
  run: async () => {
    const [citations, { insertPanelBlock }] = await Promise.all([
      import('../../citations'),
      import('../panels/insertPanel'),
    ]);
    const here = getLocation();
    const notebook = here.view === 'workspace' && here.notebookId ? String(here.notebookId) : citations.SHARED;
    const sources = citations.sourcesOf(notebook);
    if (sources.length === 0) return void announce(t('study.citations.none'));
    const text = citations.bibliography(sources, citations.styleStore.get());
    const id = await insertPanelBlock('bibliography', { notebook, sources: null }, text);
    if (id) announce(t('study.citations.live.bibliographyInserted'));
  },
});

// The Citations window asks for a block with a "block" detail on the insert event, and is told at once if a page takes it.
if (typeof window !== 'undefined') {
  window.addEventListener(INSERT_EVENT, (event) => {
    const detail = (
      event as CustomEvent<{
        block?: { type: string; data: Record<string, unknown>; fallback: string };
        handled: boolean;
      }>
    ).detail;
    const block = detail?.block;
    if (!block || shownQueue.get() === null) return;
    detail.handled = true;
    void import('../panels/insertPanel').then(({ insertPanelBlock }) =>
      insertPanelBlock(block.type, block.data, block.fallback),
    );
  });
}

// Watching the text of the shown page. The study and productivity features read lines of the page, so one watcher
// serves them: it runs `run` when a block changes (a moment later, and every few seconds as a fallback), but only
// loads anything when some block has a line that `test` matches, or had one a moment ago.
function watchText(
  mounted: MountedPage,
  test: RegExp,
  run: (blocks: { id: string; markdown: string }[], found: boolean) => void,
): () => void {
  let last = '';
  let had = false;
  let timer: number | undefined;
  const scan = () => {
    const blocks = mounted.layer
      .blocks()
      .filter((block) => block.type === 'text')
      .map((block) => ({ id: block.id, markdown: String(block.data.markdown ?? '') }));
    const found = blocks.some((block) => test.test(block.markdown));
    if (!found && !had) return;
    const key = found ? JSON.stringify(blocks) : '';
    if (key === last) return;
    last = key;
    had = found;
    run(blocks, found);
  };
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(scan, 800);
  };
  const stop = mounted.layer.onChange(schedule);
  const poll = window.setInterval(scan, 4000);
  schedule();
  return () => {
    stop();
    window.clearTimeout(timer);
    window.clearInterval(poll);
  };
}

// Inline flashcards: a line "Question :: Answer" or a line with {{blanks}} is a card in the page's deck.
mountedPageHooks.register({
  id: 'study.inline',
  attach: (mounted) =>
    isEnabled('study.cards')
      ? watchText(mounted, / :: |\{\{[^{}]+?\}\}/, (blocks) => {
          void import('../../study').then(({ inlineCards, syncInlineDeck }) =>
            syncInlineDeck(mounted.page.id, mounted.page.initial.title, inlineCards(blocks)),
          );
        })
      : () => undefined,
});

// Due dates on checkboxes and tagged lines feed Upcoming.
mountedPageHooks.register({
  id: 'tools.dueDates',
  attach: (mounted) =>
    isEnabled('tools.dueDates')
      ? watchText(mounted, /\[[ xX]\]|#(?:todo|task|due|deadline)\b/i, (blocks) => {
          const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          void import('../../tools').then(({ setPageItems }) =>
            setPageItems({ id: mounted.page.id, title: mounted.page.initial.title }, blocks, {
              now: Date.now(),
              timeZone: zone,
            }),
          );
        })
      : () => undefined,
});

// Reminders: every half minute, if the person has turned them on, items that have come due are announced once.
if (typeof window !== 'undefined') {
  const remindersOn = (): boolean => {
    try {
      return JSON.parse(window.localStorage.getItem('opennote.tools.reminders') ?? 'null')?.on === true;
    } catch {
      return false;
    }
  };
  window.setInterval(() => {
    if (isEnabled('tools.reminders') && remindersOn())
      void import('../../tools').then((tools) => tools.runReminderCheck());
  }, 30_000);
}

// Study tools in their own windows: the unit converter and the reference tables open from the palette.
for (const [tool, flag, title, keywords, icon] of [
  ['converter', 'tools.converter', 'study.converter.open', 'study.converter.keywords', 'Ruler'],
  ['reference', 'tools.reference', 'study.reference.open', 'study.reference.keywords', 'Atom'],
  ['citations', 'tools.citations', 'study.citations.open', 'study.citations.keywords', 'Quotes'],
] as const) {
  addCommand({
    id: `tools.${tool}`,
    title,
    keywords,
    category: 'general',
    icon,
    flag,
    anywhere: true,
    run: async () => (await import('../../tools')).openTool(tool),
  });
}

// The dictionary and thesaurus: open it from the palette, or look up the word selected on the page.
addCommand({
  id: 'tools.dictionary',
  title: 'study.dictionary.open',
  keywords: 'study.dictionary.keywords',
  category: 'general',
  icon: 'BookOpenText',
  flag: 'tools.dictionary',
  anywhere: true,
  run: async () => (await import('../../tools')).openTool('dictionary'),
});
addCommand({
  id: 'tools.dictionary.lookup',
  title: 'study.dictionary.lookupSelection',
  keywords: 'study.dictionary.keywords',
  category: 'general',
  icon: 'BookOpenText',
  flag: 'tools.dictionary',
  keys: ['Ctrl+Alt+D'],
  run: async () => {
    const editor = targetEditor();
    const { from, to } = editor?.state.selection ?? { from: 0, to: 0 };
    const word = editor && from !== to ? editor.state.doc.textBetween(from, to, ' ').trim() : '';
    if (!word) return void announce(t('study.dictionary.selectFirst'));
    const tools = await import('../../tools');
    tools.requestWord(word);
    tools.openTool('dictionary');
  },
});

// "Reset tool windows" puts every tool window back at its first size and place, on this monitor.
addCommand({
  id: 'tools.resetWindows',
  title: 'study.toolWindows.reset',
  keywords: 'study.toolWindows.resetKeywords',
  category: 'general',
  icon: 'Timer',
  flag: 'tools.windows',
  anywhere: true,
  run: async () => {
    await (await import('../../tools')).resetToolWindows();
    announce(t('study.toolWindows.resetDone'));
  },
});

// Parts the tools draw inside page text: answers on math lines and due-date chips. They join the text editors shortly
// after start-up, in the tools' own chunk.
later(() => import('../../tools').then((tools) => tools.registerToolsEditor()));

// Quick math: after a Space typed behind "sum=", the answer follows. The check here is cheap and loads nothing; the
// math code loads the first time a Space follows an equals sign.
const QUICK_MATH_OFF = 'opennote.math.quickMath';
if (typeof document !== 'undefined') {
  document.addEventListener(
    'input',
    (event) => {
      const typed = event as InputEvent;
      if (typed.inputType !== 'insertText' || typed.data !== ' ' || typed.isComposing) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest('.ProseMirror') || !isEnabled('math.quickMath')) return;
      try {
        if (window.localStorage.getItem(QUICK_MATH_OFF) === 'off') return;
      } catch {
        // Storage that cannot be read leaves quick math on.
      }
      // The editor reads the typed character a moment after the event, so the check waits a task.
      window.setTimeout(() => {
        const editor = targetEditor();
        if (!editor || !editor.view.dom.contains(target)) return;
        const { $from, empty } = editor.state.selection;
        if (!empty || !/=\s$/.test($from.parent.textBetween(0, $from.parentOffset, undefined, ' '))) return;
        void import('../../math').then((math) => math.applyQuickMath(editor, announce));
      }, 0);
    },
    true,
  );
}
editingSettingsParts.register({
  id: 'math.quickMath',
  title: 'study.quickMath.title',
  order: 40,
  flag: 'math.quickMath',
  load: () => import('../../math').then((math) => ({ default: math.QuickMathSetting })),
});

// Calculated columns in smart tables: the Data menu on the table's strip has the same two actions.
for (const [id, title, run] of [
  ['table.calculatedColumn', 'smart.calculated.menu', 'calculated'],
  ['table.clearCalculated', 'smart.calculated.clear', 'clearCalculated'],
] as const) {
  commands.register({
    id,
    title,
    keywords: 'smart.calculated.keywords',
    category: 'table',
    icon: 'Function',
    flag: 'tables.calculated',
    when: () => currentTable.get() !== null,
    run: async () => void (await (await import('../../tables')).runSmartCommand({ run })),
  });
}

// Study tape: a floating strip over part of the page that hides it until pressed.
blockRenderers.register(
  panelRenderer({
    type: 'tape',
    label: 'study.tape.block',
    flag: 'study.tape',
    load: async () => {
      const { mountTape } = await import('../../study');
      return { mount: (container, props) => mountTape(container, props) };
    },
  }),
);

addCommand({
  id: 'insert.tape',
  title: 'study.tape.insert',
  keywords: 'study.tape.insertKeywords',
  icon: 'EyeSlash',
  flag: 'study.tape',
  slash: { group: 'advanced', order: 31 },
  bar: { group: 'study', priority: 35 },
  run: async () => {
    const mounted = shownMounted.get();
    if (!mounted) return;
    const { insertPanelBlock } = await import('../panels/insertPanel');
    // Below the block with the caret, where the person will see it and can move it over what to hide.
    const active = shownPool.get()?.active();
    const rect = active ? mounted.layer.view(active.block)?.measure() : undefined;
    const frame = { x: rect ? rect.x : 80, y: rect ? rect.y + rect.h + 8 : 80, w: 260, h: 56 };
    const id = await insertPanelBlock('tape', { hidden: true }, t('study.tape.fallback'), frame);
    if (id) announce(t('study.tape.inserted'));
  },
});

/** Covers or uncovers every study tape on the page in one step. */
async function setAllTape(hidden: boolean): Promise<void> {
  const mounted = shownMounted.get();
  const queue = shownQueue.get();
  if (!mounted || !queue) return;
  const tapes = mounted.layer.blocks().filter((block) => block.type === 'tape');
  if (tapes.length === 0) return void announce(t('study.tape.none'));
  await queue.send({
    edits: tapes.map((block) => ({ edit: 'patchBlock' as const, block: block.id, data: { hidden } })),
  });
  announce(t(hidden ? 'study.tape.allHidden' : 'study.tape.allShown'));
}

for (const [id, title, hidden] of [
  ['tape.showAll', 'study.tape.showAll', false],
  ['tape.hideAll', 'study.tape.hideAll', true],
] as const) {
  addCommand({
    id,
    title,
    keywords: 'study.tape.insertKeywords',
    category: 'general',
    icon: hidden ? 'EyeSlash' : 'Eye',
    flag: 'study.tape',
    run: () => setAllTape(hidden),
  });
}

// Mind maps: a block that turns an outline into a map and a map into an outline.
blockRenderers.register(
  panelRenderer({
    type: 'mindmap',
    label: 'study.mindmap.block',
    flag: 'math.mindMaps',
    load: async () => {
      const { mountMindMap } = await import('../../math');
      return { mount: (container, props) => mountMindMap(container, props) };
    },
  }),
);

addCommand({
  id: 'insert.mindmap',
  title: 'study.mindmap.insert',
  keywords: 'study.mindmap.insertKeywords',
  icon: 'TreeStructure',
  flag: 'math.mindMaps',
  slash: { group: 'advanced', order: 32 },
  bar: { group: 'math', priority: 37 },
  run: async () => {
    const { newNode, parseOutline, toOutline } = await import('../../math');
    const { insertPanelBlock } = await import('../panels/insertPanel');
    // A selected list or outline becomes the map; with nothing selected the map starts with one main idea.
    const editor = targetEditor();
    const { from, to } = editor?.state.selection ?? { from: 0, to: 0 };
    const selected = editor && from !== to ? editor.state.doc.textBetween(from, to, '\n') : '';
    const map = parseOutline(selected, t('study.mindmap.mainIdea')) ?? newNode(t('study.mindmap.mainIdea'));
    const id = await insertPanelBlock('mindmap', { root: map }, toOutline(map));
    if (id) announce(t('study.mindmap.inserted'));
  },
});

// Diagrams from text: Mermaid text drawn on this device, redrawn as it is edited, and saved as an SVG.
blockRenderers.register(
  panelRenderer({
    type: 'diagram',
    label: 'study.diagram.block',
    flag: 'math.diagrams',
    load: async () => {
      const { mountDiagram } = await import('../../math');
      return { mount: (container, props) => mountDiagram(container, props) };
    },
  }),
);

addCommand({
  id: 'insert.diagram',
  title: 'study.diagram.insert',
  keywords: 'study.diagram.insertKeywords',
  icon: 'FlowArrow',
  flag: 'math.diagrams',
  slash: { group: 'advanced', order: 33 },
  bar: { group: 'math', priority: 36 },
  run: async () => {
    const { STARTER_TEXT, fallbackOf } = await import('../../math');
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const source = STARTER_TEXT.flowchart;
    const id = await insertPanelBlock('diagram', { source }, fallbackOf(source));
    if (id) announce(t('study.diagram.inserted'));
  },
});
