// Comments, suggestions (track changes), and the markup views (text program, Beta 12; ADR 0086), behind text.review.
// This file only registers: the page hook, the commands, and the Review tab's buttons. The review code loads when a
// page view first needs it or a command runs, so it stays out of the start-up bundle.
import { isEnabled } from '../../../app/flags';
import { chord } from '../../../commands/registry';
import type { CommandCategory, CommandId } from '../../../commands/types';
import { commandBar, commands } from '../../../registries';
import type { MessageKey } from '../../../strings/t';
import { loadReviewCommands, loadReviewExtension, loadReviewPage, reviewPrefs, suggesting } from '../../review';
import type { Markup } from '../../review';
import { mountedPageHooks, shownMounted } from '../pagesApi';

const commandsModule = loadReviewCommands;
const FLAG = 'text.review' as const;

// The editor extension (its registration names the flag) and the marks' styles load right after start-up, before
// most editors mount.
void loadReviewExtension().catch(() => undefined);

mountedPageHooks.register({
  id: 'text.review',
  attach(mounted) {
    if (!isEnabled(FLAG)) return () => undefined;
    let detach: (() => void) | null = null;
    let gone = false;
    // The text sync and the text block view load with the page view, so these imports cost nothing more.
    void Promise.all([loadReviewPage(), import('../sync/textSync'), import('../blocks/textBlock')]).then(
      ([m, { addTextRider }, { liveText }]) => {
        if (gone) return;
        detach = m.attachReview(mounted, { addTextRider, liveDoc: (view) => liveText(view)?.liveDoc() ?? null }).detach;
      },
    );
    return () => {
      gone = true;
      detach?.();
    };
  },
});

interface Spec {
  id: CommandId;
  title: MessageKey;
  keywords: MessageKey;
  icon: string;
  category?: CommandCategory;
  keys?: readonly string[];
  checked?: () => boolean;
  /** The Review tab group and priority; none for palette-only commands. */
  bar?: { group: string; priority: number; presentation?: 'toggle' };
  run(m: Awaited<ReturnType<typeof commandsModule>>): void | Promise<void>;
}

function add(spec: Spec): void {
  commands.register({
    id: spec.id,
    title: spec.title,
    keywords: spec.keywords,
    category: spec.category ?? 'editing',
    icon: spec.icon,
    flag: FLAG,
    ...(spec.keys ? { keys: spec.keys.map(chord), scope: 'editor' as const, allowInTextInput: true } : {}),
    ...(spec.checked ? { checked: spec.checked } : {}),
    when: () => shownMounted.get() !== null,
    run: () => void commandsModule().then((m) => spec.run(m)),
  });
  if (spec.bar) {
    commandBar.register({ id: spec.id, tab: 'review', command: spec.id, flag: FLAG, ...spec.bar });
  }
}

add({
  id: 'text.review.newComment',
  title: 'textReview.newComment',
  keywords: 'textReview.newCommentKeywords',
  icon: 'ChatCircleText',
  category: 'insert',
  bar: { group: 'comments', priority: 90 },
  run: (m) => m.newComment(),
});
// Insert, Comment (the Insert tab order is text:scaffold's: Footnote, Endnote, Comment).
commandBar.register({
  id: 'text.review.newComment.insert',
  tab: 'insert',
  group: 'comment',
  command: 'text.review.newComment',
  priority: 50,
  flag: FLAG,
});
add({
  id: 'text.review.showComments',
  title: 'textReview.showComments',
  keywords: 'textReview.showCommentsKeywords',
  icon: 'ChatsCircle',
  category: 'view',
  bar: { group: 'comments', priority: 80 },
  run: (m) => m.toggleComments(),
});
add({
  id: 'text.review.previousComment',
  title: 'textReview.previousComment',
  keywords: 'textReview.commentNavKeywords',
  icon: 'CaretLeft',
  category: 'navigation',
  bar: { group: 'comments', priority: 60 },
  run: (m) => m.moveToComment(-1),
});
add({
  id: 'text.review.nextComment',
  title: 'textReview.nextComment',
  keywords: 'textReview.commentNavKeywords',
  icon: 'CaretRight',
  category: 'navigation',
  bar: { group: 'comments', priority: 60 },
  run: (m) => m.moveToComment(1),
});
add({
  id: 'text.review.resolveComment',
  title: 'textReview.resolveComment',
  keywords: 'textReview.commentKeywords',
  icon: 'CheckCircle',
  bar: { group: 'comments', priority: 50 },
  run: (m) => m.resolveHere(true),
});
add({
  id: 'text.review.reopenComment',
  title: 'textReview.reopenComment',
  keywords: 'textReview.commentKeywords',
  icon: 'ArrowCounterClockwise',
  run: (m) => m.resolveHere(false),
});
add({
  id: 'text.review.deleteComment',
  title: 'textReview.deleteComment',
  keywords: 'textReview.commentKeywords',
  icon: 'Trash',
  bar: { group: 'comments', priority: 40 },
  run: (m) => m.deleteHere(),
});
add({
  id: 'text.review.trackChanges',
  title: 'textReview.trackChanges',
  keywords: 'textReview.trackChangesKeywords',
  icon: 'PencilSimpleLine',
  // Word's chord for Track Changes.
  keys: ['Ctrl+Shift+E'],
  checked: () => suggesting.get(),
  bar: { group: 'tracking', priority: 90, presentation: 'toggle' },
  run: (m) => m.toggleSuggesting(),
});
for (const [markup, title, priority] of [
  ['simple', 'textReview.markupSimple', 50],
  ['all', 'textReview.markupAll', 50],
  ['none', 'textReview.markupNone', 40],
] as const satisfies readonly (readonly [Markup, MessageKey, number])[]) {
  add({
    id: `text.review.markup.${markup}`,
    title,
    keywords: 'textReview.markupKeywords',
    icon: markup === 'none' ? 'EyeSlash' : 'Eye',
    category: 'view',
    checked: () => reviewPrefs.get().markup === markup,
    bar: { group: 'tracking', priority },
    run: (m) => m.setMarkup(markup),
  });
}
add({
  id: 'text.review.accept',
  title: 'textReview.accept',
  keywords: 'textReview.decideKeywords',
  icon: 'Check',
  bar: { group: 'changes', priority: 90 },
  run: (m) => m.decideHere('accept'),
});
add({
  id: 'text.review.reject',
  title: 'textReview.reject',
  keywords: 'textReview.decideKeywords',
  icon: 'X',
  bar: { group: 'changes', priority: 90 },
  run: (m) => m.decideHere('reject'),
});
add({
  id: 'text.review.acceptAll',
  title: 'textReview.acceptAll',
  keywords: 'textReview.decideKeywords',
  icon: 'Checks',
  bar: { group: 'changes', priority: 70 },
  run: (m) => m.decideAll('accept'),
});
add({
  id: 'text.review.rejectAll',
  title: 'textReview.rejectAll',
  keywords: 'textReview.decideKeywords',
  icon: 'XCircle',
  bar: { group: 'changes', priority: 70 },
  run: (m) => m.decideAll('reject'),
});
add({
  id: 'text.review.acceptByAuthor',
  title: 'textReview.acceptByAuthor',
  keywords: 'textReview.decideKeywords',
  icon: 'UserCheck',
  run: (m) => m.decideByAuthor('accept'),
});
add({
  id: 'text.review.rejectByAuthor',
  title: 'textReview.rejectByAuthor',
  keywords: 'textReview.decideKeywords',
  icon: 'UserMinus',
  run: (m) => m.decideByAuthor('reject'),
});
add({
  id: 'text.review.previousChange',
  title: 'textReview.previousChange',
  keywords: 'textReview.changeNavKeywords',
  icon: 'ArrowUp',
  category: 'navigation',
  bar: { group: 'changes', priority: 60 },
  run: (m) => m.moveToChange(-1),
});
add({
  id: 'text.review.nextChange',
  title: 'textReview.nextChange',
  keywords: 'textReview.changeNavKeywords',
  icon: 'ArrowDown',
  category: 'navigation',
  bar: { group: 'changes', priority: 60 },
  run: (m) => m.moveToChange(1),
});
