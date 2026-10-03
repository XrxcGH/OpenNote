// The quality-of-life lane's registrations (tables, math, study tools, and productivity): the panel blocks, their
// commands, slash items and bar items, and the hooks that watch the page. This file loads at start-up, so it holds
// only definitions; each command loads its feature on first use.
import { isEnabled } from '../../../app/flags';
import type { FlagId } from '../../../app/flags';
import { chord } from '../../../commands/registry';
import type { CommandCategory } from '../../../commands/types';
import { commandBar, commands } from '../../../registries';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce } from '../../../ui';
import type { IconName } from '../../../ui/icons';
import { targetEditor } from '../formattingBar/target';
import { mountedPageHooks, shownMounted } from '../pagesApi';
import { panelRenderer } from '../panels/kinds';
import { blockRenderers, slashItems } from '../registries';
import type { SlashItemDef } from '../registries';
import { shownQueue } from '../sync/shown';

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

// Inline flashcards: a line "Question :: Answer" or a line with {{blanks}} is a card in the page's deck. The page is
// read when its blocks change; the study code loads only when a page has such a line, or had one a moment ago.
const INLINE_LINE = / :: |\{\{[^{}]+?\}\}/;

mountedPageHooks.register({
  id: 'study.inline',
  attach(mounted) {
    if (!isEnabled('study.cards')) return () => undefined;
    let last = '';
    let had = false;
    let timer: number | undefined;
    const scan = () => {
      const blocks = mounted.layer
        .blocks()
        .filter((block) => block.type === 'text')
        .map((block) => ({ id: block.id, markdown: String(block.data.markdown ?? '') }));
      const has = blocks.some((block) => INLINE_LINE.test(block.markdown));
      if (!has && !had) return;
      const key = has ? JSON.stringify(blocks) : '';
      if (key === last) return;
      last = key;
      void import('../../study').then(({ inlineCards, syncInlineDeck }) => {
        syncInlineDeck(mounted.page.id, mounted.page.initial.title, inlineCards(blocks));
        had = has;
      });
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
  },
});

// Study tools in their own windows: the unit converter and the reference tables open from the palette.
for (const [tool, flag, title, keywords, icon] of [
  ['converter', 'tools.converter', 'study.converter.open', 'study.converter.keywords', 'Ruler'],
  ['reference', 'tools.reference', 'study.reference.open', 'study.reference.keywords', 'Atom'],
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
