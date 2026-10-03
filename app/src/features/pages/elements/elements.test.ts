import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../pagination/geometry';
import { selectArea } from '../selection/select';
import { pageOf, textBlock } from '../testing/build';
import { waveStroke } from '../testing/samples';
import { elementPage, elementSvg, fitScale, insertElement, makeElement, type ElementData } from './element';
import { readElementFile, writeElementFile } from './file';
import {
  EMPTY_LIBRARY,
  addElement,
  allFolders,
  cleanName,
  createFolder,
  listFolder,
  moveElement,
  moveFolder,
  removeElement,
  removeFolder,
  renameElement,
  renameFolder,
  searchElements,
  uniqueName,
  type ElementEntry,
  type ElementLibrary,
} from './library';

const square = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function sample() {
  const page = pageOf(
    [
      textBlock('Time (s)', { x: 200, y: 330, w: 80, h: 24 }, 'label'),
      { id: 'pic', type: 'image', data: { asset: 'a1', alt: 'A leaf' }, frame: { x: 300, y: 100, w: 120, h: 80 } },
      {
        id: 'tab',
        type: 'table',
        data: {
          header: true,
          columns: [{ id: 'c1', width: 100 }],
          rows: [{ id: 'r1', cells: { c1: { markdown: 'x' } } }],
        },
        frame: { x: 100, y: 200, w: 100 },
      },
      { id: 'att', type: 'file', data: { asset: 'a2', alt: '' }, frame: { x: 120, y: 230, w: 40, h: 40 } },
      { id: 'ink', type: 'ink', data: { role: 'layer', strokeCount: 1 }, frame: { x: 0, y: 0 } },
    ],
    {
      strokes: [{ ...waveStroke('ink', 110, 300, 200), id: 's1' }],
      assets: {
        a1: { file: 'leaf.png', mime: 'image/png', name: 'leaf.png', width: 120, height: 80 },
        a2: { file: 'doc.pdf', mime: 'application/pdf', name: 'doc.pdf' },
      },
    },
  );
  const boxes = new Map<string, Rect>();
  const selection = selectArea(page, square(90, 90, 400, 280), { boxes, padding: 30 })!;
  return { page, selection, boxes };
}

const made = () => {
  const { page, selection, boxes } = sample();
  return {
    page,
    selection,
    ...makeElement(page, selection, {
      boxes,
      assetData: (a) => (a.id === 'a1' ? 'iVBORw0KGgo=' : null),
      alt: 'A labeled axis',
    }),
  };
};

describe('making an element', () => {
  it('is as large as the content, with positions from its top-left corner', () => {
    const { element, selection } = made();
    expect(element.width).toBeCloseTo(selection.bounds.w, 1);
    expect(element.height).toBeCloseTo(selection.bounds.h, 1);
    const label = element.blocks.find((b) => b.type === 'text')!;
    expect(label.frame.x).toBeCloseTo(200 - selection.bounds.x, 1);
    expect(label.frame.y).toBeCloseTo(330 - selection.bounds.y, 1);
    expect(element.strokes).toHaveLength(1);
    expect(element.alt).toBe('A labeled axis');
  });

  it('carries the bytes of its images, and counts what it cannot take', () => {
    const { element, skipped } = made();
    expect(Object.keys(element.assets)).toEqual(['a1']);
    expect(element.assets.a1).toMatchObject({ mime: 'image/png', data: 'iVBORw0KGgo=', width: 120 });
    expect(element.blocks.map((b) => b.type).sort()).toEqual(['image', 'table', 'text']);
    expect(skipped).toBe(1);
  });

  it('leaves out an image whose bytes are not at hand', () => {
    const { page, selection, boxes } = sample();
    const { element, skipped } = makeElement(page, selection, { boxes, assetData: () => null });
    expect(element.blocks.some((b) => b.type === 'image')).toBe(false);
    expect(skipped).toBe(2);
  });
});

describe('putting an element on a page', () => {
  let n = 0;
  const ids = (kind: string) => `${kind}-${(n += 1)}`;

  it('fits to a space without enlarging, unless asked', () => {
    const { element } = made();
    expect(fitScale(element, { w: element.width / 2, h: 10_000 })).toBeCloseTo(0.5, 3);
    expect(fitScale(element, { w: 10_000, h: 10_000 })).toBe(1);
    expect(fitScale(element, { w: element.width * 2, h: 10_000 }, true)).toBeCloseTo(2, 3);
    expect(fitScale({ ...element, width: 0 }, { w: 5, h: 5 })).toBe(1);
  });

  it('places blocks and strokes at the point with new IDs, scaled', () => {
    const { element } = made();
    const out = insertElement(element, { at: { x: 1000, y: 500 }, scale: 0.5, inkBlock: 'ink-new', ids, start: 1_000 });
    const label = out.blocks.find((b) => b.type === 'text')!;
    const source = element.blocks.find((b) => b.type === 'text')!;
    expect(label.frame!.x).toBeCloseTo(1000 + source.frame.x! * 0.5, 1);
    expect(label.frame!.w).toBeCloseTo(source.frame.w! * 0.5, 1);
    const table = out.blocks.find((b) => b.type === 'table')!;
    expect(table.type === 'table' && table.columns[0].width).toBe(50);
    expect(out.strokes[0]).toMatchObject({ block: 'ink-new', start: 1_000, transform: null });
    expect(out.strokes[0].width).toBeCloseTo(element.strokes[0].width * 0.5, 1);
    expect(out.strokes[0].x[0]).toBeCloseTo(1000 + element.strokes[0].x[0] * 0.5, 1);
    const image = out.blocks.find((b) => b.type === 'image')!;
    expect(image.type === 'image' && image.asset).toBe(out.assets[0].id);
    expect(new Set([...out.blocks.map((b) => b.id), ...out.strokes.map((s) => s.id), out.assets[0].id]).size).toBe(
      out.blocks.length + out.strokes.length + 1,
    );
  });

  it('puts the content back where it was when inserted at the original corner at actual size', () => {
    const { element, page, selection } = made();
    const out = insertElement(element, {
      at: { x: selection.bounds.x, y: selection.bounds.y },
      inkBlock: 'ink',
      ids,
      start: 0,
    });
    const original = page.strokes[0];
    out.strokes[0].x.forEach((x, i) => expect(x).toBeCloseTo(original.x[i], 1));
    out.strokes[0].y.forEach((y, i) => expect(y).toBeCloseTo(original.y[i], 1));
    const label = out.blocks.find((b) => b.type === 'text')!;
    expect(label.frame).toMatchObject({ x: 200, y: 330 });
  });

  it('draws as a picture with the library asset URLs, and as a one-sheet page', () => {
    const { element } = made();
    const seen: string[] = [];
    const svg = elementSvg(element, {
      assetUrl: (id) => {
        seen.push(id);
        return 'data:image/png;base64,AAAA';
      },
    });
    expect(seen).toEqual(['a1']);
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"');
    expect(svg).toContain('Time (s)');
    expect(svg).toContain('<path d="M');
    expect(svg).toContain(`viewBox="0 0 ${element.width} ${element.height}"`);
    const page = elementPage(element);
    expect(page.view.paper.width).toBe(element.width);
    expect(page.strokes).toHaveLength(1);
  });
});

const entry = (id: string, name: string, folder = ''): ElementEntry => ({
  id,
  name,
  folder,
  created: '2026-10-01T10:00:00.000Z',
  element: { width: 10, height: 10, blocks: [], strokes: [], assets: {} },
});

function library(): ElementLibrary {
  let lib = EMPTY_LIBRARY;
  for (const e of [
    entry('1', 'Labeled x axis', 'Graphs'),
    entry('2', 'Signature'),
    entry('3', 'Flowchart: decision', 'Diagrams/Flow'),
    entry('4', 'Header banner', 'Pages'),
    entry('5', 'Résumé header', 'Pages'),
  ]) {
    lib = addElement(lib, e).library;
  }
  return lib;
}

describe('the library', () => {
  it('lists the folders above a folder that holds an element, even when none was created', () => {
    expect(allFolders(library())).toEqual(['Diagrams', 'Diagrams/Flow', 'Graphs', 'Pages']);
  });

  it('lists a folder with its subfolders first by name and its elements by name, ignoring case and accents', () => {
    const lib = library();
    expect(listFolder(lib, '')).toMatchObject({ folders: ['Diagrams', 'Graphs', 'Pages'] });
    expect(listFolder(lib, '').entries.map((e) => e.name)).toEqual(['Signature']);
    expect(listFolder(lib, 'Pages').entries.map((e) => e.name)).toEqual(['Header banner', 'Résumé header']);
    expect(listFolder(lib, 'Diagrams').folders).toEqual(['Diagrams/Flow']);
  });

  it('gives a new element a name no sibling has', () => {
    let lib = library();
    lib = addElement(lib, entry('6', 'Signature')).library;
    lib = addElement(lib, entry('7', '  signature ')).library;
    expect(lib.entries.filter((e) => e.folder === '').map((e) => e.name)).toEqual([
      'Signature',
      'Signature 2',
      'signature 3',
    ]);
    expect(uniqueName(lib, '', 'Pen')).toBe('Pen');
  });

  it('renames, moves, and removes elements', () => {
    let lib = library();
    lib = renameElement(lib, '2', '  My   signature ').library;
    expect(lib.entries.find((e) => e.id === '2')!.name).toBe('My signature');
    lib = moveElement(lib, '2', 'Pages').library;
    expect(lib.entries.find((e) => e.id === '2')!.folder).toBe('Pages');
    lib = removeElement(lib, '2').library;
    expect(lib.entries.some((e) => e.id === '2')).toBe(false);
    expect(removeElement(lib, 'nope').error).toBe('missing');
    expect(moveElement(lib, '1', 'Nowhere').error).toBe('missing');
    expect(renameElement(lib, '1', '   ').error).toBe('badName');
  });

  it('creates, renames, moves, and removes folders with what is inside them', () => {
    let lib = library();
    expect(createFolder(lib, '', 'Graphs').error).toBe('exists');
    expect(createFolder(lib, '', 'graphs').error).toBe('exists');
    expect(createFolder(lib, '', 'a/b').library.folders).toContain('a b');
    expect(createFolder(lib, 'Nowhere', 'x').error).toBe('missing');
    lib = renameFolder(lib, 'Diagrams', 'Charts').library;
    expect(allFolders(lib)).toContain('Charts/Flow');
    expect(lib.entries.find((e) => e.id === '3')!.folder).toBe('Charts/Flow');
    lib = moveFolder(lib, 'Charts', 'Pages').library;
    expect(lib.entries.find((e) => e.id === '3')!.folder).toBe('Pages/Charts/Flow');
    expect(moveFolder(lib, 'Pages', 'Pages/Charts').error).toBe('intoSelf');
    const kept = removeFolder(lib, 'Pages/Charts', 'keep').library;
    expect(kept.entries.find((e) => e.id === '3')!.folder).toBe('Pages/Flow');
    expect(removeFolder(lib, 'Pages', 'keep').library.entries.find((e) => e.id === '4')!.folder).toBe('');
    const gone = removeFolder(lib, 'Pages', 'delete').library;
    expect(gone.entries.map((e) => e.id)).toEqual(['1', '2']);
    expect(allFolders(gone)).toEqual(['Graphs']);
  });

  it('cleans a name of control characters and extra space, and cuts it at 80 characters', () => {
    expect(cleanName('a\u0007b\n  c')).toBe('a b c');
    expect(cleanName('\u0000 ')).toBeNull();
    expect(Array.from(cleanName('x'.repeat(200))!)).toHaveLength(80);
  });

  it('limits how deep folders go', () => {
    let lib = EMPTY_LIBRARY;
    let path = '';
    for (let i = 0; i < 6; i += 1) {
      lib = createFolder(lib, path, `d${i}`).library;
      path = path === '' ? `d${i}` : `${path}/d${i}`;
    }
    expect(createFolder(lib, path, 'one more').error).toBe('tooDeep');
  });

  it('searches by name, best match first, without regard to case or accents', () => {
    const lib = library();
    expect(searchElements(lib, 'header').map((e) => e.name)).toEqual(['Header banner', 'Résumé header']);
    expect(searchElements(lib, 'resume').map((e) => e.name)).toEqual(['Résumé header']);
    expect(searchElements(lib, 'AXIS').map((e) => e.name)).toEqual(['Labeled x axis']);
    expect(searchElements(lib, 'flow dec').map((e) => e.name)).toEqual(['Flowchart: decision']);
    expect(searchElements(lib, 'diagrams').map((e) => e.name)).toEqual(['Flowchart: decision']);
    expect(searchElements(lib, 'zebra')).toEqual([]);
    expect(searchElements(lib, '  ')).toEqual([]);
  });
});

describe('the element file', () => {
  const element: ElementData = made().element;

  it('reads back what it wrote', () => {
    const read = readElementFile(writeElementFile('Labeled axis', element));
    expect(read).toMatchObject({ ok: true, name: 'Labeled axis', warnings: [] });
    expect(read.ok && read.element).toEqual(element);
  });

  it('refuses what is not an element, not JSON, newer, or too large', () => {
    expect(readElementFile('{')).toEqual({ ok: false, error: 'notJson' });
    expect(readElementFile('{"format":"other"}')).toEqual({ ok: false, error: 'notElement' });
    expect(readElementFile('[]')).toEqual({ ok: false, error: 'notElement' });
    const newer = JSON.stringify({ format: 'opennote-element', version: 2, name: 'x', element: {} });
    expect(readElementFile(newer)).toEqual({ ok: false, error: 'newer' });
    expect(readElementFile('x'.repeat(40_000_001))).toEqual({ ok: false, error: 'tooBig' });
    expect(readElementFile('{"format":"opennote-element","version":1,"name":"x","element":{"width":-1}}')).toEqual({
      ok: false,
      error: 'invalid',
    });
  });

  const wrap = (change: (e: Record<string, unknown>) => void): string => {
    const copy = JSON.parse(JSON.stringify({ format: 'opennote-element', version: 1, name: 'x', element }));
    change(copy.element);
    return JSON.stringify(copy);
  };

  it('drops a stroke or block it cannot use and says which', () => {
    const read = readElementFile(
      wrap((e) => {
        (e.strokes as unknown[]).push({ tool: 0, color: [0, 0, 0, 255], width: 2, x: [1, 2], y: [1] });
        (e.blocks as unknown[]).push({ type: 'text', markdown: 5, frame: { x: 0, y: 0 } });
        (e.blocks as unknown[]).push({ type: 'script', frame: { x: 0, y: 0 } });
      }),
    );
    expect(read.ok && read.warnings).toEqual([
      { kind: 'blockDropped', index: 3 },
      { kind: 'blockDropped', index: 4 },
      { kind: 'strokeDropped', index: 1 },
    ]);
    expect(read.ok && read.element.strokes).toHaveLength(1);
  });

  it('refuses images that are not raster pictures, and drops the blocks that use them', () => {
    const read = readElementFile(
      wrap((e) => {
        (e.assets as Record<string, { mime: string }>).a1.mime = 'image/svg+xml';
      }),
    );
    expect(read.ok && read.warnings.map((w) => w.kind)).toEqual(['assetDropped', 'blockDropped']);
    expect(read.ok && read.element.blocks.some((b) => b.type === 'image')).toBe(false);
    const bad = readElementFile(
      wrap((e) => {
        (e.assets as Record<string, { data: string }>).a1.data = 'not base64!';
      }),
    );
    expect(bad.ok && bad.warnings[0].kind).toBe('assetDropped');
  });

  it('never throws, whatever the file holds', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const result = readElementFile(JSON.stringify(value));
        expect(typeof result.ok).toBe('boolean');
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(fc.jsonValue(), (inner) => {
        const text = JSON.stringify({ format: 'opennote-element', version: 1, name: 'n', element: inner });
        expect(typeof readElementFile(text).ok).toBe('boolean');
      }),
      { numRuns: 300 },
    );
  });
});
