// Captions from YouTube and Vimeo against mock services: the track chosen, the transcript read, and the refusals said.
import { describe, expect, it } from 'vitest';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { addVimeoCaptions, addYoutubeCaptions } from '../../../../../tests/mock-servers/video';
import { createFakeConnectors } from '../../connectors';
import { CaptionsError, fetchTranscript, pickTrack } from './captionsFetch';

const srt = '1\n00:00:01,000 --> 00:00:02,000\nHello there\n\n2\n00:01:05,000 --> 00:01:06,000\nSecond minute\n';
const vtt = 'WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nBonjour\n';

describe('picking a track', () => {
  it('prefers the reader language, then a hand-made track', () => {
    const tracks = [{ language: 'en', machine: true }, { language: 'fr' }, { language: 'en-GB' }];
    expect(pickTrack(tracks, 'en-US')?.language).toBe('en-GB');
    expect(pickTrack(tracks, 'de')?.language).toBe('fr');
    expect(pickTrack([], 'en')).toBeNull();
  });
});

describe('YouTube captions', () => {
  it('reads the standard track as a transcript', async () => {
    const server = new MockServer();
    addYoutubeCaptions(server, {
      abc: [
        { id: 't1', language: 'en', kind: 'ASR', srt: '' },
        { id: 't2', language: 'en', srt },
      ],
    });
    const { client } = createFakeConnectors({ connected: { google: 'a@example.com' }, respond: server.respond });
    const transcript = await fetchTranscript(client, 'youtube', 'abc', 'en-US');
    expect(transcript.source).toBe('youtube');
    expect(transcript.lines).toEqual([
      { startMs: 1000, text: 'Hello there' },
      { startMs: 65_000, text: 'Second minute' },
    ]);
    expect(server.requests.map((one) => one.path)).toEqual(['/youtube/v3/captions', '/youtube/v3/captions/t2']);
  });

  it('says so when a video has none, and when it is not the person’s', async () => {
    const server = new MockServer();
    addYoutubeCaptions(server, { abc: [{ id: 't1', language: 'en', srt }] }, false);
    const { client } = createFakeConnectors({ connected: { google: 'a@example.com' }, respond: server.respond });
    await expect(fetchTranscript(client, 'youtube', 'none', 'en')).rejects.toMatchObject({ reason: 'none' });
    const error = await fetchTranscript(client, 'youtube', 'abc', 'en').catch((one: unknown) => one);
    expect(error).toBeInstanceOf(CaptionsError);
    expect((error as CaptionsError).reason).toBe('notOwner');
  });
});

describe('Vimeo captions', () => {
  it('follows the link of the active track', async () => {
    const server = new MockServer();
    addVimeoCaptions(server, {
      '123456': [
        { language: 'en', active: false, vtt: '' },
        { language: 'fr', vtt },
      ],
    });
    const { client } = createFakeConnectors({ connected: { vimeo: 'Sam' }, respond: server.respond });
    const transcript = await fetchTranscript(client, 'vimeo', '123456', 'en');
    expect(transcript).toMatchObject({ language: 'fr', source: 'vimeo', lines: [{ startMs: 3000, text: 'Bonjour' }] });
  });
});
