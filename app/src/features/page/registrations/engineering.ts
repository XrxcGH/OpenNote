// The engineering lane's registrations: the free-body diagram, beam, truss, and circuit blocks, and the commands
// that insert them from the Insert tab, the slash menu, and the command palette. Only definitions load at start-up;
// each block's editor and solver load when a page shows one.
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { PANEL_TYPES, panelRenderer } from '../panels/kinds';
import { blockRenderers } from '../registries';
import { addCommand } from './qolStudy';

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.fbd,
    label: 'engineering.fbd.block',
    flag: 'engineering.fbd',
    load: async () => {
      const { mountFbd } = await import('../../engineering');
      return { mount: (container, props) => lazyHandle(mountFbd(container, props)) };
    },
  }),
);

addCommand({
  id: 'insert.freeBodyDiagram',
  title: 'engineering.fbd.insert',
  keywords: 'engineering.fbd.insertKeywords',
  icon: 'ArrowsOutCardinal',
  flag: 'engineering.fbd',
  slash: { group: 'advanced', order: 40 },
  bar: { group: 'engineering', priority: 30 },
  run: async () => {
    const { fbdStarter } = await import('../../engineering');
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const { model, fallback } = await fbdStarter();
    const id = await insertPanelBlock(PANEL_TYPES.fbd, { model }, fallback);
    if (id) announce(t('engineering.fbd.inserted'));
  },
});

/** A block handle for a mount that finishes later: updates before then are kept and passed on. */
function lazyHandle<P>(pending: Promise<{ update(props: P): void; destroy(): void }>) {
  let handle: { update(props: P): void; destroy(): void } | null = null;
  let latest: P | null = null;
  let gone = false;
  void pending.then((made) => {
    if (gone) return made.destroy();
    handle = made;
    if (latest) made.update(latest);
  });
  return {
    update(props: P) {
      latest = props;
      handle?.update(props);
    },
    destroy() {
      gone = true;
      handle?.destroy();
    },
  };
}
