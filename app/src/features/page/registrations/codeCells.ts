// Code cells' registrations (features/codecells; flag math.codeCells): the block, and Insert code cell in the
// Insert tab, the slash menu, the command palette, and Ctrl+Alt+Shift+K. This file loads at start-up, so it holds
// only definitions; the cell and its sandbox load on first use.
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce, confirm } from '../../../ui';
import { focusedPanel } from '../panels/focused';
import { PANEL_TYPES, panelRenderer } from '../panels/kinds';
import type { PanelProps } from '../panels/kinds';
import { blockRenderers } from '../registries';
import { addCommand } from './qolStudy';

interface StudioCell {
  language: string;
  engine: string;
  source: string;
}

/**
 * Turns a code cell into a code project with the same text (after the person confirms), in one edit so one undo
 * takes it back, and opens the Code studio on it. Returns false when the person cancels or no page is shown.
 */
async function openCellInStudio(block: string, current?: StudioCell): Promise<boolean> {
  const [{ shownLayer }, { shownQueue }] = await Promise.all([import('../mount'), import('../sync/shown')]);
  const layer = shownLayer.get();
  const queue = shownQueue.get();
  const cell = layer?.block(block);
  if (!layer || !queue || !cell || cell.type !== PANEL_TYPES.codeCell) return false;
  const ok = await confirm({
    title: t('codeCells.studioConfirm.title'),
    body: t('codeCells.studioConfirm.body'),
    confirmLabel: t('codeCells.studioConfirm.confirm'),
  });
  if (!ok || layer.block(block)?.type !== PANEL_TYPES.codeCell) return false;
  const [{ loadCodeProjects }, cells, { newId }] = await Promise.all([
    import('../../codestudio'),
    import('../../codecells'),
    import('../../../editor/ids'),
  ]);
  const { projectFallback, starterProject, setStudioTarget } = await loadCodeProjects();
  const chosen = current?.language ?? cell.data.language;
  const language = cells.isLanguage(chosen) ? chosen : 'python';
  const engine = (current?.engine ?? cell.data.runtime) === 'python-full' ? 'python-full' : 'python-quick';
  const source = current?.source ?? (typeof cell.data.source === 'string' ? cell.data.source : '');
  const file = cells.FILE_NAMES[language];
  const project = {
    ...starterProject(t('codeStudio.project.starterName'), source),
    language,
    runtime: cells.runtimeOf(language, engine),
    files: { f01: { path: file, text: source, order: 0 } },
  };
  const data = project as unknown as Record<string, unknown>;
  const id = newId();
  const fallback = projectFallback(project);
  const made = { id, type: PANEL_TYPES.codeProject, data, fallback: { markdown: fallback } };
  const ack = await queue.send({
    edits: [
      { edit: 'insertBlock', block: made, after: block },
      { edit: 'deleteBlocks', blocks: [block] },
    ],
  });
  const now = new Date().toISOString();
  layer.upsert({ ...made, order: ack.orderKeys[id] ?? 'zz', created: now, modified: now });
  layer.remove(block);
  announce(t('codeCells.studioOpened'));
  setStudioTarget({ block: id, run: false });
  (await import('../../tools')).openTool('code');
  return true;
}

/** Open in Code studio shows only while the studio is on. */
function withStudio(props: PanelProps): PanelProps & { openStudio?: (cell: StudioCell) => void } {
  if (!isEnabled('code.studio')) return props;
  return { ...props, openStudio: (cell: StudioCell) => void openCellInStudio(props.block, cell) };
}

async function loadCodeCell() {
  const { mountCodeCell } = await import('../../codecells');
  return {
    mount: (container: HTMLElement, props: PanelProps) => {
      const handle = mountCodeCell(container, withStudio(props) as Parameters<typeof mountCodeCell>[1]);
      return {
        update: (next: PanelProps) => handle.update(withStudio(next) as Parameters<typeof mountCodeCell>[1]),
        destroy: handle.destroy,
      };
    },
  };
}

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.codeCell,
    label: 'codeCells.block',
    flag: 'math.codeCells',
    load: loadCodeCell,
  }),
);

addCommand({
  id: 'code.openBlockInStudio',
  title: 'codeCells.openStudioCommand',
  keywords: 'codeCells.insertKeywords',
  icon: 'Terminal',
  flag: 'code.studio',
  run: async () => {
    const { shownLayer } = await import('../mount');
    // A code cell is a panel block with no text editor, so the pool's active block never names it.
    const focus = focusedPanel();
    const id = focus?.block;
    const block = id ? shownLayer.get()?.block(id) : null;
    if (focus?.readOnly) {
      announce(t('codeCells.studioReadOnly'));
    } else if (id && block?.type === PANEL_TYPES.codeCell) {
      await openCellInStudio(id);
    } else if (id && block?.type === PANEL_TYPES.codeProject) {
      const { setStudioTarget } = await (await import('../../codestudio')).loadCodeProjects();
      setStudioTarget({ block: id, run: false });
      (await import('../../tools')).openTool('code');
    } else {
      announce(t('codeCells.studioNoBlock'));
    }
  },
});

addCommand({
  id: 'insert.codeCell',
  title: 'codeCells.insert',
  keywords: 'codeCells.insertKeywords',
  icon: 'Terminal',
  flag: 'math.codeCells',
  keys: ['Ctrl+Alt+Shift+K'],
  slash: { group: 'advanced', order: 34 },
  bar: { group: 'math', priority: 35 },
  run: async () => {
    const { fallbackOf } = await import('../../codecells');
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const source = t('codeCells.starter.python');
    const id = await insertPanelBlock(
      PANEL_TYPES.codeCell,
      { language: 'python', source },
      fallbackOf('python', source),
    );
    if (id) announce(t('codeCells.inserted'));
  },
});
