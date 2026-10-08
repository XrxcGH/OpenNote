// Canvas, Moodle, and Classroom against mock services: the course and assignment lists (across pages), the section and
// pages a course becomes, the items for Upcoming, and handing in a file the way each service takes it.
import { describe, expect, it } from 'vitest';
import { addCanvas, addClassroom, addMoodle } from '../../../../../tests/mock-servers/lms';
import type { LmsCourse } from '../../../../../tests/mock-servers/lms';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { UpcomingItem } from '../../tools';
import { ConnectorHttpError, createFakeConnectors } from '../../connectors';
import { createFakeAccountsHost } from '../fakeHost';
import { bringCourse } from './bring';
import { canvasApi } from './canvas';
import { classroomApi, dueOf } from './classroom';
import { moodleApi } from './moodle';

const bytes = new TextEncoder().encode('%PDF-1.7 homework');
const file = { name: 'Lab 3.pdf', mime: 'application/pdf', bytes };

const courses: LmsCourse[] = [
  {
    id: 11,
    name: 'Biology 101',
    assignments: [
      { id: 1, name: 'Lab 3', due: '2026-10-14T21:00:00Z', description: '<p>Write up the <b>results</b>.</p>' },
      { id: 2, name: 'Reading quiz', due: '2026-10-09T15:30:00Z', submitted: true },
      { id: 3, name: 'Extra credit' },
    ],
  },
  { id: 12, name: 'Chemistry', assignments: [{ id: 4, name: 'Problem set', due: '2026-10-20T04:00:00Z' }] },
];

async function rig(connector: 'canvas' | 'moodle' | 'google', server: MockServer) {
  const connectors = createFakeConnectors({ respond: server.respond });
  if (connector === 'google') {
    const fresh = createFakeConnectors({ connected: { google: 'sam@example.com' }, respond: server.respond });
    return { client: fresh.client, host: createFakeAccountsHost(() => fresh.client) };
  }
  await connectors.client.connect(connector, { token: 'token-12345678', baseUrl: 'school.example.edu' });
  return { client: connectors.client, host: createFakeAccountsHost(() => connectors.client) };
}

function storage() {
  const notes = createMemoryNotesService({ seed: 'empty' });
  const pages = createMemoryPageService([], {
    missing: (id) => ({ id, title: '', created: '', modified: '', tags: [], view: {}, blocks: [], assets: {} }),
  });
  return { notes, pages };
}

describe('Canvas', () => {
  it('lists courses and assignments across pages, and knows what is handed in', async () => {
    const many: LmsCourse = {
      id: 20,
      name: 'Big course',
      assignments: Array.from({ length: 60 }, (_, at) => ({ id: 100 + at, name: `Task ${at}` })),
    };
    const server = new MockServer();
    addCanvas(server, 'school.example.edu', [...courses, many]);
    const deps = await rig('canvas', server);
    const api = canvasApi(deps);
    expect((await api.courses()).map((one) => one.name)).toEqual(['Biology 101', 'Chemistry', 'Big course']);
    const list = await api.assignments({ service: 'canvas', id: '11', name: 'Biology 101' });
    expect(list.map((one) => [one.title, one.submitted])).toEqual([
      ['Lab 3', false],
      ['Reading quiz', true],
      ['Extra credit', false],
    ]);
    expect(list[0]).toMatchObject({ due: '2026-10-14T21:00:00Z', text: 'Write up the results.' });
    const all = await api.assignments({ service: 'canvas', id: '20', name: 'Big course' });
    expect(all).toHaveLength(60);
    expect(server.requestsTo('GET', '/api/v1/courses/20/assignments')).toHaveLength(2);
  });

  it('hands a file in with the three steps, sending no token to the storage address', async () => {
    const server = new MockServer();
    const canvas = addCanvas(server, 'school.example.edu', courses);
    const deps = await rig('canvas', server);
    const api = canvasApi(deps);
    const result = await api.handIn(
      { service: 'canvas', courseId: '11', id: '1', title: 'Lab 3', due: null, url: null, text: '', submitted: false },
      file,
    );
    expect(result).toEqual({ kind: 'submitted' });
    expect(canvas.uploads).toEqual([
      { fields: ['filename', 'content_type', 'key', 'file'], fileName: 'Lab 3.pdf', bytes: bytes.length, token: false },
    ]);
    expect(canvas.submissions).toEqual([{ course: '11', assignment: '1', fileId: '701' }]);
  });

  it('says a refusal of the file as a failure', async () => {
    const server = new MockServer();
    server.route('POST school.example.edu/api/v1/courses/:c/assignments/:a/submissions/self/files', () => ({
      status: 403,
      json: { message: 'The assignment is closed.' },
    }));
    const api = canvasApi(await rig('canvas', server));
    const error = await api
      .handIn(
        { service: 'canvas', courseId: '11', id: '1', title: '', due: null, url: null, text: '', submitted: false },
        file,
      )
      .catch((one) => one);
    expect(error).toBeInstanceOf(ConnectorHttpError);
    expect((error as ConnectorHttpError).status).toBe(403);
  });
});

describe('Moodle', () => {
  it('lists courses and assignments with their hand-in state, and hands a file in', async () => {
    const server = new MockServer();
    const moodle = addMoodle(server, 'school.example.edu', courses);
    const api = moodleApi(await rig('moodle', server));
    expect((await api.courses()).map((one) => one.name)).toEqual(['Biology 101', 'Chemistry']);
    const list = await api.assignments({ service: 'moodle', id: '11', name: 'Biology 101' });
    expect(list.map((one) => [one.title, one.submitted, one.due !== null])).toEqual([
      ['Lab 3', false, true],
      ['Reading quiz', true, true],
      ['Extra credit', false, false],
    ]);
    expect(list[0]?.url).toBe('https://school.example.edu/mod/assign/view.php?id=1001');
    const first = list[0];
    if (!first) throw new Error('no assignment');
    await api.handIn(first, file);
    const upload = moodle.calls.find((call) => call.fn === 'core_files_upload');
    expect(upload?.fields.filename).toBe('Lab 3.pdf');
    expect(atob(upload?.fields.filecontent ?? '')).toBe('%PDF-1.7 homework');
    expect(moodle.calls.map((call) => call.fn).slice(-2)).toEqual([
      'mod_assign_save_submission',
      'mod_assign_submit_for_grading',
    ]);
    expect(moodle.submitted.has('1')).toBe(true);
  });

  it('reads Moodle’s refusal inside a 200 as a failure', async () => {
    const server = new MockServer();
    addMoodle(server, 'school.example.edu', courses, { badToken: true });
    const api = moodleApi(await rig('moodle', server));
    const error = await api.courses().catch((one) => one);
    expect(error).toBeInstanceOf(ConnectorHttpError);
    expect((error as ConnectorHttpError).status).toBe(401);
  });
});

describe('Google Classroom', () => {
  it('lists courses and assignments across pages with due times in UTC', async () => {
    const server = new MockServer();
    addClassroom(server, courses);
    const api = classroomApi(await rig('google', server));
    expect((await api.courses()).map((one) => one.name)).toEqual(['Biology 101 (Period 2)', 'Chemistry (Period 2)']);
    const list = await api.assignments({ service: 'classroom', id: '11', name: 'Biology 101' });
    expect(list.map((one) => [one.title, one.due, one.submitted])).toEqual([
      ['Lab 3', '2026-10-14T21:00:00.000Z', false],
      ['Reading quiz', '2026-10-09T15:30:00.000Z', true],
      ['Extra credit', null, false],
    ]);
    expect(dueOf({ id: '1', dueDate: { year: 2026, month: 1, day: 5 } })).toBe('2026-01-05T00:00:00.000Z');
  });

  it('saves the PDF in Drive and gives its link, because Classroom takes no file from another app', async () => {
    const server = new MockServer();
    const classroom = addClassroom(server, courses);
    const api = classroomApi(await rig('google', server));
    const result = await api.handIn(
      {
        service: 'classroom',
        courseId: '11',
        id: '1',
        title: 'Lab 3',
        due: null,
        url: null,
        text: '',
        submitted: false,
      },
      file,
    );
    expect(result).toEqual({ kind: 'saved', link: 'https://drive.google.com/file/d/drive1/view' });
    expect(classroom.driveFiles).toEqual([{ name: 'Lab 3.pdf', type: expect.stringContaining('multipart/related') }]);
  });
});

describe('bringing a course in', () => {
  it('makes a section with a page for each assignment, and gives the dated ones to Upcoming', async () => {
    const server = new MockServer();
    addCanvas(server, 'school.example.edu', courses);
    const deps = await rig('canvas', server);
    const api = canvasApi(deps);
    const { notes, pages } = storage();
    const notebook = await notes.create({
      kind: 'notebook',
      placement: { parentId: null, beforeId: null },
      title: 'School',
    });
    const upcoming: { source: string; items: UpcomingItem[] }[] = [];
    const bring = {
      notes,
      pages,
      host: deps.host,
      zone: 'UTC',
      setUpcoming: (source: string, items: UpcomingItem[]) => {
        upcoming.push({ source, items });
        return { added: items.length, removed: 0, changed: 0 };
      },
    };
    const course = { service: 'canvas' as const, id: '11', name: 'Biology 101' };
    const result = await bringCourse(bring, notebook.id, course, 'Canvas', await api.assignments(course));
    expect(result).toMatchObject({ pages: 3, dated: 2 });
    const [section] = await notes.listChildren(notebook.id);
    expect(section?.title).toBe('Biology 101');
    const made = await notes.listChildren(section?.id ?? '');
    expect(made.map((one) => one.title)).toEqual(['Lab 3', 'Reading quiz', 'Extra credit']);
    const lab = pages.held(made[0]?.id ?? '')?.blocks.map((block) => String(block.data.markdown));
    expect(lab?.[0]).toMatch(/^Due Wed, Oct 14/);
    expect(lab?.[1]).toBe('Open in Canvas: https://school.example.edu/courses/11/assignments/1');
    expect(lab?.[2]).toBe('Write up the results.');
    const quiz = pages.held(made[1]?.id ?? '')?.blocks.map((block) => String(block.data.markdown));
    expect(quiz?.[1]).toBe('Handed in.');
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]?.source).toBe('canvas:11');
    expect(upcoming[0]?.items.map((one) => [one.title, one.done, one.due?.time])).toEqual([
      ['Lab 3 (Biology 101)', false, { hour: 21, minute: 0 }],
      ['Reading quiz (Biology 101)', true, { hour: 15, minute: 30 }],
    ]);
  });

  it('updates in place when the school changes things, and leaves the person’s own lines alone', async () => {
    const server = new MockServer();
    addCanvas(server, 'school.example.edu', courses);
    const deps = await rig('canvas', server);
    const api = canvasApi(deps);
    const { notes, pages } = storage();
    const notebook = await notes.create({
      kind: 'notebook',
      placement: { parentId: null, beforeId: null },
      title: 'School',
    });
    const bring = {
      notes,
      pages,
      host: deps.host,
      zone: 'UTC',
      setUpcoming: () => ({ added: 0, removed: 0, changed: 0 }),
    };
    const course = { service: 'canvas' as const, id: '11', name: 'Biology 101' };
    await bringCourse(bring, notebook.id, course, 'Canvas', await api.assignments(course));
    const [section] = await notes.listChildren(notebook.id);
    const [lab] = await notes.listChildren(section?.id ?? '');
    const open = await pages.open(lab?.id ?? '', { viewport: null });
    await open.send({
      edits: [{ edit: 'insertBlock', block: { id: 'mine', type: 'text', data: { markdown: 'My plan.' } } }],
    });
    await open.close();

    const changed = (await api.assignments(course)).map((one) =>
      one.id === '1' ? { ...one, title: 'Lab 3 (revised)', due: '2026-10-16T21:00:00Z' } : one,
    );
    await bringCourse(bring, notebook.id, course, 'Canvas', changed);
    const children = await notes.listChildren(section?.id ?? '');
    expect(children).toHaveLength(3);
    expect(children[0]?.title).toBe('Lab 3 (revised)');
    const blocks = pages.held(lab?.id ?? '')?.blocks.map((block) => String(block.data.markdown));
    expect(blocks?.[0]).toMatch(/^Due Fri, Oct 16/);
    expect(blocks).toContain('My plan.');
    expect(blocks?.filter((one) => one.startsWith('Due '))).toHaveLength(1);
  });
});
