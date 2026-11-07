// Code projects' registrations (features/codestudio/project; flag code.studio): the block, a compact card with
// Run and Open in Code studio, and Insert code project in the Insert tab, the slash menu, and the command palette.
// This file loads at start-up, so it holds only definitions; the card and its store load on first use.
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { PANEL_TYPES, panelRenderer } from '../panels/kinds';
import { blockRenderers } from '../registries';
import { addCommand } from './qolStudy';

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.codeProject,
    label: 'codeStudio.project.block',
    flag: 'code.studio',
    load: async () => {
      const { mountCodeProject } = await (await import('../../codestudio')).loadCodeProjects();
      return { mount: (container, props) => mountCodeProject(container, props) };
    },
  }),
);

addCommand({
  id: 'insert.codeProject',
  title: 'codeStudio.project.insert',
  keywords: 'codeStudio.project.insertKeywords',
  icon: 'Terminal',
  flag: 'code.studio',
  slash: { group: 'advanced', order: 35 },
  bar: { group: 'codeProject', priority: 34 },
  run: async () => {
    const { projectFallback, starterProject } = await (await import('../../codestudio')).loadCodeProjects();
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const project = starterProject(t('codeStudio.project.starterName'), t('codeStudio.project.starterMain'));
    const data = project as unknown as Record<string, unknown>;
    const id = await insertPanelBlock(PANEL_TYPES.codeProject, data, projectFallback(project));
    if (id) announce(t('codeStudio.project.inserted'));
  },
});
