// Players and live embeds: which links are recognized, that frames only load from the listed hosts (and the app's frame
// list matches), caption files, the playhead stamps, the block's data, and the link preview.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AccountsHost } from '../../accounts';
import { clockMs, clockText, parseCaptions, transcriptMarkdown } from './captions';
import { dataFor, embedDataOf, fallbackFor } from './model';
import { isPlayerStamp, playerStamp, playhead, registerSeeker, seekPlayerStamp } from './playhead';
import { loadPreview } from './preview';
import { FRAME_HOSTS, isFrameAddress, recognize, secondsOf } from './recognize';

const YT = 'dQw4w9WgXcQ';

describe('recognize', () => {
  it('reads the usual YouTube links to one watch address and one frame', () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${YT}&t=1m30s`,
      `https://youtu.be/${YT}?t=90`,
      `https://m.youtube.com/shorts/${YT}`,
      `youtube.com/embed/${YT}`,
    ]) {
      const found = recognize(link);
      expect(found?.provider, link).toBe('youtube');
      expect(found?.url).toBe(`https://www.youtube.com/watch?v=${YT}`);
      expect(found?.embedUrl.startsWith(`https://www.youtube-nocookie.com/embed/${YT}?`)).toBe(true);
      expect(found?.playhead).toBe(true);
    }
    expect(recognize(`https://youtu.be/${YT}?t=90`)?.startSec).toBe(90);
  });

  it('keeps the hash of an unlisted Vimeo video', () => {
    expect(recognize('https://vimeo.com/123456789/abcdef1234')?.embedUrl).toContain('h=abcdef1234');
    expect(recognize('https://vimeo.com/123456789')?.embedUrl).toBe('https://player.vimeo.com/video/123456789?dnt=1');
  });

  it('recognizes podcasts and the live sites', () => {
    expect(recognize('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk?si=x')?.provider).toBe('spotify');
    expect(recognize('https://podcasts.apple.com/us/podcast/some-show/id12345?i=678')?.provider).toBe('applePodcasts');
    expect(recognize('https://www.desmos.com/calculator/abcde12345')?.kind).toBe('live');
    expect(recognize('https://www.geogebra.org/m/abcd1234')?.provider).toBe('geogebra');
    expect(recognize('https://www.figma.com/design/AbCdEf1234567/Name?node-id=1-2')?.url).toContain('node-id=1-2');
    expect(recognize('https://miro.com/app/board/uXjVabc12345=/')?.provider).toBe('miro');
    expect(recognize('https://lucid.app/lucidchart/0b6f1f1e-1111-4222-8333-444455556666/edit')?.provider).toBe(
      'lucidchart',
    );
  });

  it('refuses everything else, including look-alike hosts and links with sign-in details', () => {
    for (const bad of [
      '',
      'hello world',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short',
      'javascript:alert(1)',
      'ftp://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ]) {
      expect(recognize(bad), bad).toBeNull();
    }
  });

  it('only frames the listed hosts, over https', () => {
    expect(isFrameAddress('https://player.vimeo.com/video/1')).toBe(true);
    expect(isFrameAddress('http://player.vimeo.com/video/1')).toBe(false);
    expect(isFrameAddress('https://evil.example/')).toBe(false);
  });

  it("keeps the app's frame-src list in step with the frame hosts", () => {
    const config = JSON.parse(readFileSync('app/src-tauri/tauri.conf.json', 'utf8')) as {
      app: { security: { csp: string } };
    };
    const listed = /frame-src ([^;]+)/.exec(config.app.security.csp)?.[1]?.split(' ') ?? [];
    expect(listed.sort()).toEqual(FRAME_HOSTS.map((host) => `https://${host}`).sort());
  });

  it('reads times', () => {
    expect(secondsOf('1h2m3s')).toBe(3723);
    expect(secondsOf('2:05')).toBe(125);
    expect(secondsOf('nope')).toBeNull();
  });
});

describe('captions', () => {
  it('reads WebVTT and SubRip into timed lines, dropping tags and repeats', () => {
    const vtt =
      'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<i>Hello</i> &amp; welcome\n\n00:00:03.000 --> 00:00:05.000\nHello &amp; welcome\n\n01:05.500 --> 01:07.000\nSecond';
    expect(parseCaptions(vtt)).toEqual([
      { startMs: 1000, text: 'Hello & welcome' },
      { startMs: 65_500, text: 'Second' },
    ]);
    expect(parseCaptions('1\n00:00:02,250 --> 00:00:03,000\nOne\n')).toEqual([{ startMs: 2250, text: 'One' }]);
    expect(clockMs('xx')).toBeNull();
  });

  it('writes the transcript as one paragraph a minute', () => {
    const out = transcriptMarkdown([
      { startMs: 1000, text: 'a' },
      { startMs: 20_000, text: 'b' },
      { startMs: 61_000, text: 'c' },
    ]);
    expect(out).toEqual(['[0:01] a b', '[1:01] c']);
    expect(clockText(3_723_000)).toBe('1:02:03');
  });
});

describe('the block data', () => {
  it("makes the frame address again from the link, so an edited file can't redirect it", () => {
    const found = recognize(`https://youtu.be/${YT}`);
    if (!found) throw new Error('not recognized');
    const data = { ...dataFor(found), embedUrl: 'https://evil.example/' } as Record<string, unknown>;
    expect(embedDataOf({ data })?.embedUrl).toBe(found.embedUrl);
    expect(embedDataOf({ data: { url: 'https://evil.example/' } })).toBeNull();
    expect(fallbackFor({ title: 'A [b]', url: found.url, provider: 'youtube' }).markdown).toBe(
      `[A b](${found.url}) (YouTube)`,
    );
  });
});

describe('the playhead stamp', () => {
  it("stamps only while the shown page's player plays, and seeks it", () => {
    const seeks: number[] = [];
    const forget = registerSeeker('b1', (ms) => seeks.push(ms));
    playhead.set({ block: 'b1', page: 'p1', ms: 1500, playing: true });
    expect(playerStamp('p1')).toEqual({ recording: 'player:b1', captureNs: 1_500_000_000 });
    expect(playerStamp('p2')).toBeNull();
    playhead.set({ block: 'b1', page: 'p1', ms: 1500, playing: false });
    expect(playerStamp('p1')).toBeNull();
    expect(isPlayerStamp('player:b1')).toBe(true);
    expect(seekPlayerStamp('player:b1', 2_000_000_000)).toBe(true);
    expect(seeks).toEqual([2000]);
    forget();
    expect(seekPlayerStamp('player:b1', 0)).toBe(false);
    playhead.set(null);
  });
});

describe('the link preview', () => {
  const host = (answers: Record<string, { status: number; type: string | null; body: Uint8Array | string }>) =>
    ({
      fetchPreview: (url: string) => {
        const one = answers[url];
        if (!one) return Promise.reject(new Error('offline'));
        const bytes = typeof one.body === 'string' ? new TextEncoder().encode(one.body) : one.body;
        return Promise.resolve({ status: one.status, contentType: one.type, bytes });
      },
    }) as unknown as AccountsHost;

  it('takes the title and the picture, and survives a failure of either', async () => {
    const found = recognize(`https://youtu.be/${YT}`);
    if (!found?.previewUrl || !found.pictureUrl) throw new Error('no preview');
    const full = await loadPreview(
      host({
        [found.previewUrl]: { status: 200, type: 'application/json', body: '{"title":"  A  lecture "}' },
        [found.pictureUrl]: { status: 200, type: 'image/jpeg', body: new Uint8Array([1, 2, 3]) },
      }),
      found,
    );
    expect(full.title).toBe('A lecture');
    expect(full.picture?.mime).toBe('image/jpeg');
    expect(full.picture?.name.endsWith('.jpg')).toBe(true);
    expect(await loadPreview(host({}), found)).toEqual({});
    const notImage = await loadPreview(
      host({ [found.pictureUrl]: { status: 200, type: 'text/html', body: '<p>' } }),
      found,
    );
    expect(notImage.picture).toBeUndefined();
  });
});
