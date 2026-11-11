// @vitest-environment jsdom
// Reveal formatting (text DESIGN.md 4.1 and 5.3): each format at the caret with its source. The fixture is a Heading 2
// whose notebook style sets Georgia, with bold set directly on the run.
import { afterEach, describe, expect, it } from 'vitest';
import { setAlign } from '../../../editor/commands/paragraph';
import { setRunValue, toggleRunMark } from '../../../editor/commands/runFormat';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { APP_STYLES } from '../styles/sets';
import { revealFormatting, revealText } from './reveal';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

const ctx = { app: APP_STYLES, notebook: { h2: { font: 'Georgia' } } };
const texts = () => revealFormatting(mounted!.editor.state, ctx).map((line) => line.text);

describe('reveal formatting', () => {
  it('lists Bold (direct) and Georgia (style Heading 2) for the fixture', () => {
    mounted = mountEditor('## [Title]');
    toggleRunMark('bold')(mounted.editor.state, mounted.editor.view.dispatch);
    const lines = texts();
    expect(lines).toContain('Bold (direct)');
    expect(lines).toContain('Georgia (style Heading 2)');
  });

  it('hides the style value of a format the run sets itself', () => {
    mounted = mountEditor('## [Title]');
    setRunValue('font', 'Palatino')(mounted.editor.state, mounted.editor.view.dispatch);
    const lines = texts();
    expect(lines).toContain('Palatino (direct)');
    expect(lines).not.toContain('Georgia (style Heading 2)');
  });

  it('says where the paragraph formats come from', () => {
    mounted = mountEditor('[one two]');
    setAlign('center')(mounted.editor.state, mounted.editor.view.dispatch);
    const lines = revealFormatting(mounted.editor.state, { app: APP_STYLES, notebook: {} });
    expect(lines.find((line) => line.key === 'align')).toMatchObject({
      source: 'paragraph',
      text: 'Aligned center (paragraph)',
    });
  });

  it('says there is nothing to reveal for plain Normal text', () => {
    mounted = mountEditor('[one two]');
    const lines = revealFormatting(mounted.editor.state, { app: APP_STYLES, notebook: {} });
    expect(lines).toEqual([]);
    expect(revealText(lines)).toBe('No formatting beyond the Normal style.');
  });

  it('joins the lines into one sentence for the live region', () => {
    mounted = mountEditor('[one two]');
    toggleRunMark('italic')(mounted.editor.state, mounted.editor.view.dispatch);
    setAlign('end')(mounted.editor.state, mounted.editor.view.dispatch);
    const text = revealText(revealFormatting(mounted.editor.state, { app: APP_STYLES, notebook: {} }));
    expect(text).toBe('Italic (direct). Aligned end (paragraph)');
  });
});
