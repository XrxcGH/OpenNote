// The table blocks that have a cell format bar: the table extra (register.ts) records each block's host here when its
// editor mounts. The bar, the commands, and the format target look hosts up by block, by the editor's state, or
// as the current table.
//
// A block tells its extras about a change from outside (undo, redo, another window), not about the extra's own
// writes. So the host kept here remembers the sheet it wrote, reads it back until the block says otherwise, and
// tells the subscribers, so the bar shows what is on the cell now.
import type { EditorState } from '@tiptap/pm/state';
import { applyMergePatch } from '../../../../platform/mergePatch';
import type { BlockJson } from '../../../../services/pages/types';
import { currentTable } from '../../../page';
import type { TableExtraHost } from '../../../page';

const hosts = new Map<string, TableExtraHost>();
/** The sheet of each block as the extra last knew it: from the block, or from its own write. */
const sheets = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;

/** Tells the subscribers that a block's data changed. */
export function changed(): void {
  version++;
  listeners.forEach((listener) => listener());
}

/** The block's data as the extra knows it: the page's, with the sheet the extra last wrote. */
function known(host: TableExtraHost): Record<string, unknown> {
  const data = host.data();
  return sheets.has(host.block) ? { ...data, sheet: sheets.get(host.block) } : data;
}

/** Remembers the sheet after a patch of the block's data went through. */
function wrote(host: TableExtraHost, patch: Record<string, unknown> | undefined): void {
  if (patch && 'sheet' in patch) sheets.set(host.block, applyMergePatch(known(host).sheet ?? {}, patch.sheet));
  changed();
}

/** Records a block's host. The host kept is the same one with a view of the sheet that follows its own writes. */
export function addHost(host: TableExtraHost): () => void {
  const own: TableExtraHost = {
    ...host,
    data: () => known(host),
    patch: async (data) => {
      const sent = await host.patch(data);
      wrote(host, data);
      return sent;
    },
    apply: async (change, extra) => {
      const done = await host.apply(change, extra);
      if (done) wrote(host, extra);
      return done;
    },
  };
  hosts.set(host.block, own);
  sheets.delete(host.block);
  changed();
  return () => {
    if (hosts.get(host.block) === own) hosts.delete(host.block);
    sheets.delete(host.block);
    changed();
  };
}

/** The block says what it holds now: the page's sheet is the truth again. */
export function blockChanged(block: BlockJson): void {
  sheets.set(block.id, (block.data as Record<string, unknown> | undefined)?.sheet);
  changed();
}

export const subscribeHosts = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const hostsVersion = (): number => version;

export const hostOfBlock = (block: string): TableExtraHost | undefined => hosts.get(block);

/** The hosts of the tables on one open page, in the order they attached. */
export const hostsOfPage = (page: string): TableExtraHost[] => [...hosts.values()].filter((h) => h.page === page);

/** The host whose editor holds this state's document. */
export function hostOfState(state: EditorState): TableExtraHost | undefined {
  for (const host of hosts.values()) if (host.editor.state.doc === state.doc) return host;
  return undefined;
}

/** The host of the table the table commands act on now. */
export function currentHost(): TableExtraHost | undefined {
  const handle = currentTable.get();
  return handle ? hosts.get(handle.block) : undefined;
}

/** What a block's bar opens by name (its palettes). The bar adds these while it shows, so a command opens its own table's. */
const openers = new Map<string, Map<string, () => void>>();

/** Adds a way to open a palette of a block's bar. Returns the call that takes it away. */
export function addOpener(block: string, tool: string, open: () => void): () => void {
  const own = openers.get(block) ?? new Map<string, () => void>();
  openers.set(block, own);
  own.set(tool, open);
  return () => {
    if (own.get(tool) === open) own.delete(tool);
  };
}

/** Opens a palette of a block's bar. Returns false when the block's bar does not show. */
export function openTool(block: string, tool: string): boolean {
  const open = openers.get(block)?.get(tool);
  open?.();
  return open !== undefined;
}
