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

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.beam,
    label: 'engineering.beam.block',
    flag: 'engineering.structures',
    load: async () => {
      const { mountBeam } = await import('../../engineering');
      return { mount: (container, props) => lazyHandle(mountBeam(container, props)) };
    },
  }),
);

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.truss,
    label: 'engineering.truss.block',
    flag: 'engineering.structures',
    load: async () => {
      const { mountTruss } = await import('../../engineering');
      return { mount: (container, props) => lazyHandle(mountTruss(container, props)) };
    },
  }),
);

addCommand({
  id: 'insert.beam',
  title: 'engineering.beam.insert',
  keywords: 'engineering.beam.insertKeywords',
  icon: 'Ruler',
  flag: 'engineering.structures',
  slash: { group: 'advanced', order: 41 },
  bar: { group: 'engineering', priority: 29 },
  run: async () => {
    const { beamStarter } = await import('../../engineering');
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const { model, fallback } = await beamStarter();
    const id = await insertPanelBlock(PANEL_TYPES.beam, { model }, fallback);
    if (id) announce(t('engineering.beam.inserted'));
  },
});

addCommand({
  id: 'insert.truss',
  title: 'engineering.truss.insert',
  keywords: 'engineering.truss.insertKeywords',
  icon: 'Bridge',
  flag: 'engineering.structures',
  slash: { group: 'advanced', order: 42 },
  bar: { group: 'engineering', priority: 28 },
  run: async () => {
    const { trussStarter } = await import('../../engineering');
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const { model, fallback } = await trussStarter();
    const id = await insertPanelBlock(PANEL_TYPES.truss, { model }, fallback);
    if (id) announce(t('engineering.truss.inserted'));
  },
});

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.circuit,
    label: 'engineering.circuit.block',
    flag: 'engineering.circuit',
    load: async () => {
      const { mountCircuit } = await import('../../engineering');
      return { mount: (container, props) => lazyHandle(mountCircuit(container, props)) };
    },
  }),
);

addCommand({
  id: 'insert.circuit',
  title: 'engineering.circuit.insert',
  keywords: 'engineering.circuit.insertKeywords',
  icon: 'Circuitry',
  flag: 'engineering.circuit',
  slash: { group: 'advanced', order: 43 },
  bar: { group: 'engineering', priority: 27 },
  run: async () => {
    const { circuitStarter } = await import('../../engineering');
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const { model, fallback } = await circuitStarter();
    const id = await insertPanelBlock(PANEL_TYPES.circuit, { model }, fallback);
    if (id) announce(t('engineering.circuit.inserted'));
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
