// The subject kits' shared registrations: the kit figure block (a diagram stored as SVG that reopens its tool) and
// the answer to a data field that asks for the open page's tables. Each subject kit registers its own window and
// commands in its own file. Only definitions load at start-up; the figure's code loads when a page shows one.
import { SUBJECT_TABLES_EVENT } from '../../tools/flags';
import { PANEL_TYPES, panelRenderer } from '../panels/kinds';
import { shownMounted } from '../pagesApi';
import { blockRenderers } from '../registries';

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.kitFigure,
    label: 'kitSubjects.figure.label',
    flag: 'kits.calc',
    load: async () => {
      const { mountKitFigure } = await (await import('../../tools')).loadSubjects();
      return { mount: (container, props) => mountKitFigure(container, props) };
    },
  }),
);

// A data field in a kit window asks for the shown page's blocks and reads its tables from them.
if (typeof window !== 'undefined') {
  window.addEventListener(SUBJECT_TABLES_EVENT, (event) => {
    const detail = (
      event as CustomEvent<{ blocks: { id: string; type: string; data: Record<string, unknown> }[] | null }>
    ).detail;
    const mounted = shownMounted.get();
    if (!detail || !mounted) return;
    detail.blocks = mounted.layer.blocks().map((block) => ({ id: block.id, type: block.type, data: block.data }));
  });
}
