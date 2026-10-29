// @vitest-environment jsdom
// The words in markup, read with the HTML parser: hostile tags, comments, and entities come out as plain text.
import { describe, expect, it } from 'vitest';
import { markupText } from './markupText';

describe('markupText', () => {
  it('keeps the words and drops every tag, comment, and script', () => {
    expect(markupText('<p>Hello <b>bold</b> world</p>')).toBe('Hello bold world');
    expect(markupText('a<!-- <b>hidden</b> -->b')).toBe('ab');
    expect(markupText('a<script>alert(1)</script><style>p{}</style>b')).toBe('ab');
    expect(markupText('<template><p>inert</p></template>shown')).toBe('shown');
  });

  it('reads split, nested, and broken tags as a browser does, and runs none of them', () => {
    // What a browser shows for each. Characters such as "<" can be left over, but only ever as text: the result is
    // never parsed again, and no script inside is kept.
    const shown: [string, string][] = [
      ['<scr<script>ipt>alert(1)</script>', 'ipt>alert(1)'],
      ['<<script>script>alert(1)<</script>/script>', '</script>'],
      ['<!<!-- -->-- <script>alert(1)</script> -->', '--  -->'],
      ['<scr<!-- x -->ipt>alert(1)</script>', 'ipt>alert(1)'],
      ['<img src=x onerror=alert(1)//', ''],
      ['<svg><script>alert(1)</script></svg>x', 'x'],
      ['<!-- a --!> b -->c', 'b -->c'],
    ];
    for (const [hostile, text] of shown) expect(markupText(hostile), hostile).toBe(text);
    const box = document.createElement('div');
    box.textContent = markupText('<<script>script>alert(1)<</script>/script>');
    expect(box.children).toHaveLength(0);
  });

  it('decodes entities once, so escaped markup reads as the characters it names', () => {
    expect(markupText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>');
    expect(markupText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    expect(markupText('C:\\Notes\\a.txt &amp; \\textbf{x}')).toBe('C:\\Notes\\a.txt & \\textbf{x}');
  });

  it('breaks lines at <br>, and after blocks when asked', () => {
    expect(markupText('a<br>b<div>c</div>d')).toBe('a\nbcd');
    expect(markupText('a<br>b<div>c</div>d', { lines: true })).toBe('a\nbc\nd');
  });
});
