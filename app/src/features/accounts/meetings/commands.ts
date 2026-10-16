// The New meeting note command: choose where the meeting is (Outlook, Google Calendar, or a calendar file), choose the
// meeting, and open the note that fills in. With no account connected, the file is still there.

import { getLocation } from '../../../app/location';
import { commandContext } from '../../../commands/registry';
import type { NodeId } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { isConnectorConnected, refreshConnectors } from '../../connectors';
import { openPage } from '../../search';
import { services } from '../notebook';
import { attempt } from '../run';
import { pickOne } from '../ui/prompts';
import type { Choice } from '../ui/prompts';
import { pickFile } from '../ui/pickFile';
import { listGoogleEvents } from './google';
import { eventsFromIcs } from './ics';
import { makeMeetingNote, whenText } from './note';
import { listOutlookEvents } from './outlook';
import { windowAround } from './types';
import type { MeetingEvent, MeetingSource } from './types';

const SERVICE: Record<MeetingSource, string> = { outlook: 'Outlook', google: 'Google', ics: '' };

async function chooseSource(): Promise<MeetingSource | null> {
  await refreshConnectors();
  const choices: Choice<MeetingSource>[] = [];
  if (isConnectorConnected('microsoft')) {
    choices.push({ id: 'outlook', label: t('accounts.meetings.source.outlook'), value: 'outlook' });
  }
  if (isConnectorConnected('google')) {
    choices.push({ id: 'google', label: t('accounts.meetings.source.google'), value: 'google' });
  }
  choices.push({ id: 'ics', label: t('accounts.meetings.source.ics'), value: 'ics' });
  if (choices.length === 1) {
    showToast({ message: t('accounts.meetings.source.connectHint') });
    return 'ics';
  }
  return pickOne({
    title: t('accounts.meetings.source.title'),
    description: t('accounts.meetings.source.description'),
    choices,
    confirmLabel: t('accounts.meetings.source.confirm'),
  });
}

async function readEvents(source: MeetingSource): Promise<MeetingEvent[] | null> {
  const { from, to } = windowAround(new Date());
  const client = commandContext('palette').platform.connectors;
  if (source === 'outlook') return listOutlookEvents(client, from, to);
  if (source === 'google') return listGoogleEvents(client, from, to);
  const file = await pickFile('.ics,text/calendar');
  if (!file) return null;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return eventsFromIcs(await file.text(), new Date(), zone);
  } catch {
    showToast({ message: t('accounts.meetings.icsFailed'), tone: 'danger' });
    return null;
  }
}

function chooseEvent(events: readonly MeetingEvent[]): Promise<MeetingEvent | null> {
  const choices = events.map((event, index) => ({
    id: String(index),
    label: event.title || t('accounts.meetings.event.untitled'),
    detail: event.location
      ? t('accounts.meetings.event.where', { when: whenText(event), place: event.location })
      : whenText(event),
    value: event,
  }));
  return pickOne({
    title: t('accounts.meetings.event.title'),
    description: t('accounts.meetings.event.description'),
    choices,
    confirmLabel: t('accounts.meetings.event.confirm'),
    empty: t('accounts.meetings.event.none'),
  });
}

/** The notebook the note goes in: the open one, else the first. */
async function targetNotebook(): Promise<NodeId | null> {
  const here = getLocation();
  if (here.view === 'workspace' && here.notebookId) return here.notebookId;
  return (await services().notes.listNotebooks())[0]?.id ?? null;
}

export async function newMeetingNote(): Promise<void> {
  const source = await chooseSource();
  if (!source) return;
  const service = SERVICE[source] || t('accounts.meetings.source.ics');
  await attempt(service, async () => {
    announce(t('accounts.meetings.fetching'));
    const events = await readEvents(source);
    if (!events) return;
    if (source === 'ics' && events.length === 0) return void showToast({ message: t('accounts.meetings.icsEmpty') });
    const event = await chooseEvent(events);
    if (!event) return;
    const notebook = await targetNotebook();
    if (!notebook) return;
    const { notes, pages } = services();
    const made = await makeMeetingNote(notes, pages, notebook, event);
    const title = event.title || t('accounts.meetings.event.untitled');
    const message = made.existing ? t('accounts.meetings.opened', { title }) : t('accounts.meetings.done', { title });
    showToast({ message });
    await openPage(notes, made.page.id);
  });
}
