// Teams: the person's teams and their channels, and a channel message. A picture goes in the message itself as a hosted
// image; a PDF is put in the channel's Files folder and the message links to it. The token is the host's and posts as
// the person.

import { requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import { base64Of, bytesPart } from '../host';
import type { Channel, Shared, Team } from './types';

const BASE = 'https://graph.microsoft.com/v1.0';

interface List<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

async function listAll<T>(client: ConnectorsClient, access: string, url: string): Promise<T[]> {
  const found: T[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < 20; page += 1) {
    const reply: { data?: List<T> } = await requestConnector<List<T>>('microsoft', [access], { url: next }, client);
    found.push(...(reply.data?.value ?? []));
    next = reply.data?.['@odata.nextLink'];
  }
  return found;
}

export async function listTeams(client: ConnectorsClient): Promise<Team[]> {
  const teams = await listAll<{ id: string; displayName: string }>(client, 'teamsRead', `${BASE}/me/joinedTeams`);
  return teams.map((team) => ({ id: team.id, name: team.displayName })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listTeamChannels(client: ConnectorsClient, team: Team): Promise<Channel[]> {
  const channels = await listAll<{ id: string; displayName: string }>(
    client,
    'teamsRead',
    `${BASE}/teams/${encodeURIComponent(team.id)}/channels`,
  );
  return channels.map((channel) => ({ id: channel.id, name: channel.displayName, team: team.id }));
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Folder {
  id: string;
  parentReference?: { driveId?: string };
}

/** Puts the file in the channel's Files folder and answers its web address ('' when the answer has none). */
async function putFile(
  client: ConnectorsClient,
  host: AccountsHost,
  channel: Channel,
  shared: Extract<Shared, { kind: 'file' }>,
): Promise<string> {
  const team = encodeURIComponent(channel.team ?? '');
  const folder = (
    await requestConnector<Folder>(
      'microsoft',
      ['onedriveFiles'],
      { url: `${BASE}/teams/${team}/channels/${encodeURIComponent(channel.id)}/filesFolder` },
      client,
    )
  ).data;
  const drive = folder?.parentReference?.driveId;
  if (!folder || !drive) throw new Error('The channel has no Files folder.');
  const sent = await host.upload(
    'microsoft',
    ['onedriveFiles'],
    {
      method: 'PUT',
      url: `${BASE}/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(folder.id)}:/${encodeURIComponent(shared.name)}:/content`,
    },
    [bytesPart(shared.bytes)],
    shared.mime,
  );
  try {
    return (JSON.parse(sent.body) as { webUrl?: string }).webUrl ?? '';
  } catch {
    return '';
  }
}

/** Posts the page to the channel. */
export async function shareToTeams(
  client: ConnectorsClient,
  host: AccountsHost,
  channel: Channel,
  shared: Shared,
  linkMessage: (title: string, link: string) => string,
): Promise<void> {
  const title = escape(shared.title);
  let content: string;
  const extra: Record<string, unknown> = {};
  if (shared.kind === 'link') {
    content = `<p>${escape(linkMessage(shared.title, shared.link))}</p>`;
  } else if (shared.mime === 'image/png') {
    content = `<p>${title}</p><img src="../hostedContents/1/$value" alt="${title}">`;
    extra.hostedContents = [
      {
        '@microsoft.graph.temporaryId': '1',
        contentBytes: base64Of(shared.bytes),
        contentType: shared.mime,
      },
    ];
  } else {
    const url = await putFile(client, host, channel, shared);
    content = url ? `<p><a href="${escape(url)}">${escape(shared.name)}</a></p>` : `<p>${escape(shared.name)}</p>`;
  }
  await requestConnector(
    'microsoft',
    ['teamsPost'],
    {
      url: `${BASE}/teams/${encodeURIComponent(channel.team ?? '')}/channels/${encodeURIComponent(channel.id)}/messages`,
      json: { body: { contentType: 'html', content }, ...extra },
    },
    client,
  );
}
