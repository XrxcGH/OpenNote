// Inspecting a PDF: how many pages, how big, the text on each, and what its fonts and drawings are. It also tells
// whether the file has tags, a language, and an outline. Export uses it to check the file the renderer wrote against
// the plan. The golden tests use it to compare the text layer and the page count with what was approved.

import { CMap, readContent, type PageContent, type Resources, type XObject } from './content';
import { PdfName, PdfRef, PdfString, readObjects, type PdfDict, type PdfObject, type PdfValue } from './objects';

export interface PdfPageInfo {
  /** The page size in points. */
  readonly width: number;
  readonly height: number;
  /** The text, in the order it is drawn, with a line feed where it moves to a new line. */
  readonly text: string;
  readonly images: number;
  /** Filled and stroked vector shapes. Handwriting is the fills. */
  readonly fills: number;
  readonly strokes: number;
  /** Marked-content IDs, which tie the page to the structure tree. */
  readonly marked: number;
}

export interface PdfFontInfo {
  readonly name: string;
  readonly type: string;
  readonly embedded: boolean;
}

export interface PdfInfo {
  readonly bytes: number;
  readonly pages: readonly PdfPageInfo[];
  /** True when the catalog says the file is tagged and has a structure tree. */
  readonly tagged: boolean;
  readonly lang: string | null;
  readonly title: string | null;
  /** How many structure elements there are of each type, such as `H1`, `P`, `L`, `LI`, `Table`, and `Figure`. */
  readonly structure: Readonly<Record<string, number>>;
  /** Figures that have a description. */
  readonly figuresWithAlt: number;
  /** The titles of the outline (bookmarks), in order. */
  readonly outline: readonly string[];
  readonly fonts: readonly PdfFontInfo[];
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const isDict = (v: PdfValue | undefined): v is PdfDict =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  !(v instanceof PdfName) &&
  !(v instanceof PdfString) &&
  !(v instanceof PdfRef);

class Pdf {
  private readonly cmaps = new Map<number, CMap | null>();
  private readonly resourceCache = new Map<PdfDict, Resources>();

  constructor(readonly objects: Map<number, PdfObject>) {}

  /** The value a reference points at, or the value itself. */
  get(v: PdfValue | undefined): PdfValue | undefined {
    let value = v;
    for (let i = 0; i < 16 && value instanceof PdfRef; i += 1) value = this.objects.get(value.num)?.value;
    return value;
  }

  dict(v: PdfValue | undefined): PdfDict | undefined {
    const value = this.get(v);
    return isDict(value) ? value : undefined;
  }

  list(v: PdfValue | undefined): PdfValue[] {
    const value = this.get(v);
    return Array.isArray(value) ? [...value] : [];
  }

  name(v: PdfValue | undefined): string | undefined {
    const value = this.get(v);
    return value instanceof PdfName ? value.name : undefined;
  }

  text(v: PdfValue | undefined): string | null {
    const value = this.get(v);
    return value instanceof PdfString ? value.text : null;
  }

  /** The decoded data of a stream object, or null if it has none or uses a filter this reader doesn't know. */
  async stream(v: PdfValue | undefined): Promise<Uint8Array | null> {
    const ref = v instanceof PdfRef ? this.objects.get(v.num) : undefined;
    if (!ref?.stream || !isDict(ref.value)) return null;
    const filters = this.list(ref.value.Filter).length > 0 ? this.list(ref.value.Filter) : [ref.value.Filter];
    let data = ref.stream;
    for (const f of filters) {
      const name = this.name(f);
      if (name === undefined) continue;
      if (name !== 'FlateDecode' && name !== 'Fl') return null;
      data = await inflate(data);
    }
    return data;
  }

  private async cmap(font: PdfDict): Promise<CMap | null> {
    const ref = font.ToUnicode;
    if (!(ref instanceof PdfRef)) return null;
    if (this.cmaps.has(ref.num)) return this.cmaps.get(ref.num) ?? null;
    const data = await this.stream(ref);
    const map = data ? CMap.parse(data) : null;
    this.cmaps.set(ref.num, map);
    return map;
  }

  async resources(raw: PdfValue | undefined, inherited?: Resources): Promise<Resources> {
    const dict = this.dict(raw);
    if (!dict) return inherited ?? { fonts: new Map(), xobjects: new Map() };
    const cached = this.resourceCache.get(dict);
    if (cached) return cached;
    const fonts = new Map<string, CMap | null>();
    for (const [name, ref] of Object.entries(this.dict(dict.Font) ?? {})) {
      const font = this.dict(ref);
      if (font) fonts.set(name, await this.cmap(font));
    }
    const xobjects = new Map<string, XObject>();
    const result: Resources = { fonts, xobjects };
    this.resourceCache.set(dict, result);
    for (const [name, ref] of Object.entries(this.dict(dict.XObject) ?? {})) {
      const x = this.dict(ref);
      const subtype = this.name(x?.Subtype);
      if (subtype === 'Image') xobjects.set(name, { kind: 'image' });
      else if (subtype === 'Form' && x) {
        const content = await this.stream(ref);
        if (content)
          xobjects.set(name, { kind: 'form', content, resources: await this.resources(x.Resources, result) });
      }
    }
    return result;
  }
}

interface PageNode {
  readonly dict: PdfDict;
  readonly inherited: { resources?: PdfValue; mediaBox?: PdfValue };
}

/** The leaves of the page tree, in order, with the attributes they inherit. */
function pageNodes(pdf: Pdf, node: PdfDict, inherited: PageNode['inherited'], out: PageNode[], depth = 0): void {
  const here = {
    resources: node.Resources ?? inherited.resources,
    mediaBox: node.MediaBox ?? inherited.mediaBox,
  };
  if (pdf.name(node.Type) === 'Page' || (node.Kids === undefined && depth > 0))
    out.push({ dict: node, inherited: here });
  else if (depth < 32) {
    for (const kid of pdf.list(node.Kids)) {
      const child = pdf.dict(kid);
      if (child) pageNodes(pdf, child, here, out, depth + 1);
    }
  }
}

async function pageInfo(pdf: Pdf, node: PageNode): Promise<PdfPageInfo> {
  const box = pdf.list(node.inherited.mediaBox).map((n) => Number(pdf.get(n)));
  const resources = await pdf.resources(node.inherited.resources);
  const out: PageContent = { text: '', images: 0, fills: 0, strokes: 0, marked: [] };
  const contents = pdf.get(node.dict.Contents);
  const refs = Array.isArray(contents) ? contents : [node.dict.Contents];
  for (const ref of refs) {
    const data = await pdf.stream(ref);
    if (data) readContent(data, resources, out);
  }
  return {
    width: box.length === 4 ? Math.abs(box[2] - box[0]) : 0,
    height: box.length === 4 ? Math.abs(box[3] - box[1]) : 0,
    text: out.text,
    images: out.images,
    fills: out.fills,
    strokes: out.strokes,
    marked: out.marked.length,
  };
}

function structure(pdf: Pdf, root: PdfDict | undefined): { counts: Record<string, number>; figuresWithAlt: number } {
  const counts: Record<string, number> = {};
  let figuresWithAlt = 0;
  let budget = 200_000;
  const visit = (v: PdfValue | undefined): void => {
    if (budget-- <= 0) return;
    const value = pdf.get(v);
    if (Array.isArray(value)) value.forEach(visit);
    else if (isDict(value)) {
      const tag = pdf.name(value.S);
      if (tag !== undefined) {
        counts[tag] = (counts[tag] ?? 0) + 1;
        if (tag === 'Figure' && (pdf.text(value.Alt) ?? '') !== '') figuresWithAlt += 1;
      }
      visit(value.K);
    }
  };
  visit(root?.K);
  return { counts, figuresWithAlt };
}

function outline(pdf: Pdf, root: PdfDict | undefined): string[] {
  const titles: string[] = [];
  const walk = (first: PdfValue | undefined, depth: number): void => {
    let item = pdf.dict(first);
    for (let n = 0; item && n < 10_000 && depth < 16; n += 1) {
      titles.push(pdf.text(item.Title) ?? '');
      walk(item.First, depth + 1);
      item = pdf.dict(item.Next);
    }
  };
  walk(root?.First, 0);
  return titles;
}

async function fonts(pdf: Pdf): Promise<PdfFontInfo[]> {
  const seen = new Set<string>();
  const out: PdfFontInfo[] = [];
  for (const { value } of pdf.objects.values()) {
    if (!isDict(value) || pdf.name(value.Type) !== 'Font') continue;
    const type = pdf.name(value.Subtype) ?? '';
    // The CID font inside a Type 0 font is part of it, not a font of its own.
    if (type.startsWith('CIDFont')) continue;
    const descendant = pdf.dict(pdf.list(value.DescendantFonts)[0]);
    const descriptor = pdf.dict((descendant ?? value).FontDescriptor);
    const embedded =
      type === 'Type3' ||
      (descriptor !== undefined &&
        ('FontFile' in descriptor || 'FontFile2' in descriptor || 'FontFile3' in descriptor));
    const name = pdf.name(value.BaseFont) ?? '';
    const key = `${name}|${type}|${embedded}`;
    if (type !== '' && !seen.has(key)) {
      seen.add(key);
      out.push({ name, type, embedded });
    }
  }
  return out;
}

/** Reads a PDF file. Throws if the file has no pages. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const pdf = new Pdf(readObjects(bytes));
  const catalog = [...pdf.objects.values()]
    .map((o) => o.value)
    .find((v) => isDict(v) && pdf.name(v.Type) === 'Catalog') as PdfDict | undefined;
  const root = pdf.dict(catalog?.Pages);
  if (!catalog || !root) throw new Error('This file has no page tree.');
  const nodes: PageNode[] = [];
  pageNodes(pdf, root, {}, nodes);
  const pages = [];
  for (const node of nodes) pages.push(await pageInfo(pdf, node));
  const tree = pdf.dict(catalog.StructTreeRoot);
  const { counts, figuresWithAlt } = structure(pdf, tree);
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  const infoRef = /\/Info (\d+) \d+ R/.exec(tail);
  const info = infoRef ? pdf.dict(new PdfRef(Number(infoRef[1]))) : undefined;
  return {
    bytes: bytes.length,
    pages,
    tagged: pdf.dict(catalog.MarkInfo)?.Marked === true && tree !== undefined,
    lang: pdf.text(catalog.Lang),
    title: pdf.text(info?.Title),
    structure: counts,
    figuresWithAlt,
    outline: outline(pdf, pdf.dict(catalog.Outlines)),
    fonts: await fonts(pdf),
  };
}
