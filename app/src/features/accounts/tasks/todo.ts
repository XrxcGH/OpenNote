// Microsoft To Do through Graph: the default list ("Tasks"), its tasks across result pages, and creating, changing, and
// deleting one. A due date is a date. The time of day is the task's reminder: set a time here and To Do reminds you at
// that time, and a reminder set in To Do shows here as the time. Times are asked for in the viewer's own zone.
import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { RemoteTask, TaskFields, TasksApi } from './types';

const GRAPH = 'https://graph.microsoft.com/v1.0/me/todo/lists';
const ACCESS = ['tasksWrite'] as const;
const MAX_PAGES = 30;

interface TodoTask {
  id: string;
  title?: string;
  status?: string;
  dueDateTime?: { dateTime: string; timeZone: string } | null;
  reminderDateTime?: { dateTime: string; timeZone: string } | null;
  isReminderOn?: boolean;
  lastModifiedDateTime?: string;
}

interface Page<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

function toRemote(task: TodoTask): RemoteTask {
  const reminder = task.isReminderOn && task.reminderDateTime ? task.reminderDateTime.dateTime : null;
  return {
    id: task.id,
    title: task.title ?? '',
    done: task.status === 'completed',
    date: task.dueDateTime ? task.dueDateTime.dateTime.slice(0, 10) : reminder ? reminder.slice(0, 10) : null,
    time: reminder ? reminder.slice(11, 16) : null,
    updated: task.lastModifiedDateTime ?? new Date(0).toISOString(),
  };
}

function body(fields: TaskFields, zone: string): Record<string, unknown> {
  return {
    title: fields.title,
    status: fields.done ? 'completed' : 'notStarted',
    dueDateTime: fields.date ? { dateTime: `${fields.date}T00:00:00.0000000`, timeZone: 'UTC' } : null,
    isReminderOn: Boolean(fields.date && fields.time && !fields.done),
    reminderDateTime:
      fields.date && fields.time ? { dateTime: `${fields.date}T${fields.time}:00.0000000`, timeZone: zone } : null,
  };
}

export function microsoftTodo(client: ConnectorsClient, zone: string): TasksApi {
  const headers = { Prefer: `outlook.timezone="${zone}"` };
  let listUrl: string | null = null;

  async function tasksUrl(): Promise<string> {
    if (listUrl) return listUrl;
    const lists = await requestConnector<Page<{ id: string; wellknownListName?: string }>>(
      'microsoft',
      [...ACCESS],
      { url: GRAPH },
      client,
    );
    const all = lists.data?.value ?? [];
    const chosen = all.find((one) => one.wellknownListName === 'defaultList') ?? all[0];
    if (!chosen) throw new ConnectorHttpError(404, JSON.stringify({ error: { message: 'No task list was found.' } }));
    listUrl = `${GRAPH}/${encodeURIComponent(chosen.id)}/tasks`;
    return listUrl;
  }

  const send = async (method: 'POST' | 'PATCH', url: string, fields: TaskFields): Promise<RemoteTask> => {
    const reply = await client.request('microsoft', [...ACCESS], {
      method,
      url,
      headers,
      contentType: 'application/json',
      body: JSON.stringify(body(fields, zone)),
    });
    if (reply.status < 200 || reply.status >= 300) throw new ConnectorHttpError(reply.status, reply.body);
    return toRemote(JSON.parse(reply.body) as TodoTask);
  };

  return {
    service: 'microsoft',
    label: 'Microsoft To Do',
    async list() {
      const found: RemoteTask[] = [];
      let url: string | null = await tasksUrl();
      let query: Record<string, string | number> | undefined = { $top: 100 };
      for (let page = 0; url && page < MAX_PAGES; page += 1) {
        const reply: { data?: Page<TodoTask> } = await requestConnector<Page<TodoTask>>(
          'microsoft',
          [...ACCESS],
          { url, headers, ...(query ? { query } : {}) },
          client,
        );
        for (const task of reply.data?.value ?? []) found.push(toRemote(task));
        url = reply.data?.['@odata.nextLink'] ?? null;
        query = undefined;
      }
      return found;
    },
    async create(fields) {
      return send('POST', await tasksUrl(), fields);
    },
    async update(id, fields) {
      return send('PATCH', `${await tasksUrl()}/${encodeURIComponent(id)}`, fields);
    },
    async remove(id) {
      const reply = await client.request('microsoft', [...ACCESS], {
        method: 'DELETE',
        url: `${await tasksUrl()}/${encodeURIComponent(id)}`,
      });
      if ((reply.status < 200 || reply.status >= 300) && reply.status !== 404) {
        throw new ConnectorHttpError(reply.status, reply.body);
      }
    },
  };
}
