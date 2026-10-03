// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shape } from '../../../editor/shape';
import excel from './fixtures/excel.html?raw';
import gdocs from './fixtures/gdocs.html?raw';
import onenote from './fixtures/onenote.html?raw';
import vscode from './fixtures/vscode.html?raw';
import web from './fixtures/web.html?raw';
import word from './fixtures/word.html?raw';
import { classifyHtml } from './classify';
import { resolveImages } from './images';
import { sanitizePaste } from './sanitize';
import { MAX_HTML_LENGTH } from './types';
import type { PasteResult } from './types';

function counter(): () => string {
  let n = 0;
  return () => `id${n++}`;
}

const paste = (input: Parameters<typeof sanitizePaste>[0]) => sanitizePaste(input, { newId: counter() });

/** The text pieces as outlines, and the tables as their cells' Markdown. */
function outline(result: PasteResult): string[] {
  return result.pieces.map((piece) => {
    if (piece.kind === 'text') return shape(piece.doc);
    const rows = piece.data.rows.map((row) => piece.data.columns.map((column) => row.cells[column.id].markdown));
    return `table${piece.data.header ? '[header]' : ''}${JSON.stringify(rows)}`;
  });
}

describe('a paste from Word', () => {
  const result = paste({ html: word, text: 'Lab report' });

  it('is told apart by its header and keeps structure and colors, not fonts', () => {
    expect(result.source).toBe('word');
    const [text] = outline(result);
    // Word's heading blue is near the Indigo pen (design, 15.3).
    expect(text).toContain('heading[level=1](textColorindigo("Lab report"))');
    expect(text).toContain(
      'paragraph("Results were ", bold("clearly"), " better, see ", linkhttps://example.com/data("the data"), ".")',
    );
    expect(text).not.toMatch(/Calibri|2F5496|0563C1/);
  });

  it('rebuilds nested bullet and numbered lists from the mso-list levels', () => {
    const [text] = outline(result);
    expect(text).toContain(
      'bulletList(listItem(paragraph("Measure the samples"), bulletList(listItem(paragraph("Weigh each one")), ' +
        'listItem(paragraph("Record the mass in ", bold("grams"))))), listItem(paragraph("Clean up")))',
    );
    expect(text).toContain(
      'orderedList[start=1](listItem(paragraph("First step")), listItem(paragraph("Second step")))',
    );
  });

  it('maps character styles to marks and drops the empty paragraphs Word adds', () => {
    const [text] = outline(result);
    expect(text).toContain(
      'paragraph("H", subscript("2"), "O, x", superscript("2"), ", ", underline("underlined"), ", ", ' +
        'strike("struck"), ", and ", highlight("highlighted"), ".")',
    );
    expect(text).not.toContain('paragraph()');
  });

  it('makes the table its own piece, and asks for the image by its temporary file', () => {
    expect(outline(result)[1]).toBe('table[["**Sample**","**Mass (g)**"],["A1","12.5"]]');
    expect(result.pieces.map((piece) => piece.kind)).toEqual(['text', 'table']);
    expect(result.images).toEqual([
      {
        kind: 'clip',
        src: 'file:///C:/Users/me/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png',
        alt: 'A chart of the masses',
      },
    ]);
  });
});

describe('a paste from OneNote', () => {
  it('turns To Do tag images into checklist items with their state', () => {
    const result = paste({ html: onenote, text: 'Meeting notes' });
    expect(result.source).toBe('onenote');
    expect(outline(result)).toEqual([
      'doc(paragraph(bold("Meeting notes")), bulletList(listItem[checked=false](paragraph("Send the agenda")), ' +
        'listItem[checked=true](paragraph("Book the room"))), paragraph(italic(textColorbrick("Bring")), textColorbrick(" the printouts")), ' +
        'bulletList(listItem(paragraph("Budget review")), listItem(paragraph("Hiring"))))',
    ]);
    expect(result.images).toEqual([]);
  });
});

describe('a paste from Google Docs', () => {
  it('unwraps the wrapper, maps styles to marks, and nests the lists it writes beside their items', () => {
    const result = paste({ html: gdocs, text: 'Project plan' });
    expect(result.source).toBe('gdocs');
    expect(outline(result)).toEqual([
      'doc(heading[level=2]("Project plan"), paragraph("Ship the ", bold("first"), italic(" milestone"), underline(" by Friday")), ' +
        'bulletList(listItem(paragraph("Design"), bulletList(listItem(paragraph("Sketch screens")))), listItem(paragraph("Build"))), ' +
        'paragraph(linkhttps://example.com/plan("the plan")))',
    ]);
  });
});

describe('a paste from a web page', () => {
  const result = paste({ html: web, text: 'How bees find flowers', sourceUrl: 'https://en.example.org/wiki/Bees' });
  const pieces = outline(result);

  it('keeps structure and links, and resolves relative addresses against the page', () => {
    expect(result.source).toBe('web');
    expect(pieces[0]).toContain('heading[level=2]("How bees find flowers")');
    expect(pieces[0]).toContain('linkhttps://en.example.org/wiki/Pollination("pollination")');
    expect(pieces[0]).toContain('bulletList(listItem(paragraph("Scent")), listItem(paragraph("Color"), bulletList(');
    expect(pieces[0]).toContain('blockquote(paragraph("Nature is not a place to visit."))');
    expect(pieces[0]).toContain('codeBlock[language=python]("for bee in hive:\\n    bee.fly()")');
  });

  it('drops colors, fonts, highlights, page chrome, hidden text, scripts, and unsafe links', () => {
    const all = pieces.join('\n');
    expect(all).not.toMatch(/Georgia|rgb|nav|Home|hidden|Share|alert|pixel|javascript|highlight/);
    expect(all).toContain('", or this.")');
  });

  it('asks for the image at its address and leaves the tracking pixel out', () => {
    expect(result.images).toEqual([
      { kind: 'remote', src: 'https://en.example.org/images/bee.jpg', alt: 'A bee on a flower' },
    ]);
  });

  it('keeps a header row and the text around a table in order', () => {
    expect(result.pieces.map((piece) => piece.kind)).toEqual(['text', 'table', 'text']);
    expect(pieces[1]).toBe('table[header][["Bee","Trips"],["Worker","12"]]');
    expect(pieces[2]).toBe('doc(paragraph("Text with a", hardBreak, "line break and a mark."))');
  });
});

describe('other sources', () => {
  it('pastes an Excel range as a table with no header', () => {
    const result = paste({ html: excel, text: 'Item\tQty\tPrice' });
    expect(result.source).toBe('excel');
    expect(outline(result)).toEqual(['table[["Item","Qty","Price"],["Pens","12","1.5"],["Paper","3","4.25"]]']);
  });

  it('pastes several lines from a code editor as a code block, and one line as inline code', () => {
    const many = paste({ html: vscode, text: 'const total = 3;\nconsole.log(total);' });
    expect(many.source).toBe('vscode');
    expect(outline(many)).toEqual(['doc(codeBlock("const total = 3;\\nconsole.log(total);"))']);
    const one = paste({ html: vscode, text: 'const total = 3;' });
    expect(outline(one)).toEqual(['doc(paragraph(code("const total = 3;")))']);
  });

  it('reads a web task list, where a checkbox starts each item', () => {
    const html =
      '<ul class="contains-task-list"><li><input type="checkbox" disabled> open</li>' +
      '<li><input type="checkbox" checked disabled> done</li></ul>';
    expect(outline(paste({ html }))).toEqual([
      'doc(bulletList(listItem[checked=false](paragraph("open")), listItem[checked=true](paragraph("done"))))',
    ]);
  });

  it('tells sources apart', () => {
    expect(classifyHtml('<p>hello</p>')).toBe('web');
    expect(classifyHtml('<p class=MsoNormal>hello</p>')).toBe('word');
  });
});

describe('pasted HTML is never trusted', () => {
  const hostile =
    '<p onclick="alert(1)">Hello <a href="javascript:alert(1)">click</a> <a href="data:text/html,x">data</a> ' +
    '<a href="ftp://files.example.com/a">ftp</a></p><script>alert(2)</script>' +
    '<img src="file:///C:/secret.png" alt="a secret"> <img src="x.png" alt="relative"><iframe src="https://evil.example"></iframe>' +
    '<style>p { margin: 0 }</style><p style="text-decoration: underline">Styled</p>';

  it('keeps text and inert links only, and never asks for a file it should not read', () => {
    const result = paste({ html: hostile, text: 'Hello' });
    expect(outline(result)).toEqual([
      'doc(paragraph("Hello click data ", linkftp://files.example.com/a("ftp")), paragraph("a secret relative"), paragraph("Styled"))',
    ]);
    expect(result.images).toEqual([]);
  });

  it('strips the CF_HTML header that Windows puts before the markup', () => {
    const header =
      'Version:0.9\r\nStartHTML:0000000105\r\nEndHTML:0000000200\r\nStartFragment:0000000139\r\nEndFragment:0000000164\r\n';
    const result = paste({
      html: `${header}<html><body><!--StartFragment--><p>Hi <b>there</b></p><!--EndFragment--></body></html>`,
    });
    expect(outline(result)).toEqual(['doc(paragraph("Hi ", bold("there")))']);
  });

  it('falls back to plain text when the HTML is too large to keep', () => {
    const result = paste({ html: `<p>${'a'.repeat(MAX_HTML_LENGTH)}</p>`, text: 'Plain words' });
    expect(result.plainFallback).toBe(true);
    expect(outline(result)).toEqual(['doc(paragraph("Plain words"))']);
  });
});

describe('resolving images', () => {
  const doc = paste({
    html: '<p>See <img src="https://example.com/a.png" alt="the chart"> and <img src="data:image/png;base64,AAAA" alt=""></p>',
  });
  const text = doc.pieces[0].kind === 'text' ? doc.pieces[0].doc : null;

  it('swaps each source for its asset', () => {
    expect(doc.images.map((image) => image.kind)).toEqual(['remote', 'data']);
    const resolved = resolveImages(text as NonNullable<typeof text>, (request) => `asset:${request.kind}`);
    expect(shape(resolved)).toBe(
      'doc(paragraph("See ", image[src=asset:remote,alt=the chart], " and ", image[src=asset:data]))',
    );
  });

  it('links a web image that could not be saved, and keeps the words of one that was embedded', () => {
    const resolved = resolveImages(text as NonNullable<typeof text>, () => null);
    expect(shape(resolved)).toBe('doc(paragraph("See ", linkhttps://example.com/a.png("the chart"), " and "))');
  });
});
