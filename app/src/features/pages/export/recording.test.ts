import { describe, expect, it } from 'vitest';
import { PLAYER_SCRIPT, sha256Base64 } from './recording';
import type { PlayerPlan } from './recording';
import { exportHtml } from './toHtml';
import { readExportPage, RECORDING_TYPE } from './source';

const block = (id: string, order: string, type: string, data: object) => ({ id, order, type, data });

const page = readExportPage({
  id: 'P',
  title: 'Lecture',
  blocks: [
    block('rec', 'a0', RECORDING_TYPE, { recording: 'r1' }),
    block('t1', 'a1', 'text', { markdown: 'Intro to **cells**' }),
    block('t2', 'a2', 'text', { markdown: 'Typed before recording' }),
    block('t3', 'a3', 'text', { markdown: 'Nucleus notes' }),
  ],
});
const plan: PlayerPlan = {
  recordings: new Map([['r1', { src: 'Lecture_audio.opus', seconds: 600 }]]),
  moments: new Map([
    ['t1', 12.345],
    ['t3', 95],
  ]),
};

describe('SHA-256 for the page policy', () => {
  it('matches the known digests', () => {
    expect(sha256Base64('abc')).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    expect(sha256Base64('')).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
    expect(sha256Base64('a'.repeat(1000))).toHaveLength(44);
  });
});

describe('web page export with a recording', () => {
  it('holds the audio beside the file and marks the notes with the moment they were written', () => {
    const { html } = exportHtml(page, { player: plan });
    expect(html).toContain(
      '<figure class="recording"><audio controls preload="metadata" data-recording="r1" ' +
        'src="Lecture_audio.opus" aria-label="Recording"></audio></figure>',
    );
    expect(html).toContain('<div class="moment" data-moment="12.35" tabindex="0"');
    expect(html).toContain('<div class="moment" data-moment="95" tabindex="0"');
    expect(html.match(/data-moment=/g)).toHaveLength(2);
    expect(html).toContain('Typed before recording');
  });

  it('allows its one script by hash and nothing else, and adds none without a recording', () => {
    const { html } = exportHtml(page, { player: plan });
    expect(html).toContain(`script-src 'sha256-${sha256Base64(PLAYER_SCRIPT)}'`);
    expect(html).toContain("media-src 'self' file: data:");
    expect(html.match(/<script[ >]/g)).toHaveLength(1);
    expect(html).toContain(`<script>${PLAYER_SCRIPT}</script>`);
    const plain = exportHtml(page).html;
    expect(plain).not.toContain('<script');
    expect(plain).not.toContain('script-src');
    expect(plain).not.toContain('data-moment');
    const empty = exportHtml(page, { player: { recordings: new Map(), moments: new Map() } }).html;
    expect(empty).not.toContain('<script');
  });

  it('keeps the stand-in text for a recording that has no audio file', () => {
    const none = exportHtml(page, { player: { recordings: new Map(), moments: plan.moments } }).html;
    expect(none).not.toContain('<audio');
  });

  it('follows playback with a script that only reads what the export wrote', () => {
    expect(PLAYER_SCRIPT).toContain('timeupdate');
    expect(PLAYER_SCRIPT).toContain('aria-current');
    expect(PLAYER_SCRIPT).not.toContain('eval');
    expect(PLAYER_SCRIPT).not.toContain('innerHTML');
    expect(PLAYER_SCRIPT).not.toContain('fetch');
    // The script parses as a function body.
    expect(() => new Function(PLAYER_SCRIPT)).not.toThrow();
  });
});
