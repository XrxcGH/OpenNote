// Upload to YouTube against a mock of its resumable upload: the start request says private or unlisted, the file goes in
// pieces with a range each, a busy answer is tried once more, and a refusal is said.
import { describe, expect, it } from 'vitest';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { addYoutubeUpload } from '../../../../../tests/mock-servers/video';
import { ConnectorHttpError, createFakeConnectors } from '../../connectors';
import { createFakeAccountsHost } from '../fakeHost';
import { CHUNK, uploadVideo } from './upload';

async function rig(server: MockServer, size: number) {
  const connectors = createFakeConnectors({ connected: { google: 'sam@example.com' }, respond: server.respond });
  const host = createFakeAccountsHost(() => connectors.client);
  await host.tempWrite('movie.mp4', { kind: 'text', text: 'v'.repeat(size) });
  return { client: connectors.client, host };
}

describe('uploading a video', () => {
  it('asks for private or unlisted and sends a small file in one piece', async () => {
    const server = new MockServer();
    const state = addYoutubeUpload(server);
    const { client, host } = await rig(server, 1000);
    const done = await uploadVideo(
      { client, host },
      { file: 'movie.mp4', size: 1000, title: 'Cell lecture', privacy: 'unlisted' },
    );
    expect(done).toEqual({ id: 'vid12345678', url: 'https://www.youtube.com/watch?v=vid12345678' });
    expect(state.started).toEqual([{ title: 'Cell lecture', privacy: 'unlisted', length: '1000' }]);
    expect(state.ranges).toEqual(['bytes 0-999/1000']);
  });

  it('sends a large file in pieces and reports the share done', async () => {
    const server = new MockServer();
    const state = addYoutubeUpload(server);
    const size = CHUNK + 500;
    const { client, host } = await rig(server, size);
    const shares: number[] = [];
    await uploadVideo({ client, host }, { file: 'movie.mp4', size, title: 'Long', privacy: 'private' }, (share) =>
      shares.push(share),
    );
    expect(state.ranges).toEqual([`bytes 0-${CHUNK - 1}/${size}`, `bytes ${CHUNK}-${size - 1}/${size}`]);
    expect(shares[shares.length - 1]).toBe(1);
  });

  it('tries a piece again when YouTube was busy, and says so when it refuses', async () => {
    const server = new MockServer();
    const state = addYoutubeUpload(server);
    state.failOnce = 503;
    const { client, host } = await rig(server, 100);
    await uploadVideo({ client, host }, { file: 'movie.mp4', size: 100, title: 'x', privacy: 'private' });
    expect(state.ranges).toHaveLength(1);

    const refusing = new MockServer();
    refusing.route('POST www.googleapis.com/upload/youtube/v3/videos', () => ({
      status: 403,
      json: { error: { message: 'The quota was used up.' } },
    }));
    const other = await rig(refusing, 10);
    await expect(
      uploadVideo(other, { file: 'movie.mp4', size: 10, title: 'x', privacy: 'private' }),
    ).rejects.toBeInstanceOf(ConnectorHttpError);
  });
});
