// What the template and series commands do. They load when a command first runs; registrations/qol.ts has the
// definitions.
import { getLocation } from '../../../app/location';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownMounted } from '../pagesApi';
import { pageExtrasPrefs, setPrefs } from '../qol/prefs';
import { insertTemplate, listTemplates, newPageWith, noTemplates } from './apply';
import { markTemplate, shownTags, tagsNow, TEMPLATE_TAG } from './state';
import { pickTemplate } from './TemplatePicker';

function pageTitle(): string {
  return shownMounted.get()?.title?.textbox.textContent?.trim() ?? '';
}

export async function newPageFromTemplate(): Promise<void> {
  const templates = await listTemplates();
  if (templates.length === 0) return noTemplates();
  const choice = await pickTemplate(
    {
      title: t('pageExtras.templates.newPageTitle'),
      description: t('pageExtras.templates.newPageDescription'),
      action: t('pageExtras.templates.create'),
    },
    templates,
  );
  if (choice) await newPageWith({ kind: 'template', template: choice });
}

export async function insertTemplateHere(): Promise<void> {
  const mounted = shownMounted.get();
  if (!mounted) return;
  const templates = (await listTemplates()).filter((template) => template.id !== mounted.page.id);
  if (templates.length === 0) return noTemplates();
  const choice = await pickTemplate(
    {
      title: t('pageExtras.templates.insertTitle'),
      description: t('pageExtras.templates.insertDescription'),
      action: t('pageExtras.templates.insert'),
    },
    templates,
  );
  if (!choice) return;
  const done = await insertTemplate(mounted, choice, pageTitle()).catch(() => false);
  announce(t(done ? 'pageExtras.templates.inserted' : 'pageExtras.templates.notInserted'));
}

/** Tags the shown page as a template, or takes the tag off. */
export async function setTemplate(on: boolean): Promise<void> {
  const mounted = shownMounted.get();
  const shown = shownTags();
  if (!mounted || !shown || mounted.page.readOnly) return;
  const tags = on ? [...new Set([...shown.tags, TEMPLATE_TAG])] : shown.tags.filter((tag) => tag !== TEMPLATE_TAG);
  await mounted.sync.send({ edits: [{ edit: 'setPage', tags }] });
  tagsNow.set(shown.id, tags);
  markTemplate(shown.id, pageTitle(), on);
  showToast({ message: t(on ? 'pageExtras.templates.saved' : 'pageExtras.templates.removed') });
}

/** Chooses the template that new pages in this section start from, or none. */
export async function setSectionDefault(): Promise<void> {
  const location = getLocation();
  const section = location.view === 'workspace' ? location.sectionId : null;
  if (!section) return;
  const templates = await listTemplates();
  const current = pageExtrasPrefs.get().templateDefaults[section] ?? null;
  const choice = await pickTemplate(
    {
      title: t('pageExtras.templates.defaultTitle'),
      description: t('pageExtras.templates.defaultDescription'),
      action: t('pageExtras.templates.setDefault'),
      none: true,
      initial: current ?? '',
    },
    templates,
  );
  if (choice === null) return;
  const next = { ...pageExtrasPrefs.get().templateDefaults };
  if (choice === '') delete next[section];
  else next[section] = choice;
  setPrefs({ templateDefaults: next });
  announce(t(choice === '' ? 'pageExtras.templates.defaultCleared' : 'pageExtras.templates.defaultSet'));
}

/** Makes the next page of the series the shown page belongs to. */
export async function newPageInSeries(): Promise<void> {
  const mounted = shownMounted.get();
  if (!mounted) return;
  await mounted.sync.flushAll('command');
  await newPageWith({ kind: 'series', source: mounted.page.id });
}
