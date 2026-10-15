// Two-way task sync against mocks of Microsoft To Do and Google Tasks: a first sync both ways, each field changed on one
// side, a change in both places (the newer one wins and the other is logged), deletes, reminders on To Do, and the
// Upcoming list as the local side.
import { describe, expect, it } from 'vitest';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { addGoogleTasks, addTodo } from '../../../../../tests/mock-servers/tasks';
import type { GTask } from '../../../../../tests/mock-servers/tasks';
import { createFakeConnectors } from '../../connectors';
import { googleTasks } from './google';
import { toLocal } from './local';
import { sameFields, syncTasks } from './sync';
import { microsoftTodo } from './todo';
import { EMPTY_STATE } from './types';
import type { LocalTask, LocalTasks, TasksState } from './types';

/** A local list in memory, with the time of each change when a test wants to say it. */
function memoryList(
  initial: LocalTask[],
  times: Record<string, number> = {},
): LocalTasks & { tasks: Map<string, LocalTask> } {
  const tasks = new Map(initial.map((task) => [task.id, task]));
  return {
    tasks,
    read: () => [...tasks.values()].map((task) => ({ ...task })),
    write(put, remove) {
      for (const task of put) tasks.set(task.id, { ...task });
      for (const id of remove) tasks.delete(id);
    },
    modifiedAt: (id) => times[id] ?? null,
  };
}

const task = (id: string, title: string, rest: Partial<LocalTask> = {}): LocalTask => ({
  id,
  title,
  done: false,
  date: null,
  time: null,
  ...rest,
});

describe('Google Tasks', () => {
  function rig(
    initial: GTask[] = [
      {
        id: 'g1',
        title: 'Read chapter 4',
        status: 'needsAction',
        due: '2026-10-20T00:00:00.000Z',
        updated: '2026-10-01T10:00:00Z',
      },
    ],
  ) {
    const server = new MockServer();
    const mock = addGoogleTasks(server, initial);
    const { client } = createFakeConnectors({ connected: { google: 'sam@example.com' }, respond: server.respond });
    return { api: googleTasks(client), mock, server };
  }

  it('brings tasks over and sends new ones, then does nothing when nothing changed', async () => {
    const { api, mock } = rig();
    const local = memoryList([task('mine', 'Buy graph paper')]);
    const first = await syncTasks({ api, local, state: EMPTY_STATE, now: Date.parse('2026-10-02T09:00:00Z') });
    expect(first.result).toMatchObject({ pulled: 1, pushed: 1, removed: 0 });
    expect(local.tasks.get('google:g1')).toMatchObject({ title: 'Read chapter 4', date: '2026-10-20', done: false });
    expect([...mock.tasks.values()].map((one) => one.title).sort()).toEqual(['Buy graph paper', 'Read chapter 4']);
    const second = await syncTasks({ api, local, state: first.state });
    expect(second.result).toEqual({ pulled: 0, pushed: 0, removed: 0, conflicts: 0 });
  });

  it('copies a change made here, and a change made there', async () => {
    const { api, mock } = rig();
    const local = memoryList([]);
    let state = (await syncTasks({ api, local, state: EMPTY_STATE })).state;
    // Ticked off here.
    const pulled = local.tasks.get('google:g1');
    if (!pulled) throw new Error('not pulled');
    local.tasks.set(pulled.id, { ...pulled, done: true });
    state = (await syncTasks({ api, local, state })).state;
    expect(mock.tasks.get('g1')?.status).toBe('completed');
    // Renamed and moved there.
    const there = mock.tasks.get('g1');
    if (there)
      Object.assign(there, {
        title: 'Read chapter 5',
        due: '2026-10-22T00:00:00.000Z',
        updated: new Date().toISOString(),
      });
    const done = await syncTasks({ api, local, state });
    expect(done.result.pulled).toBe(1);
    expect(local.tasks.get('google:g1')).toMatchObject({ title: 'Read chapter 5', date: '2026-10-22', done: true });
  });

  it('keeps the newer change when both sides changed, and logs the other', async () => {
    const { api, mock } = rig();
    const local = memoryList([]);
    let state = (await syncTasks({ api, local, state: EMPTY_STATE })).state;
    const mine = local.tasks.get('google:g1');
    if (!mine) throw new Error('not pulled');
    const theirs = mock.tasks.get('g1');
    if (!theirs) throw new Error('missing');

    // Here, 10:00. There, 11:00. There is newer.
    local.tasks.set(mine.id, { ...mine, title: 'Local title' });
    Object.assign(theirs, { title: 'Remote title', updated: '2026-10-03T11:00:00Z' });
    const older = memoryList([...local.tasks.values()], { 'google:g1': Date.parse('2026-10-03T10:00:00Z') });
    const lost = await syncTasks({ api, local: older, state });
    expect(lost.result.conflicts).toBe(1);
    expect(older.tasks.get('google:g1')?.title).toBe('Remote title');
    expect(lost.state.conflicts[0]).toMatchObject({ kept: 'there', other: { title: 'Local title' } });

    // Here, 12:00. There, 11:00. Here is newer.
    older.tasks.set('google:g1', { ...(older.tasks.get('google:g1') as LocalTask), title: 'Newest local' });
    Object.assign(theirs, { title: 'Remote again', updated: '2026-10-03T11:00:00Z' });
    const newer = memoryList([...older.tasks.values()], { 'google:g1': Date.parse('2026-10-03T12:00:00Z') });
    const won = await syncTasks({ api, local: newer, state: lost.state });
    expect(mock.tasks.get('g1')?.title).toBe('Newest local');
    expect(won.state.conflicts[0]).toMatchObject({ kept: 'here', other: { title: 'Remote again' } });
  });

  it('deletes on one side only when the other has not changed, and brings a changed task back', async () => {
    const { api, mock } = rig([
      { id: 'g1', title: 'A', status: 'needsAction', due: null, updated: '2026-10-01T10:00:00Z' },
      { id: 'g2', title: 'B', status: 'needsAction', due: null, updated: '2026-10-01T10:00:00Z' },
    ]);
    const local = memoryList([]);
    const state = (await syncTasks({ api, local, state: EMPTY_STATE })).state;
    // A is deleted here. B is deleted here but changed there.
    local.tasks.delete('google:g1');
    local.tasks.delete('google:g2');
    const b = mock.tasks.get('g2');
    if (b) Object.assign(b, { title: 'B changed', updated: new Date().toISOString() });
    const done = await syncTasks({ api, local, state });
    expect(mock.tasks.has('g1')).toBe(false);
    expect(local.tasks.get('google:g2')?.title).toBe('B changed');
    expect(done.result).toMatchObject({ removed: 1, pulled: 1, conflicts: 1 });

    // Deleted there: gone here when unchanged.
    mock.tasks.delete('g2');
    const last = await syncTasks({ api, local, state: done.state });
    expect(local.tasks.has('google:g2')).toBe(false);
    expect(last.result.removed).toBe(1);
  });
});

describe('Microsoft To Do', () => {
  const zone = 'America/Los_Angeles';

  it('syncs the due date and the reminder as the time of day', async () => {
    const server = new MockServer();
    const mock = addTodo(server, [
      {
        id: 't0',
        title: 'Lab report',
        status: 'notStarted',
        dueDateTime: { dateTime: '2026-10-21T00:00:00.0000000', timeZone: 'UTC' },
        reminderDateTime: { dateTime: '2026-10-21T08:30:00.0000000', timeZone: zone },
        isReminderOn: true,
        lastModifiedDateTime: '2026-10-01T10:00:00Z',
      },
    ]);
    const { client } = createFakeConnectors({ connected: { microsoft: 'sam@example.com' }, respond: server.respond });
    const api = microsoftTodo(client, zone);
    const local = memoryList([task('mine', 'Call the lab', { date: '2026-10-25', time: '14:15' })]);
    const first = await syncTasks({ api, local, state: EMPTY_STATE });
    expect(local.tasks.get('microsoft:t0')).toMatchObject({ date: '2026-10-21', time: '08:30' });
    const sent = [...mock.tasks.values()].find((one) => one.title === 'Call the lab');
    expect(sent).toMatchObject({
      isReminderOn: true,
      dueDateTime: { dateTime: '2026-10-25T00:00:00.0000000' },
      reminderDateTime: { dateTime: '2026-10-25T14:15:00.0000000', timeZone: zone },
    });
    expect(server.requests.some((one) => one.headers.prefer === `outlook.timezone="${zone}"`)).toBe(true);

    // Clear the time here: the reminder goes off there.
    const mine = local.tasks.get('mine');
    if (mine) local.tasks.set('mine', { ...mine, time: null });
    await syncTasks({ api, local, state: first.state });
    expect([...mock.tasks.values()].find((one) => one.title === 'Call the lab')?.isReminderOn).toBe(false);
  });

  it('reads tasks across result pages', async () => {
    const server = new MockServer();
    addTodo(
      server,
      ['a', 'b', 'c', 'd', 'e'].map((id) => ({
        id,
        title: id,
        status: 'notStarted' as const,
        lastModifiedDateTime: '2026-10-01T10:00:00Z',
      })),
    );
    const { client } = createFakeConnectors({ connected: { microsoft: 'sam@example.com' }, respond: server.respond });
    expect(await microsoftTodo(client, zone).list()).toHaveLength(5);
  });
});

describe('the pieces', () => {
  it('compares tasks by what is synced', () => {
    expect(sameFields(task('a', 'x'), task('b', 'x'))).toBe(true);
    expect(sameFields(task('a', 'x'), task('a', 'x', { done: true }))).toBe(false);
  });

  it('reads an Upcoming item as a task', () => {
    expect(
      toLocal({
        id: 'u1',
        title: 'Essay',
        done: false,
        due: { date: { year: 2026, month: 3, day: 5 }, time: { hour: 9, minute: 5 } },
      }),
    ).toEqual({ id: 'u1', title: 'Essay', done: false, date: '2026-03-05', time: '09:05' });
  });

  it('keeps no more than fifty conflicts', async () => {
    const server = new MockServer();
    addGoogleTasks(server, []);
    const { client } = createFakeConnectors({ connected: { google: 'a@example.com' }, respond: server.respond });
    const state: TasksState = {
      ...EMPTY_STATE,
      conflicts: Array.from({ length: 50 }, (_, at) => ({
        at: String(at),
        title: 't',
        kept: 'here' as const,
        other: task('x', 'y'),
      })),
    };
    const done = await syncTasks({ api: googleTasks(client), local: memoryList([]), state });
    expect(done.state.conflicts).toHaveLength(50);
  });
});
