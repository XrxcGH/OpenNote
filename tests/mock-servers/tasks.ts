// Mocks of Google Tasks and Microsoft To Do: a default list of tasks that can be listed (across pages), created, changed,
// and deleted. Each keeps the time it was last changed, which a test can set, so last-writer-wins can be tested.
import { MockServer } from './server';

export interface GTask {
  id: string;
  title: string;
  status: 'needsAction' | 'completed';
  due?: string | null;
  updated: string;
}

export function addGoogleTasks(
  server: MockServer,
  initial: GTask[] = [],
  options: { pageSize?: number; clock?: () => string } = {},
) {
  const tasks = new Map<string, GTask>(initial.map((task) => [task.id, task]));
  const clock = options.clock ?? (() => new Date().toISOString());
  const size = options.pageSize ?? 2;
  let next = 100;
  const base = 'tasks.googleapis.com/tasks/v1/lists/@default/tasks';
  server.route(`GET ${base}`, (request) => {
    const start = Number(request.query.pageToken ?? 0) || 0;
    const all = [...tasks.values()];
    const slice = all.slice(start, start + size);
    return { json: { items: slice, ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) } };
  });
  server.route(`POST ${base}`, (request) => {
    const body = request.json<Partial<GTask>>() ?? {};
    const task: GTask = {
      id: `g${next++}`,
      title: body.title ?? '',
      status: body.status ?? 'needsAction',
      due: body.due ?? null,
      updated: clock(),
    };
    tasks.set(task.id, task);
    return { json: task };
  });
  server.route(`PATCH ${base}/:id`, (request, params) => {
    const task = tasks.get(params.id ?? '');
    if (!task) return undefined;
    Object.assign(task, request.json<Partial<GTask>>() ?? {}, { updated: clock() });
    return { json: task };
  });
  server.route(`DELETE ${base}/:id`, (_request, params) => {
    return tasks.delete(params.id ?? '') ? { status: 204, text: '' } : undefined;
  });
  return { tasks };
}

export interface TodoItem {
  id: string;
  title: string;
  status: 'notStarted' | 'completed';
  dueDateTime?: { dateTime: string; timeZone: string } | null;
  reminderDateTime?: { dateTime: string; timeZone: string } | null;
  isReminderOn?: boolean;
  lastModifiedDateTime: string;
}

export function addTodo(
  server: MockServer,
  initial: TodoItem[] = [],
  options: { pageSize?: number; clock?: () => string } = {},
) {
  const tasks = new Map<string, TodoItem>(initial.map((task) => [task.id, task]));
  const clock = options.clock ?? (() => new Date().toISOString());
  const size = options.pageSize ?? 2;
  let next = 100;
  const lists = 'graph.microsoft.com/v1.0/me/todo/lists';
  server.route(`GET ${lists}`, () => ({
    json: {
      value: [
        { id: 'flagged', wellknownListName: 'flaggedEmails' },
        { id: 'LIST', wellknownListName: 'defaultList' },
      ],
    },
  }));
  server.route(`GET ${lists}/LIST/tasks`, (request) => {
    const start = Number(request.query.$skip ?? 0) || 0;
    const all = [...tasks.values()];
    const slice = all.slice(start, start + size);
    const more = start + size < all.length;
    return {
      json: {
        value: slice,
        ...(more
          ? { '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/todo/lists/LIST/tasks?$skip=${start + size}` }
          : {}),
      },
    };
  });
  server.route(`POST ${lists}/LIST/tasks`, (request) => {
    const body = request.json<Partial<TodoItem>>() ?? {};
    const task: TodoItem = {
      id: `t${next++}`,
      title: body.title ?? '',
      status: body.status ?? 'notStarted',
      dueDateTime: body.dueDateTime ?? null,
      reminderDateTime: body.reminderDateTime ?? null,
      isReminderOn: body.isReminderOn ?? false,
      lastModifiedDateTime: clock(),
    };
    tasks.set(task.id, task);
    return { status: 201, json: task };
  });
  server.route(`PATCH ${lists}/LIST/tasks/:id`, (request, params) => {
    const task = tasks.get(params.id ?? '');
    if (!task) return undefined;
    Object.assign(task, request.json<Partial<TodoItem>>() ?? {}, { lastModifiedDateTime: clock() });
    return { json: task };
  });
  server.route(`DELETE ${lists}/LIST/tasks/:id`, (_request, params) => {
    return tasks.delete(params.id ?? '') ? { status: 204, text: '' } : undefined;
  });
  return { tasks };
}
