// Bringing a course in: the course becomes a section of a notebook, each assignment a page in it (with the due date,
// the link, and the instructions at the top), and the assignments with a due date go to Upcoming. Doing it again
// updates what the school changed and leaves everything the person wrote on a page alone.

import type { PagesClient } from '../../../platform/types';
import type { NodeId, NotesService } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { dueAt } from '../../tools';
import type { UpcomingItem } from '../../tools';
import type { AccountsHost } from '../host';
import { cleanTitle, findOrCreate, replaceHeader, appendMarkdown, createPage } from '../notebook';
import { loadState, saveState } from '../state';
import type { Assignment, Course } from './types';

export const STATE_NAME = 'lms.courses';

interface AssignmentState {
  page: string;
  /** The blocks the sync wrote at the top of the page. */
  header: string[];
}

interface CourseState {
  section: string;
  assignments: Record<string, AssignmentState>;
}

interface LmsState {
  courses: Record<string, CourseState>;
}

export interface BringDeps {
  notes: NotesService;
  pages: PagesClient;
  host: AccountsHost;
  /** Puts items in Upcoming, replacing those of the same source. */
  setUpcoming(source: string, items: UpcomingItem[]): { added: number; removed: number; changed: number };
  zone?: string;
}

export interface BringResult {
  pages: number;
  dated: number;
  section: NodeId;
}

const keyOf = (course: Course): string => `${course.service}:${course.id}`;

/** The words for when something is due, in the viewer's zone. */
export function dueText(iso: string | null, zone: string): string {
  if (!iso) return t('accounts.lms.page.noDue');
  const when = new Date(iso);
  return t('accounts.lms.page.due', {
    when: when.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone,
    }),
  });
}

function header(assignment: Assignment, serviceLabel: string, zone: string): string[] {
  const blocks = [dueText(assignment.due, zone)];
  if (assignment.submitted) blocks.push(t('accounts.lms.page.submitted'));
  if (assignment.url) blocks.push(t('accounts.lms.page.open', { service: serviceLabel, link: assignment.url }));
  if (assignment.text) blocks.push(assignment.text);
  return blocks;
}

/** Writes the course and its assignments into the notebook and Upcoming. */
export async function bringCourse(
  deps: BringDeps,
  notebook: NodeId,
  course: Course,
  serviceLabel: string,
  assignments: readonly Assignment[],
): Promise<BringResult> {
  const zone = deps.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const state = await loadState<LmsState>(STATE_NAME, { courses: {} }, deps.host);
  const key = keyOf(course);
  const known = state.courses[key];
  const knownSection = known ? await deps.notes.get(known.section as NodeId) : null;
  const section =
    knownSection ?? (await findOrCreate(deps.notes, notebook, 'section', cleanTitle(course.name, serviceLabel)));
  const courseState: CourseState = { section: section.id, assignments: knownSection ? (known?.assignments ?? {}) : {} };
  state.courses[key] = courseState;

  for (const assignment of assignments) {
    const blocks = header(assignment, serviceLabel, zone);
    const earlier = courseState.assignments[assignment.id];
    const existing = earlier ? await deps.notes.get(earlier.page as NodeId) : null;
    if (existing && earlier) {
      earlier.header = await replaceHeader(deps.pages, earlier.page, earlier.header, blocks);
      // The heading stays in step with the school when the assignment is renamed.
      if (existing.title !== cleanTitle(assignment.title, assignment.title)) {
        await deps.notes.rename(existing.id, cleanTitle(assignment.title, t('accounts.lms.untitled')));
      }
    } else {
      const page = await createPage(
        deps.notes,
        deps.pages,
        section.id,
        assignment.title || t('accounts.lms.untitled'),
        [],
      );
      const made = await appendMarkdown(deps.pages, page.id, blocks);
      courseState.assignments[assignment.id] = { page: page.id, header: made };
    }
    await saveState(STATE_NAME, state, deps.host);
  }

  // Upcoming has the ones that are due and not yet handed in.
  const items: UpcomingItem[] = assignments
    .filter((one) => one.due !== null)
    .map((one) => ({
      id: `${keyOf(course)}:${one.id}`,
      title: `${one.title || t('accounts.lms.untitled')} (${course.name})`,
      due: dueAt(new Date(one.due ?? 0).getTime(), zone),
      done: one.submitted,
      kind: 'task',
    }));
  deps.setUpcoming(keyOf(course), items);
  return { pages: assignments.length, dated: items.length, section: section.id };
}
