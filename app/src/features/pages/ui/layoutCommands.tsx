// What the layout commands do once they load: put a built-in template on the page, set the line spacing, manage saved
// layout templates, and set the notebook's layout for new pages.
import type { CommandContext } from '../../../commands/types';
import { getLocation } from '../../../app/location';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { addLayout, applyLayout, builtinTemplate, layoutOf, setSpacing, setTemplate, writeView } from '../layout';
import type { LayoutTemplate } from '../layout';
import { setNotebookDefault, savedLayouts, setSavedLayouts } from '../live/layoutStore';
import { shownPagesView } from '../live/shown';
import type { TEMPLATE_IDS } from '../paper';
import { SpacingDialog, TemplatesDialog } from './LayoutDialogs';
import { openDialog } from './openDialog';

const texts = () => ({
  lab: {
    name: t('pagesPlus.commands.templateLab'),
    title: t('pagesPlus.layouts.lab.title'),
    date: t('pagesPlus.layouts.lab.date'),
    project: t('pagesPlus.layouts.lab.project'),
    signed: t('pagesPlus.layouts.lab.signed'),
    witnessed: t('pagesPlus.layouts.lab.witnessed'),
  },
  planner: {
    name: t('pagesPlus.commands.templatePlanner'),
    date: t('pagesPlus.layouts.planner.date'),
    todo: t('pagesPlus.layouts.planner.todo'),
    notes: t('pagesPlus.layouts.planner.notes'),
  },
  storyboard: t('pagesPlus.commands.templateStoryboard'),
});

const NAMES = {
  lab: 'pagesPlus.commands.templateLab',
  planner: 'pagesPlus.commands.templatePlanner',
  storyboard: 'pagesPlus.commands.templateStoryboard',
} as const;

/** Puts a built-in template on the shown page. */
export function applyBuiltin(key: keyof typeof TEMPLATE_IDS): void {
  shownPagesView
    .get()
    ?.edit(
      (view) => setTemplate(view, builtinTemplate(key, view, texts())),
      t('pagesPlus.layouts.applied', { name: t(NAMES[key]) }),
    );
}

/** Opens the spacing field for the shown page's paper. */
export async function openSpacing(): Promise<void> {
  const api = shownPagesView.get();
  if (!api) return;
  const { background } = api.view();
  await openDialog((close) => (
    <SpacingDialog
      pattern={background.pattern}
      spacing={background.spacing}
      close={close}
      apply={(units) => {
        api.edit(
          (view) => setSpacing(view, units),
          t('pagesPlus.layouts.spacing.done', { mm: Math.round((units / (96 / 25.4)) * 10) / 10 }),
        );
      }}
    />
  ));
}

let counter = 0;
const newId = () => `layout-${Date.now().toString(36)}-${(counter += 1)}`;

/** Opens the list of saved layout templates. */
export async function openTemplates(ctx: CommandContext): Promise<void> {
  const api = shownPagesView.get();
  if (!api) return;
  await openDialog((close) => (
    <TemplatesDialog
      platform={ctx.platform}
      close={close}
      save={setSavedLayouts}
      make={(name, withPaper) => layoutOf(api.view(), newId(), name, withPaper)}
      use={(layout: LayoutTemplate) => {
        api.edit((view) => applyLayout(view, layout), t('pagesPlus.layouts.applied', { name: layout.name }));
        close();
      }}
      adopt={(layout) => {
        const list = savedLayouts.get();
        const next = addLayout(list, { ...layout, id: newId() });
        if (next === list) return null;
        setSavedLayouts(next);
        return next[next.length - 1];
      }}
    />
  ));
}

/** The notebook of the shown page, or null. */
function shownNotebook(): string | null {
  const location = getLocation();
  return location.view === 'workspace' ? location.notebookId : null;
}

/** Makes the shown page's paper and view the layout of new pages in its notebook, or stops doing so. */
export function useForNewPages(on: boolean): void {
  const api = shownPagesView.get();
  const notebook = shownNotebook();
  if (!api || !notebook) {
    showToast({ message: t('pagesPlus.layouts.notebook.none') });
    return;
  }
  const view = writeView(api.view());
  // Reading order and the text column belong to the page, not to the paper.
  const { readingOrder: _order, contentWidth: _width, ...layout } = view as Record<string, unknown>;
  const kept = setNotebookDefault(notebook, on ? (layout as typeof view) : null);
  if (!kept) showToast({ message: t('pagesPlus.layouts.notebook.failed'), tone: 'danger' });
  else announce(t(on ? 'pagesPlus.layouts.notebook.set' : 'pagesPlus.layouts.notebook.cleared'));
}
