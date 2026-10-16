// Mocks of Slack's Web API and the parts of Microsoft Graph that Teams sharing uses. Slack answers 200 with `ok: false`
// when it refuses, as the real one does. Each mock keeps what was posted so a test can check it.
import type { MockServer } from './server';

export interface SlackPosted {
  channel: string;
  text?: string;
  file?: { id: string; filename: string; bytes: number; title?: string };
}

export function addSlack(
  server: MockServer,
  channels: { id: string; name: string; is_member?: boolean; is_archived?: boolean }[],
  options: { scopes?: string[] } = {},
) {
  const posted: SlackPosted[] = [];
  const slots = new Map<string, { filename: string; length: number; bytes: number }>();
  const lacks = (scope: string) => options.scopes !== undefined && !options.scopes.includes(scope);
  server.route('GET slack.com/api/conversations.list', (request) => {
    if (lacks('channels:read')) return { json: { ok: false, error: 'missing_scope' } };
    const start = Number(request.query.cursor ?? 0) || 0;
    const slice = channels.slice(start, start + 2);
    const next = start + 2 < channels.length ? String(start + 2) : '';
    return { json: { ok: true, channels: slice, response_metadata: { next_cursor: next } } };
  });
  server.route('POST slack.com/api/chat.postMessage', (request) => {
    if (lacks('chat:write')) return { json: { ok: false, error: 'missing_scope' } };
    const body = request.json<{ channel: string; text: string }>();
    if (!body || !channels.some((one) => one.id === body.channel))
      return { json: { ok: false, error: 'channel_not_found' } };
    posted.push({ channel: body.channel, text: body.text });
    return { json: { ok: true } };
  });
  server.route('POST slack.com/api/files.getUploadURLExternal', (request) => {
    const filename = request.form.filename ?? '';
    const length = Number(request.form.length ?? 0);
    const id = `F${slots.size + 1}`;
    slots.set(id, { filename, length, bytes: 0 });
    return { json: { ok: true, upload_url: `https://files.slack.com/upload/v1/${id}`, file_id: id } };
  });
  server.route('POST files.slack.com/upload/v1/:id', (request, params) => {
    const slot = slots.get(params.id ?? '');
    if (!slot) return undefined;
    // The base64 bytes were decoded into text by the fake host; the length is checked by the byte count of the body.
    slot.bytes = request.body.length;
    return { text: 'OK - ' + String(slot.bytes) };
  });
  server.route('POST slack.com/api/files.completeUploadExternal', (request) => {
    const body = request.json<{ files: { id: string; title?: string }[]; channel_id: string }>();
    const file = body?.files[0];
    const slot = file ? slots.get(file.id) : undefined;
    if (!body || !file || !slot) return { json: { ok: false, error: 'invalid_arguments' } };
    posted.push({
      channel: body.channel_id,
      file: { id: file.id, filename: slot.filename, bytes: slot.bytes, title: file.title },
    });
    return { json: { ok: true } };
  });
  return { posted, slots };
}

export interface TeamsPosted {
  team: string;
  channel: string;
  html: string;
  hostedContents: number;
}

export function addTeams(
  server: MockServer,
  teams: { id: string; displayName: string; channels: { id: string; displayName: string }[] }[],
) {
  const posted: TeamsPosted[] = [];
  const files: { drive: string; folder: string; name: string; bytes: number }[] = [];
  server.route('GET graph.microsoft.com/v1.0/me/joinedTeams', () => ({
    json: { value: teams.map((team) => ({ id: team.id, displayName: team.displayName })) },
  }));
  server.route('GET graph.microsoft.com/v1.0/teams/:team/channels', (_request, params) => {
    const team = teams.find((one) => one.id === params.team);
    return team ? { json: { value: team.channels } } : undefined;
  });
  server.route('GET graph.microsoft.com/v1.0/teams/:team/channels/:channel/filesFolder', (_request, params) => ({
    json: { id: `folder-${params.channel}`, parentReference: { driveId: `drive-${params.team}` } },
  }));
  server.route('PUT graph.microsoft.com/v1.0/drives/:drive/items/*', (request, params) => {
    const name = decodeURIComponent(request.path.split(':/')[1]?.split(':/')[0] ?? '');
    files.push({ drive: params.drive ?? '', folder: '', name, bytes: request.body.length });
    return { json: { webUrl: `https://contoso.sharepoint.example/${encodeURIComponent(name)}` } };
  });
  server.route('POST graph.microsoft.com/v1.0/teams/:team/channels/:channel/messages', (request, params) => {
    const body = request.json<{ body: { content: string }; hostedContents?: unknown[] }>();
    if (!body) return { status: 400, json: { error: { message: 'No message.' } } };
    posted.push({
      team: params.team ?? '',
      channel: params.channel ?? '',
      html: body.body.content,
      hostedContents: body.hostedContents?.length ?? 0,
    });
    return { status: 201, json: { id: 'm1' } };
  });
  return { posted, files };
}
