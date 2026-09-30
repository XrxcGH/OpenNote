// The pane commands (ARCHITECTURE.md section 11.5): show or hide each pane (Ctrl+Shift+1 and Ctrl+Shift+2), and
// widen, narrow, reset, collapse, or expand it. The splitter menus and the View tab's "Pane widths" menu are built
// from the same commands, so every resize works without dragging (WCAG 2.5.7).

import { chord, defineCommand } from '../../commands/registry';
import type { CommandContext, CommandDef, CommandId } from '../../commands/types';
import {
  isPaneResizable,
  isPaneShowing,
  paneWidth,
  resetPane,
  resizePane,
  RESIZE_STEP,
  setPaneShowing,
  togglePane,
} from '../../shell/layout/paneActions';
import { PANE_LIMITS, paneBounds } from '../../shell/layout/solvePanes';
import type { PaneId } from '../../shell/layout/solvePanes';
import { layoutStore } from '../../state/layout';
import { sessionStore } from '../../state/session';
import type { MessageKey } from '../../strings/t';
import { t } from '../../strings/t';

type PaneWord = 'Notebooks' | 'Pages';
const WORD: Record<PaneId, PaneWord> = { notebooks: 'Notebooks', pages: 'Pages' };

const ANNOUNCE: Record<PaneId, { shown: MessageKey; hidden: MessageKey }> = {
  notebooks: { shown: 'layout.announce.notebooksShown', hidden: 'layout.announce.notebooksHidden' },
  pages: { shown: 'layout.announce.pagesShown', hidden: 'layout.announce.pagesHidden' },
};

/** Command bar presses show their state through aria-pressed; the other ways say what happened. */
const SPOKEN: ReadonlySet<CommandContext['source']> = new Set(['keyboard', 'palette', 'menu', 'titleBar']);

function toggle(pane: PaneId): CommandDef {
  return defineCommand({
    id: `layout.toggle${WORD[pane]}`,
    title: `layout.commands.toggle${WORD[pane]}`,
    category: 'view',
    keywords: 'layout.keywords.panes',
    keys: [chord(pane === 'notebooks' ? 'Ctrl+Shift+1' : 'Ctrl+Shift+2')],
    scope: 'workspace',
    checked: () => isPaneShowing(pane),
    run(ctx) {
      const show = !isPaneShowing(pane);
      void togglePane(pane);
      if (SPOKEN.has(ctx.source)) ctx.announce(t(show ? ANNOUNCE[pane].shown : ANNOUNCE[pane].hidden));
    },
  });
}

/** Whether a wide or expanded pane is a column that isn't collapsed. */
const resizable = (pane: PaneId) => isPaneResizable(pane) && !sessionStore.get().panes[pane].collapsed;

function bounds(pane: PaneId) {
  const { width, sizeClass } = layoutStore.get();
  return paneBounds(pane, width, sizeClass, sessionStore.get().panes);
}

/** Collapsing and expanding apply to the wide and expanded columns; the overlay has its own toggle. */
const collapsible = (pane: PaneId) =>
  layoutStore.get().sizeClass === 'wide' || (layoutStore.get().sizeClass === 'expanded' && pane === 'notebooks');

function sizeCommands(pane: PaneId): CommandDef[] {
  const word = WORD[pane];
  const base = { category: 'view' as const, keywords: 'layout.keywords.panes' as const };
  return [
    defineCommand({
      ...base,
      id: `layout.wider${word}`,
      title: `layout.commands.wider${word}`,
      when: () => resizable(pane),
      enabled: () => paneWidth(pane) < bounds(pane).max,
      run: () => resizePane(pane, RESIZE_STEP),
    }),
    defineCommand({
      ...base,
      id: `layout.narrower${word}`,
      title: `layout.commands.narrower${word}`,
      when: () => resizable(pane),
      enabled: () => paneWidth(pane) > bounds(pane).min,
      run: () => resizePane(pane, -RESIZE_STEP),
    }),
    defineCommand({
      ...base,
      id: `layout.reset${word}`,
      title: `layout.commands.reset${word}`,
      when: () => isPaneResizable(pane) || collapsible(pane),
      enabled: () => sessionStore.get().panes[pane].width !== PANE_LIMITS[pane].default,
      run: () => resetPane(pane),
    }),
    defineCommand({
      ...base,
      id: `layout.collapse${word}`,
      title: `layout.commands.collapse${word}`,
      when: () => collapsible(pane) && !sessionStore.get().panes[pane].collapsed,
      run: () => void setPaneShowing(pane, false),
    }),
    defineCommand({
      ...base,
      id: `layout.expand${word}`,
      title: `layout.commands.expand${word}`,
      when: () => collapsible(pane) && sessionStore.get().panes[pane].collapsed,
      run: () => void setPaneShowing(pane, true),
    }),
  ];
}

export const PANE_COMMANDS: readonly CommandDef[] = [
  toggle('notebooks'),
  toggle('pages'),
  ...sizeCommands('notebooks'),
  ...sizeCommands('pages'),
];

/** The size commands of a pane in menu order, and the group each belongs to. */
export function paneMenuCommands(pane: PaneId): { command: CommandId; group: string }[] {
  const word = WORD[pane];
  return [
    { command: `layout.wider${word}`, group: 'size' },
    { command: `layout.narrower${word}`, group: 'size' },
    { command: `layout.reset${word}`, group: 'size' },
    { command: `layout.collapse${word}`, group: 'collapse' },
    { command: `layout.expand${word}`, group: 'collapse' },
  ];
}
