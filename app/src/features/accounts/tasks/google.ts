// Google Tasks: the default list's tasks (finished ones too), and creating, changing, and deleting one. Google keeps a due
// date and no time of day, so the time is not synced there, and a finished task keeps its date.
import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { RemoteTask, TaskFields, TasksApi } from './types';

const BASE = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';
const ACCESS = ['tasksWrite'] as const;
const MAX_PAGES = 20;

interface GoogleTask {
  id: string;
  title?: string;
  status?: string;
  due?: string;
  updated?: string;
  deleted?: boolean;
}

interface GoogleList {
  items?: GoogleTask[];
  nextPageToken?: string;
}

function toRemote(task: GoogleTask): RemoteTask {
  return {
    id: task.id,
    title: task.title ?? '',
    done: task.status === 'completed',
    date: task.due ? task.due.slice(0, 10) : null,
    time: null,
    updated: task.updated ?? new Date(0).toISOString(),
  };
}

function body(fields: TaskFields): Record<string, unknown> {
  return {
    title: fields.title,
    status: fields.done ? 'completed' : 'needsAction',
    // A cleared date is sent as null, and a task that is not finished must not carry a completion time.
    due: fields.date ? `${fields.date}T00:00:00.000Z` : null,
    ...(fields.done ? {} : { completed: null }),
  };
}

export function googleTasks(client: ConnectorsClient): TasksApi {
  const send = async (method: 'POST' | 'PATCH', url: string, fields: TaskFields): Promise<RemoteTask> => {
    const reply = await client.request('google', [...ACCESS], {
      method,
      url,
      contentType: 'application/json; charset=UTF-8',
      body: JSON.stringify(body(fields)),
    });
    if (reply.status < 200 || reply.status >= 300) throw new ConnectorHttpError(reply.status, reply.body);
    return toRemote(JSON.parse(reply.body) as GoogleTask);
  };
  return {
    service: 'google',
    label: 'Google Tasks',
    async list() {
      const found: RemoteTask[] = [];
      let token: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const reply = await requestConnector<GoogleList>(
          'google',
          [...ACCESS],
          {
            url: BASE,
            query: { showCompleted: true, showHidden: true, maxResults: 100, pageToken: token },
          },
          client,
        );
        for (const task of reply.data?.items ?? []) if (!task.deleted) found.push(toRemote(task));
        token = reply.data?.nextPageToken;
        if (!token) break;
      }
      return found;
    },
    create: (fields) => send('POST', BASE, fields),
    update: (id, fields) => send('PATCH', `${BASE}/${encodeURIComponent(id)}`, fields),
    async remove(id) {
      const reply = await client.request('google', [...ACCESS], {
        method: 'DELETE',
        url: `${BASE}/${encodeURIComponent(id)}`,
      });
      if ((reply.status < 200 || reply.status >= 300) && reply.status !== 404) {
        throw new ConnectorHttpError(reply.status, reply.body);
      }
    },
  };
}
