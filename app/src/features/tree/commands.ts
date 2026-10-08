// The tree's commands (ARCHITECTURE.md sections 13.3 and 14.8). Each acts on the row a context menu named, else
// the focused row of the tree that has focus, else what is open (see current.ts). The navigation keys belong to
// TreeView; these are the keys with modifiers, which can be rebound.

import { chord, defineCommand } from '../../commands/registry';
import type { CommandContext, CommandDef } from '../../commands/types';
import type { ChipColor, NodeId } from '../../services/notes';
import { t } from '../../strings/t';
import { announce } from '../../ui';
import { colorNode } from './actions';
import { canCreate, createFromContext } from './creation';
import type { NewKind } from './creation';
import { currentNode } from './current';
import { changeLevel, moveStep, moveTo } from './movement';
import { selectedNodes } from './multi';
import { loadMultiActions } from './multiActions.lazy';
import { levelAfter, stepOf } from './moves';
import { deleteNode } from './remove';
import { startRename } from './rename';
import { treeStore } from './store';
import { redo, undo } from './undo';

const creating = (id: string, kind: NewKind, def: Partial<CommandDef> & Pick<CommandDef, 'title'>) =>
  defineCommand({
    id: `notes.${id}`,
    category: 'notebooks',
    enabled: (ctx) => canCreate(ctx, kind),
    run: (ctx) => createFromContext(ctx, kind),
    ...def,
  });

const createCommands = [
  creating('newNotebook', 'notebook', { title: 'tree.commands.newNotebook' }),
  creating('newSectionGroup', 'sectionGroup', { title: 'tree.commands.newSectionGroup', flag: 'notes.sectionGroups' }),
  creating('newSection', 'section', {
    title: 'tree.commands.newSection',
    keys: [chord('Ctrl+T')],
    scope: 'workspace',
  }),
  creating('newPage', 'page', {
    title: 'tree.commands.newPage',
    keywords: 'tree.commands.keywords.newPage',
    keys: [chord('Ctrl+N')],
    scope: 'workspace',
  }),
  creating('newSubpage', 'subpage', {
    title: 'tree.commands.newSubpage',
    keys: [chord('Ctrl+Alt+Shift+N')],
    scope: 'workspace',
  }),
];

/** A step is disabled at the end of the list in a menu; from the keyboard it runs, and says so. */
function canStep(ctx: CommandContext, direction: 'up' | 'down'): boolean {
  const node = currentNode(ctx);
  return !!node && (ctx.source !== 'menu' || stepOf(treeStore.get(), node.id, direction) !== null);
}

function moveCommand(direction: 'up' | 'down') {
  const up = direction === 'up';
  return defineCommand({
    id: up ? 'tree.moveUp' : 'tree.moveDown',
    title: up ? 'tree.commands.moveUp' : 'tree.commands.moveDown',
    category: 'notebooks',
    keys: [chord(up ? 'Ctrl+Shift+Up' : 'Ctrl+Shift+Down')],
    scope: 'tree',
    allowRepeat: true,
    palette: false,
    enabled: (ctx) => canStep(ctx, direction),
    run: (ctx) => {
      const node = currentNode(ctx);
      return node ? moveStep(ctx.notes, node, direction) : undefined;
    },
  });
}

function canChangeLevel(ctx: CommandContext, change: 1 | -1): boolean {
  const node = currentNode(ctx);
  return !!node && (ctx.source !== 'menu' || levelAfter(treeStore.get(), node.id, change) !== null);
}

function levelCommand(change: 1 | -1) {
  const indent = change === 1;
  return defineCommand({
    id: indent ? 'pages.indent' : 'pages.outdent',
    title: indent ? 'tree.commands.indent' : 'tree.commands.outdent',
    keywords: indent ? 'tree.commands.keywords.indent' : 'tree.commands.keywords.outdent',
    category: 'notebooks',
    keys: [chord(indent ? 'Ctrl+Shift+Right' : 'Ctrl+Shift+Left'), chord(indent ? 'Ctrl+Alt+]' : 'Ctrl+Alt+[')],
    scope: 'pagesTree',
    when: (ctx) => {
      const node = currentNode(ctx);
      // A menu and the palette offer Promote only on a subpage; the shortcut says why it can't.
      return node?.kind === 'page' && (indent || node.pageLevel > 0 || ctx.source === 'keyboard');
    },
    enabled: (ctx) => canChangeLevel(ctx, change),
    run: (ctx) => {
      const node = currentNode(ctx);
      return node ? changeLevel(ctx.notes, node, change) : undefined;
    },
  });
}

/** Runs a command on the row it acts on, if there is one. */
const onNode =
  (act: (ctx: CommandContext, id: NodeId) => Promise<unknown> | void) =>
  async (ctx: CommandContext): Promise<void> => {
    const node = currentNode(ctx);
    if (node) await act(ctx, node.id);
  };

const editCommands = [
  defineCommand({
    id: 'tree.rename',
    title: 'tree.commands.rename',
    category: 'notebooks',
    keys: [chord('F2')],
    scope: 'tree',
    enabled: (ctx) => currentNode(ctx) !== undefined,
    run: onNode((_ctx, id) => startRename(id)),
  }),
  defineCommand<{ color: ChipColor | null }>({
    id: 'tree.color',
    title: 'tree.commands.color',
    category: 'notebooks',
    palette: false,
    enabled: (ctx) => currentNode(ctx) !== undefined,
    run: async (ctx, args) => {
      const many = selectedNodes(ctx);
      if (many) return (await loadMultiActions()).colorSelection(ctx.notes, many, args?.color ?? null);
      return onNode((c, id) => colorNode(c.notes, id, args?.color ?? null))(ctx);
    },
  }),
  defineCommand({
    id: 'tree.moveTo',
    title: 'tree.commands.moveTo',
    category: 'notebooks',
    keys: [chord('Ctrl+Shift+M')],
    scope: 'tree',
    enabled: (ctx) => ![undefined, 'notebook'].includes(currentNode(ctx)?.kind),
    run: async (ctx) => {
      const many = selectedNodes(ctx);
      if (many) {
        await (await loadMultiActions()).moveSelection(ctx.notes, many);
        return;
      }
      const node = currentNode(ctx);
      if (node) await moveTo(ctx.notes, node);
    },
  }),
  defineCommand({
    id: 'tree.trash',
    title: 'tree.commands.trash',
    keywords: 'tree.commands.keywords.trash',
    category: 'notebooks',
    keys: [chord('Delete')],
    scope: 'tree',
    enabled: (ctx) => currentNode(ctx) !== undefined,
    run: async (ctx) => {
      const many = selectedNodes(ctx);
      if (many) {
        await (await loadMultiActions()).trashSelection(ctx.notes, many);
        return;
      }
      await onNode((c, id) => deleteNode(c.notes, id))(ctx);
    },
  }),
  defineCommand({
    id: 'edit.undo',
    title: 'tree.commands.undo',
    category: 'general',
    keys: [chord('Ctrl+Z')],
    scope: 'workspace',
    run: async (ctx) => {
      if (!(await undo(ctx.notes))) announce(t('tree.undo.nothing'));
    },
  }),
  defineCommand({
    id: 'edit.redo',
    title: 'tree.commands.redo',
    category: 'general',
    keys: [chord('Ctrl+Y'), chord('Ctrl+Shift+Z')],
    scope: 'workspace',
    run: async (ctx) => {
      if (!(await redo(ctx.notes))) announce(t('tree.undo.nothingToRedo'));
    },
  }),
];

// Commands take different argument types, so the list holds them as CommandDef<any>, like the registry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const treeCommands: readonly CommandDef<any>[] = [
  ...createCommands,
  moveCommand('up'),
  moveCommand('down'),
  levelCommand(1),
  levelCommand(-1),
  ...editCommands,
];
