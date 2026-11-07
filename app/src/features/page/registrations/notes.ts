// Footnotes and endnotes (text program, Beta 12; ADR 0087), behind text.footnotes. This file only registers: the page
// hook and the commands. The notes code (the notes area and its editors) loads when a page view first needs it, so
// it stays out of the start-up bundle.
import { isEnabled } from '../../../app/flags';
import { mountedPageHooks } from '../pagesApi';
import { addCommand } from './qolStudy';

const load = () => import('../footnotes/notes');

mountedPageHooks.register({
  id: 'text.notes',
  attach(mounted) {
    if (!isEnabled('text.footnotes')) return () => undefined;
    let detach: (() => void) | null = null;
    let gone = false;
    void load().then((m) => {
      if (!gone) detach = m.attachNotes(mounted).detach;
    });
    return () => {
      gone = true;
      detach?.();
    };
  },
});

addCommand({
  id: 'text.notes.footnote',
  title: 'textNotes.insertFootnote',
  keywords: 'textNotes.insertFootnoteKeywords',
  icon: 'TextSuperscript',
  flag: 'text.footnotes',
  slash: { group: 'advanced', order: 60 },
  bar: { group: 'footnote', priority: 50 },
  run: () => void load().then((m) => m.insert('foot')),
});
addCommand({
  id: 'text.notes.endnote',
  title: 'textNotes.insertEndnote',
  keywords: 'textNotes.insertEndnoteKeywords',
  icon: 'TextSuperscript',
  flag: 'text.footnotes',
  slash: { group: 'advanced', order: 61 },
  bar: { group: 'endnote', priority: 50 },
  run: () => void load().then((m) => m.insert('end')),
});
addCommand({
  id: 'text.notes.goTo',
  title: 'textNotes.goTo',
  keywords: 'textNotes.goToKeywords',
  icon: 'ArrowsDownUp',
  flag: 'text.footnotes',
  category: 'editing',
  run: () => void load().then((m) => m.goTo()),
});
for (const [id, title, from] of [
  ['text.notes.toEndnotes', 'textNotes.toEndnotes', 'foot'],
  ['text.notes.toFootnotes', 'textNotes.toFootnotes', 'end'],
] as const) {
  addCommand({
    id,
    title,
    keywords: 'textNotes.convertKeywords',
    icon: 'ArrowsLeftRight',
    flag: 'text.footnotes',
    category: 'editing',
    run: () => void load().then((m) => m.convert(from, null)),
  });
}
addCommand({
  id: 'text.notes.convertOne',
  title: 'textNotes.convertOne',
  keywords: 'textNotes.convertKeywords',
  icon: 'ArrowsLeftRight',
  flag: 'text.footnotes',
  category: 'editing',
  run: () => void load().then((m) => m.convertOne()),
});
