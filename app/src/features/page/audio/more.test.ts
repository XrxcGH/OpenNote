// The audio lane's later features that need no screen: what the entry keeps beside the host's fields, the media files a
// drop takes, the size text, the storage numbers, the registrations, and the client the tests replace.
import { describe, expect, it } from 'vitest';
import {
  audioIsRemoved,
  enhancedTracks,
  extrasOf,
  listensEnhanced,
  playable,
  withoutEnhanced,
  moreOver,
} from '../../../core/audio';
import type { RecordingEntry, StoredRecording, TrackEntry } from '../../../core/audio';
import { commands, settingsSections } from '../../../registries';
import '../registrations/audioMore';
import { isMediaFile } from './drop';
import { bytesText } from './format';
import { hasHost, moreClient, setMoreClient, withoutHost } from './moreClient';
import { freedBy } from './storage';

const track = (asset: string): TrackEntry => ({
  kind: 'microphone',
  asset,
  timeline: { anchors: [{ frame: 0, timeNs: 5 }], frames: 48_000 },
  silenceFrames: 0,
  droppedPackets: 0,
});

function entry(extra: Record<string, unknown> = {}): RecordingEntry {
  return {
    id: 'rec1',
    state: 'complete',
    started: '2026-10-03T10:00:00Z',
    startedNs: 5,
    endedNs: 1_000_000_005,
    pauses: [],
    tracks: [track('orig')],
    ...extra,
  };
}

describe('the enhanced copy beside the original', () => {
  it('plays the original until the person chooses the copy', () => {
    const held = entry({ enhanced: { tracks: [track('copy')] } });
    expect(enhancedTracks(held).map((one) => one.asset)).toEqual(['copy']);
    expect(listensEnhanced(held)).toBe(false);
    expect(playable(held).tracks[0].asset).toBe('orig');
    const chosen = entry({ enhanced: { tracks: [track('copy')] }, listen: 'enhanced' });
    expect(listensEnhanced(chosen)).toBe(true);
    expect(playable(chosen).tracks[0].asset).toBe('copy');
    expect(playable(chosen, 'original').tracks[0].asset).toBe('orig');
  });

  it('plays the original when the copy is asked for but there is none', () => {
    const lonely = entry({ listen: 'enhanced' });
    expect(listensEnhanced(lonely)).toBe(false);
    expect(playable(lonely, 'enhanced').tracks[0].asset).toBe('orig');
  });

  it('drops the copy and the choices about it, and nothing else', () => {
    const held = entry({
      enhanced: { tracks: [track('copy')] },
      listen: 'enhanced',
      transcribeWith: 'enhanced',
      flags: [{ id: 'f', recording: 'rec1', captureNs: 9, label: '' }],
    });
    const clean = withoutEnhanced(held);
    expect(enhancedTracks(clean)).toEqual([]);
    expect(extrasOf(clean).listen).toBeUndefined();
    expect(extrasOf(clean).transcribeWith).toBeUndefined();
    expect(clean['flags']).toBeDefined();
  });

  it('knows a recording whose audio was removed', () => {
    expect(audioIsRemoved(entry())).toBe(false);
    expect(audioIsRemoved(entry({ tracks: [], audioRemoved: true }))).toBe(true);
  });
});

describe('audio and video files', () => {
  it('takes a file by its type, or by its name when the type is unknown', () => {
    expect(isMediaFile({ name: 'lecture.mp3', type: 'audio/mpeg' })).toBe(true);
    expect(isMediaFile({ name: 'clip.mp4', type: 'video/mp4' })).toBe(true);
    expect(isMediaFile({ name: 'Memo.M4A', type: '' })).toBe(true);
    expect(isMediaFile({ name: 'photo.png', type: 'image/png' })).toBe(false);
    expect(isMediaFile({ name: 'notes.txt', type: '' })).toBe(false);
  });
});

describe('sizes', () => {
  it('writes bytes as KB, MB, or GB', () => {
    expect(bytesText(640)).toBe('1 KB');
    expect(bytesText(640_000)).toBe('640 KB');
    expect(bytesText(12_300_000)).toBe('12.3 MB');
    expect(bytesText(250_000_000)).toBe('250 MB');
    expect(bytesText(2_400_000_000)).toBe('2.4 GB');
  });

  it('says what each quality of Compress frees', () => {
    const stored = { freesSmaller: 100, freesSmallest: 160 } as StoredRecording;
    expect(freedBy(stored, 'smaller')).toBe(100);
    expect(freedBy(stored, 'smallest')).toBe(160);
  });
});

describe('the host commands', () => {
  it('names the commands in snake case with an audio_ prefix, and sends a file as raw bytes with a header', async () => {
    const calls: { command: string; args: unknown; options: unknown }[] = [];
    const more = moreOver((command, args, options) => {
      calls.push({ command, args, options });
      return Promise.resolve(null);
    });
    await more.storageScan();
    await more.meetingPoll(true, ['zoom'], false);
    const bytes = new ArrayBuffer(4);
    await more.importFile('C:/notes/assets', 'talk é.mp3', bytes);
    expect(calls[0].command).toBe('audio_storage_scan');
    expect(calls[1]).toMatchObject({ command: 'audio_meeting_poll', args: { enabled: true, neverFor: ['zoom'] } });
    expect(calls[2].command).toBe('audio_import_file');
    expect(calls[2].args).toBe(bytes);
    const header = (calls[2].options as { headers: Record<string, string> }).headers['x-opennote-import'];
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(decodeURIComponent(header))).toEqual({ assetsDir: 'C:/notes/assets', name: 'talk é.mp3' });
  });

  it('answers "not implemented" without a host, and takes a replacement', async () => {
    expect(hasHost()).toBe(false);
    await expect(withoutHost.split('', entry(), 1)).rejects.toMatchObject({ code: 'notImplemented' });
    expect(await withoutHost.meetingPoll(true, [], false)).toBeNull();
    const fake = { ...withoutHost, purgeHistory: () => Promise.resolve(3) };
    setMoreClient(fake);
    expect(await (await moreClient()).purgeHistory('p')).toBe(3);
    setMoreClient(null);
  });
});

describe('the registrations', () => {
  it('adds the Recording section to Settings and the commands for storage, snaps, and transcripts', () => {
    expect(settingsSections.get('recording')?.title).toBe('audioMore.settings.title');
    for (const id of ['audio.storage', 'audio.snapScreen', 'audio.snapWindow', 'audio.snapRegion']) {
      expect(commands.get(id), id).toBeDefined();
    }
    for (const id of ['transcripts.make', 'transcripts.add', 'transcripts.recap', 'transcripts.quote']) {
      expect(commands.get(id), id).toBeDefined();
    }
  });
});
