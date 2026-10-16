// Share to Slack and Teams against mock services: the channel lists, a link message, a file in three steps, a picture in
// a Teams message, a PDF in the channel's Files folder, and Slack's refusals said as failures.
import { describe, expect, it } from 'vitest';
import { addSlack, addTeams } from '../../../../../tests/mock-servers/chat';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { ConnectorHttpError, createFakeConnectors } from '../../connectors';
import { createFakeAccountsHost } from '../fakeHost';
import { serviceWords } from '../run';
import { listSlackChannels, shareToSlack } from './slack';
import { listTeamChannels, listTeams, shareToTeams } from './teams';
import type { Shared } from './types';

const text = (title: string, link: string) => `${title}: ${link}`;
const bytes = new TextEncoder().encode('%PDF-1.7 sample');
const pdf: Shared = { kind: 'file', title: 'Cell notes', name: 'Cell notes.pdf', mime: 'application/pdf', bytes };
const png: Shared = { kind: 'file', title: 'Cell notes', name: 'Cell notes.png', mime: 'image/png', bytes };
const link: Shared = { kind: 'link', title: 'Cell notes', link: 'opennote://page/abc123' };

function rig(connected: Record<string, string>, server: MockServer) {
  const connectors = createFakeConnectors({ connected, respond: server.respond });
  return { client: connectors.client, host: createFakeAccountsHost(() => connectors.client) };
}

describe('Slack', () => {
  const channels = [
    { id: 'C3', name: 'random' },
    { id: 'C1', name: 'biology' },
    { id: 'C2', name: 'old', is_archived: true },
    { id: 'C4', name: 'not-joined', is_member: false },
    { id: 'C5', name: 'chem' },
  ];

  it('lists the channels the person is in, across pages, by name', async () => {
    const server = new MockServer();
    addSlack(server, channels);
    const { client } = rig({ slack: 'Lab' }, server);
    expect((await listSlackChannels(client)).map((one) => one.name)).toEqual(['biology', 'chem', 'random']);
    expect(server.requests).toHaveLength(3);
  });

  it('posts a link as a message', async () => {
    const server = new MockServer();
    const slack = addSlack(server, channels);
    const { client, host } = rig({ slack: 'Lab' }, server);
    await shareToSlack(client, host, { id: 'C1', name: 'biology' }, link, text);
    expect(slack.posted).toEqual([{ channel: 'C1', text: 'Cell notes: opennote://page/abc123' }]);
  });

  it('uploads a file in three steps and shares it in the channel', async () => {
    const server = new MockServer();
    const slack = addSlack(server, channels);
    const { client, host } = rig({ slack: 'Lab' }, server);
    await shareToSlack(client, host, { id: 'C1', name: 'biology' }, pdf, text);
    expect(server.requests.map((one) => one.path)).toEqual([
      '/api/files.getUploadURLExternal',
      '/upload/v1/F1',
      '/api/files.completeUploadExternal',
    ]);
    expect(server.requests[0]?.form).toEqual({ filename: 'Cell notes.pdf', length: String(bytes.length) });
    expect(slack.posted).toEqual([
      { channel: 'C1', file: { id: 'F1', filename: 'Cell notes.pdf', bytes: bytes.length, title: 'Cell notes' } },
    ]);
  });

  it('says a missing permission as a failure that names the scope problem, and never posts', async () => {
    const server = new MockServer();
    const slack = addSlack(server, channels, { scopes: ['channels:read'] });
    const { client, host } = rig({ slack: 'Lab' }, server);
    const error = await shareToSlack(client, host, { id: 'C1', name: 'biology' }, link, text).catch((one) => one);
    expect(error).toBeInstanceOf(ConnectorHttpError);
    expect((error as ConnectorHttpError).status).toBe(403);
    expect(serviceWords(error as ConnectorHttpError)).toBe('missing_scope');
    expect(slack.posted).toEqual([]);
  });
});

describe('Teams', () => {
  const teams = [
    {
      id: 't2',
      displayName: 'Study group',
      channels: [
        { id: 'c9', displayName: 'General' },
        { id: 'c10', displayName: 'Exams' },
      ],
    },
    { id: 't1', displayName: 'Biology 101', channels: [{ id: 'c1', displayName: 'General' }] },
  ];

  it('lists the teams and their channels', async () => {
    const server = new MockServer();
    addTeams(server, teams);
    const { client } = rig({ microsoft: 'sam@example.com' }, server);
    const listed = await listTeams(client);
    expect(listed.map((one) => one.name)).toEqual(['Biology 101', 'Study group']);
    const channels = await listTeamChannels(client, listed[1] ?? { id: '', name: '' });
    expect(channels).toEqual([
      { id: 'c9', name: 'General', team: 't2' },
      { id: 'c10', name: 'Exams', team: 't2' },
    ]);
  });

  it('posts a link, a hosted picture, and a PDF through the channel Files folder', async () => {
    const server = new MockServer();
    const teamsMock = addTeams(server, teams);
    const { client, host } = rig({ microsoft: 'sam@example.com' }, server);
    const channel = { id: 'c9', name: 'General', team: 't2' };
    await shareToTeams(client, host, channel, link, text);
    await shareToTeams(client, host, channel, png, text);
    await shareToTeams(client, host, channel, pdf, text);
    expect(teamsMock.posted.map((one) => one.hostedContents)).toEqual([0, 1, 0]);
    expect(teamsMock.posted[0]?.html).toBe('<p>Cell notes: opennote://page/abc123</p>');
    expect(teamsMock.posted[1]?.html).toContain('hostedContents/1/$value');
    expect(teamsMock.files).toEqual([{ drive: 'drive-t2', folder: '', name: 'Cell notes.pdf', bytes: bytes.length }]);
    expect(teamsMock.posted[2]?.html).toBe(
      '<p><a href="https://contoso.sharepoint.example/Cell%20notes.pdf">Cell notes.pdf</a></p>',
    );
    const scopes = server.requests.map((one) => one.connector);
    expect(new Set(scopes)).toEqual(new Set(['microsoft']));
  });

  it('escapes a page title that holds markup', async () => {
    const server = new MockServer();
    const teamsMock = addTeams(server, teams);
    const { client, host } = rig({ microsoft: 'sam@example.com' }, server);
    await shareToTeams(
      client,
      host,
      { id: 'c9', name: 'General', team: 't2' },
      { ...png, title: '<b>x</b> & "y"' },
      text,
    );
    expect(teamsMock.posted[0]?.html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
    expect(teamsMock.posted[0]?.html).not.toContain('<b>');
  });
});
