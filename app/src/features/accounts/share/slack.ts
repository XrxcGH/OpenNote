// Slack: the channels the person can post in, a message, and a file. Slack answers 200 even when it refuses, with
// `ok: false` and an error word, so every answer is checked. The token is the host's and posts as the person.

import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import { bytesPart } from '../host';
import type { Channel, Shared } from './types';

const BASE = 'https://slack.com/api';
const MAX_PAGES = 20;

interface SlackAnswer {
  ok?: boolean;
  error?: string;
}

/** Slack's refusal as the failure the commands already say in words. */
function check<T extends SlackAnswer>(answer: T | undefined): T {
  if (!answer || answer.ok !== true) {
    const error = answer?.error ?? 'unknown_error';
    const status = error === 'missing_scope' || error === 'invalid_auth' ? 403 : 400;
    throw new ConnectorHttpError(status, JSON.stringify({ error }));
  }
  return answer;
}

interface ChannelList extends SlackAnswer {
  channels?: { id: string; name: string; is_archived?: boolean; is_member?: boolean }[];
  response_metadata?: { next_cursor?: string };
}

/** The public and private channels the person is in, by name. */
export async function listSlackChannels(client: ConnectorsClient): Promise<Channel[]> {
  const found: Channel[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const reply = await requestConnector<ChannelList>(
      'slack',
      ['slackChannels'],
      {
        url: `${BASE}/conversations.list`,
        query: {
          types: 'public_channel,private_channel',
          exclude_archived: 'true',
          limit: 200,
          cursor: cursor || null,
        },
      },
      client,
    );
    const answer = check(reply.data);
    for (const channel of answer.channels ?? []) {
      if (channel.is_archived || channel.is_member === false) continue;
      found.push({ id: channel.id, name: channel.name });
    }
    cursor = answer.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

async function post(client: ConnectorsClient, channel: string, text: string): Promise<void> {
  const reply = await requestConnector<SlackAnswer>(
    'slack',
    ['slackPost'],
    { url: `${BASE}/chat.postMessage`, json: { channel, text, unfurl_links: false } },
    client,
  );
  check(reply.data);
}

interface UploadSlot extends SlackAnswer {
  upload_url?: string;
  file_id?: string;
}

/** Uploads the file in Slack's three steps (a slot, the bytes, then the post) and shares it in the channel. */
async function postFile(
  client: ConnectorsClient,
  host: AccountsHost,
  channel: string,
  shared: Extract<Shared, { kind: 'file' }>,
): Promise<void> {
  const slot = check(
    (
      await requestConnector<UploadSlot>(
        'slack',
        ['slackFiles'],
        {
          url: `${BASE}/files.getUploadURLExternal`,
          form: { filename: shared.name, length: String(shared.bytes.length) },
        },
        client,
      )
    ).data,
  );
  if (!slot.upload_url || !slot.file_id) throw new ConnectorHttpError(502, '');
  const sent = await host.upload(
    'slack',
    ['slackFiles'],
    { method: 'POST', url: slot.upload_url },
    [bytesPart(shared.bytes)],
    shared.mime,
  );
  if (sent.status < 200 || sent.status >= 300) throw new ConnectorHttpError(sent.status, sent.body);
  check(
    (
      await requestConnector<SlackAnswer>(
        'slack',
        ['slackFiles'],
        {
          url: `${BASE}/files.completeUploadExternal`,
          json: { files: [{ id: slot.file_id, title: shared.title }], channel_id: channel },
        },
        client,
      )
    ).data,
  );
}

/** Posts the page to the channel: a message with its link, or the file. */
export async function shareToSlack(
  client: ConnectorsClient,
  host: AccountsHost,
  channel: Channel,
  shared: Shared,
  linkMessage: (title: string, link: string) => string,
): Promise<void> {
  if (shared.kind === 'link') await post(client, channel.id, linkMessage(shared.title, shared.link));
  else await postFile(client, host, channel.id, shared);
}
