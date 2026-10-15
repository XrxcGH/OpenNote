// Bring in course assignments and Submit page as PDF: choose the school account, the course, and (to hand in) the
// assignment. Nothing is handed in until the last button.

import { getLocation } from '../../../app/location';
import { commandContext } from '../../../commands/registry';
import type { NodeId } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { navigate } from '../../../app/location';
import { shownMounted } from '../../page';
import { renderShownPage } from '../../pages';
import { setSourceItems } from '../../tools';
import { accountsHost } from '../host';
import { services } from '../notebook';
import { attempt, isConnected } from '../run';
import { pickOne } from '../ui/prompts';
import type { Choice } from '../ui/prompts';
import { bringCourse } from './bring';
import type { BringDeps } from './bring';
import { canvasApi } from './canvas';
import { classroomApi } from './classroom';
import { moodleApi } from './moodle';
import { CONNECTOR_OF } from './types';
import type { Assignment, Course, LmsApi, LmsService } from './types';

const ORDER: readonly LmsService[] = ['canvas', 'moodle', 'classroom'];

function apiFor(service: LmsService): LmsApi {
  const deps = { client: commandContext('palette').platform.connectors, host: accountsHost() };
  return service === 'canvas' ? canvasApi(deps) : service === 'moodle' ? moodleApi(deps) : classroomApi(deps);
}

/** The connected services, and the one the person picks when there are several. */
async function chooseService(): Promise<LmsApi | null> {
  const connected: LmsService[] = [];
  for (const service of ORDER) if (await isConnected(CONNECTOR_OF[service])) connected.push(service);
  if (connected.length === 0) {
    showToast({
      message: t('accounts.lms.notConnected'),
      action: {
        label: t('accounts.common.openSettings'),
        run: () => navigate({ view: 'settings', section: 'connectors' }),
      },
    });
    return null;
  }
  const only = connected.length === 1 ? connected[0] : undefined;
  if (only) return apiFor(only);
  const choices: Choice<LmsService>[] = connected.map((service) => ({
    id: service,
    label: apiFor(service).label,
    value: service,
  }));
  const picked = await pickOne({
    title: t('accounts.lms.service.title'),
    description: t('accounts.lms.service.description'),
    choices,
    confirmLabel: t('accounts.lms.service.confirm'),
  });
  return picked ? apiFor(picked) : null;
}

async function notebookHere(): Promise<NodeId | null> {
  const here = getLocation();
  if (here.view === 'workspace' && here.notebookId) return here.notebookId;
  return (await services().notes.listNotebooks())[0]?.id ?? null;
}

export async function bringAssignments(): Promise<void> {
  const api = await chooseService();
  if (!api) return;
  await attempt(api.label, async () => {
    announce(t('accounts.lms.working'));
    const courses = await api.courses();
    const choice = await pickOne<Course | 'all'>({
      title: t('accounts.lms.course.title'),
      description: t('accounts.lms.course.description'),
      confirmLabel: t('accounts.lms.course.confirm'),
      empty: t('accounts.lms.course.none'),
      choices: [
        ...(courses.length > 1 ? [{ id: 'all', label: t('accounts.lms.course.all'), value: 'all' as const }] : []),
        ...courses.map((course) => ({ id: course.id, label: course.name, value: course })),
      ],
    });
    if (!choice) return;
    const notebook = await notebookHere();
    if (!notebook) return;
    const { notes, pages } = services();
    const deps: BringDeps = { notes, pages, host: accountsHost(), setUpcoming: setSourceItems };
    const chosen = choice === 'all' ? courses : [choice];
    let pageCount = 0;
    let dated = 0;
    for (const course of chosen) {
      const result = await bringCourse(deps, notebook, course, api.label, await api.assignments(course));
      pageCount += result.pages;
      dated += result.dated;
    }
    const message = t('accounts.lms.done', { courses: chosen.length, pages: pageCount, dated });
    showToast({ message });
    announce(message);
  });
}

function detailOf(assignment: Assignment): string {
  const when = assignment.due
    ? new Date(assignment.due).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  if (assignment.submitted) return t('accounts.lms.assignment.detailSubmitted', { when }).trim();
  return assignment.due ? t('accounts.lms.assignment.detailDue', { when }) : t('accounts.lms.assignment.detailNoDue');
}

export async function submitPage(): Promise<void> {
  if (!shownMounted.get()) return void showToast({ message: t('accounts.lms.nothing') });
  const api = await chooseService();
  if (!api) return;
  await attempt(api.label, async () => {
    const courses = await api.courses();
    const course = await pickOne({
      title: t('accounts.lms.course.title'),
      confirmLabel: t('accounts.lms.course.submitConfirm'),
      empty: t('accounts.lms.course.none'),
      choices: courses.map((one) => ({ id: one.id, label: one.name, value: one })),
    });
    if (!course) return;
    // Work still to hand in comes first, soonest due first.
    const list = (await api.assignments(course)).sort(
      (a, b) =>
        Number(a.submitted) - Number(b.submitted) ||
        (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
        a.title.localeCompare(b.title),
    );
    const assignment = await pickOne({
      title: t('accounts.lms.assignment.title'),
      description: t('accounts.lms.assignment.description'),
      confirmLabel: t('accounts.lms.assignment.confirm'),
      empty: t('accounts.lms.assignment.none'),
      choices: list.map((one) => ({
        id: one.id,
        label: one.title || t('accounts.lms.untitled'),
        detail: detailOf(one),
        value: one,
      })),
    });
    if (!assignment) return;
    const rendered = await renderShownPage(commandContext('palette'), 'pdf');
    if (!rendered) return void showToast({ message: t('accounts.lms.failedRender'), tone: 'danger' });
    announce(t('accounts.lms.submitting', { title: assignment.title }));
    const result = await api.handIn(assignment, { name: rendered.name, mime: rendered.mime, bytes: rendered.bytes });
    if (result.kind === 'submitted') {
      const message = t('accounts.lms.submitted', { title: assignment.title, course: course.name });
      showToast({ message });
      announce(message);
      return;
    }
    let copied = false;
    try {
      if (result.link) {
        await navigator.clipboard.writeText(result.link);
        copied = true;
      }
    } catch {
      copied = false;
    }
    showToast({
      message: copied
        ? t('accounts.lms.saved', { title: assignment.title })
        : t('accounts.lms.savedNoLink', { title: assignment.title }),
    });
  });
}
