// A local video in the exported page: a video element with its captions, and media allowed only for the page's own files.
import { describe, expect, it } from 'vitest';
import type { ExportPage } from './source';
import { exportHtml } from './toHtml';

const VIDEO_TYPE = 'ext:org.opennote/video';

describe('the exported page', () => {
  const page = (data: Record<string, unknown>): ExportPage =>
    ({
      id: 'p',
      title: 'Video page',
      tags: [],
      language: 'en',
      strokes: [],
      view: {},
      assets: {
        v1: { id: 'v1', file: 'v1.mp4', name: 'Lecture.mp4', mime: 'video/mp4' },
        c1: { id: 'c1', file: 'c1.vtt', name: 'lecture.vtt', mime: 'text/vtt' },
      },
      blocks: [{ id: 'b1', order: 'a', type: 'other', kind: VIDEO_TYPE, ...data }],
    }) as unknown as ExportPage;

  it('writes a video element with its captions and allows only its own files for media', () => {
    const { html, assets } = exportHtml(page({ video: { asset: 'v1', captions: 'c1' } }));
    expect(html).toContain('<video controls');
    expect(html).toContain('src="assets/v1.mp4"');
    expect(html).toContain('<track kind="captions" src="assets/c1.vtt"');
    expect(html).toContain("media-src 'self' file:");
    expect(assets).toEqual(['v1', 'c1']);
  });

  it('leaves media blocked when the page has no video', () => {
    const { html } = exportHtml(page({ fallback: 'Video: x' }));
    expect(html).not.toContain('media-src');
    expect(html).not.toContain('<video');
  });
});
