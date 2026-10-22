// Sync tasks with Microsoft To Do or Google Tasks, and the log of changes that were made in both places. Each sync
// copies changes both ways. It is quiet: one short line when it is done, and the log for the rare conflict.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { connectors } from '../../connectors';
import { accountsHost } from '../host';
import { attempt, isConnected, tellNotConnected } from '../run';
import { loadState, saveState } from '../state';
import { pickOne } from '../ui/prompts';
import { googleTasks } from './google';
import { upcomingTasks } from './local';
import { syncTasks } from './sync';
import { microsoftTodo } from './todo';
import { EMPTY_STATE } from './types';
import type { SyncResult, TasksApi, TasksState } from './types';
import { currentLocale } from '../../../state/language';

export type TasksService = 'microsoft' | 'google';

const stateName = (service: TasksService): string => `tasks.${service}`;
const CONNECTOR: Record<TasksService, string> = { microsoft: 'microsoft', google: 'google' };

export function apiFor(service: TasksService): TasksApi {
  const client = connectors();
  return service === 'google'
    ? googleTasks(client)
    : microsoftTodo(client, Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** Whether this service has been synced before, which is what lets the quiet automatic sync run. */
export async function hasSynced(service: TasksService): Promise<boolean> {
  return (await loadState<TasksState>(stateName(service), EMPTY_STATE, accountsHost())).lastSync !== null;
}

/** One sync, saved. Throws what the service says. */
export async function runSync(service: TasksService): Promise<SyncResult> {
  const host = accountsHost();
  const state = await loadState<TasksState>(stateName(service), EMPTY_STATE, host);
  const done = await syncTasks({ api: apiFor(service), local: upcomingTasks(), state });
  await saveState(stateName(service), done.state, host);
  return done.result;
}

export async function syncNow(service: TasksService): Promise<void> {
  const label = service === 'google' ? 'Google Tasks' : 'Microsoft To Do';
  if (!(await isConnected(CONNECTOR[service]))) return tellNotConnected(label);
  await attempt(label, async () => {
    announce(t('accounts.tasks.working', { service: label }));
    const result = await runSync(service);
    const message =
      result.pulled + result.pushed + result.removed === 0
        ? t('accounts.tasks.upToDate', { service: label })
        : t('accounts.tasks.done', {
            service: label,
            pulled: result.pulled,
            pushed: result.pushed,
            removed: result.removed,
          });
    showToast({
      message:
        result.conflicts > 0 ? `${message} ${t('accounts.tasks.conflicts', { count: result.conflicts })}` : message,
    });
    announce(message);
  });
}

/** The changes made in both places, newest first. */
export async function showConflicts(): Promise<void> {
  const choices = [];
  for (const service of ['microsoft', 'google'] as const) {
    const state = await loadState<TasksState>(stateName(service), EMPTY_STATE, accountsHost());
    for (const [at, one] of state.conflicts.entries()) {
      choices.push({
        id: `${service}:${at}`,
        label: one.title,
        detail: t('accounts.tasks.log.entry', {
          service: service === 'google' ? 'Google Tasks' : 'Microsoft To Do',
          when: new Date(one.at).toLocaleString(currentLocale()),
          kept: t(one.kept === 'here' ? 'accounts.tasks.log.keptHere' : 'accounts.tasks.log.keptThere'),
          other: [
            one.other.done ? t('accounts.tasks.log.done') : '',
            one.other.date ?? '',
            one.other.time ?? '',
            one.other.title,
          ]
            .filter(Boolean)
            .join(' '),
        }),
        value: true as const,
      });
    }
  }
  await pickOne({
    title: t('accounts.tasks.log.title'),
    description: t('accounts.tasks.log.description'),
    confirmLabel: t('accounts.tasks.log.close'),
    choices,
    empty: t('accounts.tasks.log.none'),
  });
}
