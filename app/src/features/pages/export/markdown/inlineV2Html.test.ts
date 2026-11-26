// Hand-worked HTML for fixtures of the shared inline-v2 set (docs/format/fixtures/markdown/inline-v2). Each expected
// string is worked out from the spec's CSS mapping (CSS Fonts 4, CSS Writing Modes 3, HTML escaping), never from the
// renderer's output. The fixture's own Markdown is rendered, so a fixture that changes shows up here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseInline, renderInlineHtml } from './index';

const FILE = fileURLToPath(
  new URL('../../../../../../docs/format/fixtures/markdown/inline-v2/cases.json', import.meta.url),
);
const cases = (JSON.parse(readFileSync(FILE, 'utf8')) as { cases: { name: string; markdown: string }[] }).cases;
const markdownOf = (name: string): string => {
  const found = cases.find((c) => c.name === name);
  if (!found) throw new Error(`no fixture named ${name}`);
  return found.markdown;
};
// One fixture for each mark and value form. Font weights map to font-weight as they are (CSS Fonts 4). Kerning is
// normal for 1 and above and none for 0. A feature tag becomes a font-feature-settings entry with the value 1. A
// language tag is the lang attribute as it is.
// with the value 1; a language tag is the lang attribute as it is.
const EXPECTED: readonly (readonly [string, string])[] = [
  ['weight 100', 'a <span style="font-weight:100">word</span> b'],
  ['weight 900', 'a <span style="font-weight:900">word</span> b'],
  ['kern 1', 'a <span style="font-kerning:normal">word</span> b'],
  ['kern off', 'a <span style="font-kerning:none">word</span> b'],
  ['otf ss20', 'a <span style="font-feature-settings:&#34;ss20&#34; 1">word</span> b'],
  ['no spelling check', 'a <span lang="zxx">word</span> b'],
];

describe('hand-worked HTML for the inline-v2 fixtures', () => {
  it.each(EXPECTED)('%s', (name, html) => {
    expect(renderInlineHtml(parseInline(markdownOf(name)))).toBe(html);
  });

  it.each(['caps none', 'direction auto'])('reads %s as a foreign mark, which has no HTML of its own', (name) => {
    // The fixture's tree holds the tag as a foreign mark, so only its text is shown.
    expect(renderInlineHtml(parseInline(markdownOf(name)))).toBe('a word b');
  });

  it('keeps a tag inside a code span as the code it is', () => {
    // HTML text escapes & < >; the quote stays as it is in element content.
    expect(renderInlineHtml(parseInline(markdownOf('tag inside a code span')))).toBe(
      '<code>&lt;span data-x="1"&gt;hi&lt;/span&gt;</code>',
    );
  });

  it('shows a tag that is not allowed as text, so no handler can run', () => {
    const html = renderInlineHtml(parseInline(markdownOf('event handler')));
    expect(html).not.toContain('<span');
    expect(html).toContain('&lt;span onclick=');
  });
});
