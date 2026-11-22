// Code cells' registrations (features/codecells; flag math.codeCells): the block, and Insert code cell in the
// Insert tab, the slash menu, the command palette, and Ctrl+Alt+Shift+K. This file loads at start-up, so it holds
// only definitions; the cell and its sandbox load on first use.
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce, confirm } from '../../../ui';
import { PANEL_TYPES, panelRenderer } from '../panels/kinds';
import { blockRenderers } from '../registries';
import { addCommand } from './qolStudy';

/**
 * Turns a code cell into a code project with the same text (after the person confirms), in one edit so one undo
 * takes it back, and opens the Code studio on it. Returns false when the person cancels or no page is shown.
 */
async function openCellInStudio(
  block: string,
  current?: { language: string; engine: string; source: string },
): Promise<boolean> {
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
  if (!ok) return false;
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

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.codeCell,
    label: 'codeCells.block',
    flag: 'math.codeCells',
    load: async () => {
      const { mountCodeCell } = await import('../../codecells');
      return {
        mount: (container, props) => {
          // Open in Code studio shows only while the studio is on.
          const studio = (next: typeof props) => ({
            ...next,
            ...(isEnabled('code.studio')
              ? {
                  openStudio: (cell: { language: string; engine: string; source: string }) =>
                    void openCellInStudio(next.block, cell),
                }
              : {}),
          });
          const handle = mountCodeCell(container, studio(props));
          return { update: (next) => handle.update(studio(next)), destroy: handle.destroy };
        },
      };
    },
  }),
);

addCommand({
  id: 'code.openBlockInStudio',
  title: 'codeCells.openStudioCommand',
  keywords: 'codeCells.insertKeywords',
  icon: 'Terminal',
  flag: 'code.studio',
  run: async () => {
    const [{ shownLayer }, { shownPool }] = await Promise.all([import('../mount'), import('../pool/shown')]);
    const id = shownPool.get()?.active()?.block;
    const block = id ? shownLayer.get()?.block(id) : null;
    if (id && block?.type === PANEL_TYPES.codeCell) {
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
