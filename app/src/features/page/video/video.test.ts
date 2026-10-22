// Local videos: which files are accepted (type, size, bytes), the block's data, the player keys, the app's content
// security policy (the asset scheme and nothing else for media).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { applyKey, keyAction } from './keys';
import { bytesMatch, isCaptionFile, isWebVtt, MAX_VIDEO_BYTES, videoMimeOf } from './kinds';
import { dataFor, fallbackFor, VIDEO_TYPE, videoDataOf } from './model';

const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]);

describe('video files', () => {
  it('accepts mp4 and webm by name, and by type when the type agrees', () => {
    expect(videoMimeOf({ name: 'Lecture.MP4', type: 'video/mp4' })).toBe('video/mp4');
    expect(videoMimeOf({ name: 'clip.m4v', type: '' })).toBe('video/mp4');
    expect(videoMimeOf({ name: 'clip.webm', type: 'video/webm' })).toBe('video/webm');
  });

  it('refuses other formats and a type that disagrees with the name', () => {
    expect(videoMimeOf({ name: 'clip.mov', type: 'video/quicktime' })).toBeNull();
    expect(videoMimeOf({ name: 'clip.mkv', type: '' })).toBeNull();
    expect(videoMimeOf({ name: 'page.html', type: 'video/mp4' })).toBeNull();
    expect(videoMimeOf({ name: 'clip.mp4', type: 'text/html' })).toBeNull();
    expect(videoMimeOf({ name: 'clip.webm', type: 'video/mp4' })).toBeNull();
  });

  it('checks the first bytes against the format', () => {
    expect(bytesMatch(MP4, 'video/mp4')).toBe(true);
    expect(bytesMatch(WEBM, 'video/webm')).toBe(true);
    expect(bytesMatch(WEBM, 'video/mp4')).toBe(false);
    expect(bytesMatch(MP4, 'video/webm')).toBe(false);
    expect(bytesMatch(new TextEncoder().encode('<script>alert(1)</script>'), 'video/mp4')).toBe(false);
    expect(bytesMatch(new Uint8Array(3), 'video/mp4')).toBe(false);
  });

  it('limits the size to the attachment limit', () => {
    expect(MAX_VIDEO_BYTES).toBe(200 * 1024 * 1024);
  });

  it('accepts only WebVTT caption files', () => {
    expect(isCaptionFile({ name: 'talk.vtt', type: 'text/vtt' })).toBe(true);
    expect(isCaptionFile({ name: 'talk.srt', type: '' })).toBe(false);
    expect(isCaptionFile({ name: 'talk.vtt', type: 'application/zip' })).toBe(false);
    expect(isWebVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nHi')).toBe(true);
    expect(isWebVtt('﻿WEBVTT - title\n')).toBe(true);
    expect(isWebVtt('WEBVTTX')).toBe(false);
    expect(isWebVtt('1\n00:00:01,000 --> 00:00:02,000')).toBe(false);
  });
});

describe('the block', () => {
  it('keeps the asset and the name, and the captions when there are some', () => {
    expect(videoDataOf({ data: { ...dataFor('a1', 'Lecture.mp4') } })).toEqual({ asset: 'a1', name: 'Lecture.mp4' });
    expect(videoDataOf({ data: { asset: 'a1', name: 'x.mp4', captions: 'c1', captionsName: 'x.vtt' } })).toEqual({
      asset: 'a1',
      name: 'x.mp4',
      captions: 'c1',
      captionsName: 'x.vtt',
    });
  });

  it('reads a hand-edited block without failing', () => {
    expect(videoDataOf({ data: {} })).toBeNull();
    expect(videoDataOf({ data: { asset: 5 } })).toBeNull();
    expect(videoDataOf({ data: { asset: 'a', captions: '' } })).toEqual({ asset: 'a', name: 'video' });
  });

  it('has a fallback that is text, with no markup from the file name', () => {
    expect(fallbackFor('a [b] *c*.mp4').markdown).toBe('Video: a b c.mp4');
    expect(VIDEO_TYPE).toBe('ext:org.opennote/video');
  });
});

describe('player keys', () => {
  it('maps the usual keys', () => {
    expect(keyAction(' ', false)).toEqual({ do: 'toggle' });
    expect(keyAction('ArrowRight', false)).toEqual({ do: 'seek', by: 5 });
    expect(keyAction('ArrowLeft', true)).toEqual({ do: 'seek', by: -10 });
    expect(keyAction('ArrowUp', false)).toEqual({ do: 'volume', by: 0.1 });
    expect(keyAction('c', false)).toEqual({ do: 'captions' });
    expect(keyAction('x', false)).toBeNull();
  });

  const fake = (over: Partial<HTMLVideoElement> = {}) => {
    const track = { mode: 'hidden' };
    return {
      paused: true,
      currentTime: 10,
      duration: 60,
      volume: 0.5,
      muted: true,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      textTracks: [track],
      ...over,
    } as unknown as HTMLVideoElement & { textTracks: { mode: string }[] };
  };

  it('plays and pauses with Space', () => {
    const video = fake();
    applyKey(video, { do: 'toggle' });
    expect(video.play).toHaveBeenCalled();
    const playing = fake({ paused: false });
    applyKey(playing, { do: 'toggle' });
    expect(playing.pause).toHaveBeenCalled();
  });

  it('skips within the video and stays inside it', () => {
    const video = fake();
    applyKey(video, { do: 'seek', by: 5 });
    expect(video.currentTime).toBe(15);
    applyKey(video, { do: 'seek', by: -100 });
    expect(video.currentTime).toBe(0);
    applyKey(video, { do: 'seek', by: 1000 });
    expect(video.currentTime).toBe(60);
  });

  it('changes the volume in tenths, unmuting, between 0 and 1', () => {
    const video = fake();
    expect(applyKey(video, { do: 'volume', by: 0.1 })).toBe('60%');
    expect(video.muted).toBe(false);
    video.volume = 0.95;
    applyKey(video, { do: 'volume', by: 0.1 });
    expect(video.volume).toBe(1);
  });

  it('turns captions on and off', () => {
    const video = fake();
    expect(applyKey(video, { do: 'captions' })).toBe('showing');
    expect(applyKey(video, { do: 'captions' })).toBe('hidden');
    expect(applyKey(fake({ textTracks: [] as unknown as TextTrackList }), { do: 'captions' })).toBe('');
  });
});

describe('the content security policy', () => {
  const csp = (
    JSON.parse(readFileSync('app/src-tauri/tauri.conf.json', 'utf8')) as { app: { security: { csp: string } } }
  ).app.security.csp;
  const directive = (name: string) =>
    (new RegExp(`(?:^|; )${name} ([^;]+)`).exec(csp)?.[1] ?? '').split(' ').filter(Boolean);

  it('lets media load only from the asset scheme and blobs', () => {
    expect(directive('media-src').sort()).toEqual(['blob:', 'http://opennote-asset.localhost', 'opennote-asset:']);
  });

  it('loads nothing remote for media, scripts, or objects', () => {
    for (const name of ['media-src', 'img-src', 'connect-src', 'default-src']) {
      expect(
        directive(name).filter((source) => /^https?:\/\/(?!(opennote-asset|ipc)\.localhost)/.test(source)),
      ).toEqual([]);
    }
    expect(directive('frame-src')).toContain('https://www.youtube-nocookie.com');
  });
});
