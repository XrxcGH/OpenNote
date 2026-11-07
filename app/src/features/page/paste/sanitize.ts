// The paste pipeline's pure core (Phase 4 design, 15.1): classify, normalize the HTML of the source, split out tables,
// name the images, and parse the rest with the editor schema, whose parse rules are the allowlist. Nothing here
// reads the clipboard, loads an image, or touches the page.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { newId as makeId } from '../../../editor/ids';
import { textSchema } from '../../../editor/schema/schema';
import type { PasteInput as RegistryInput } from '../registries';
import { PARA_DATA } from '../../../editor/clipboard/paraData';
import { parseHtml } from './dom';
import { collectImageRequests, dropUnknownImages } from './images';
import { keepSourceFormatting } from './normalize/keep';
import { dropUnwanted } from './normalize/common';
import { webHygiene } from './normalize/web';
import { codePieces, codeText } from './normalize/vscode';
import { pasteParser } from './paraRules';
import { choiceFor, isOpenNoteCopy, mergeOpenNote, OPENNOTE_SOURCE } from './options';
import { joinBrokenLines } from './pdf';
import { detectSource } from './sources';
import { looksLikeMarkdown, parsePastedMarkdown, plainTextPieces } from '../../../editor/markdown/paste';
import { extractTables, tabTableData, tableMarker } from './tables';
import { tidyDoc } from './tidy';
import { MAX_HTML_LENGTH } from './types';
import type { ImageRequest, PasteChoice, PasteInput, PasteOptions, PasteResult, PastedPiece, TableData } from './types';

const { nodes } = textSchema;

/** Splits a parsed document at the marker paragraphs that stand for tables. */
function splitPieces(doc: PMNode, tables: readonly TableData[]): PastedPiece[] {
  const pieces: PastedPiece[] = [];
  let run: PMNode[] = [];
  const flush = () => {
    const tidy = run.length === 0 ? null : tidyDoc(nodes.doc.create(null, Fragment.from(run)));
    if (tidy) pieces.push({ kind: 'text', doc: tidy });
    run = [];
  };
  doc.forEach((block) => {
    const index = tableMarker(block);
    if (index === null) run.push(block);
    else {
      flush();
      pieces.push({ kind: 'table', data: tables[index] });
    }
  });
  flush();
  return pieces;
}

/** The input as the paste source registry reads it. A source address given on its own joins the facts. */
export function registryInput(input: PasteInput): RegistryInput {
  const base = input.facts ?? null;
  const sourceUrl = input.sourceUrl ?? base?.sourceUrl ?? null;
  const facts =
    base || sourceUrl ? { sequence: 0, textSha256: null, hasOneNote: false, wordImages: [], ...base, sourceUrl } : null;
  return {
    html: input.html ?? null,
    text: input.text ?? null,
    files: input.files ?? [],
    facts,
    target: input.target ?? 'text',
  };
}

function imagesOf(pieces: readonly PastedPiece[]): ImageRequest[] {
  const found = new Map<string, ImageRequest>();
  for (const piece of pieces) {
    if (piece.kind === 'text') collectImageRequests(piece.doc).forEach((request) => found.set(request.src, request));
  }
  return [...found.values()];
}

/** Text only: the text of the paste, one paragraph for each line. */
function textOnly(input: PasteInput, body: HTMLElement, source: string): PasteResult {
  const text = input.text ?? body.innerText ?? body.textContent ?? '';
  return {
    source,
    pieces: plainTextPieces(text),
    images: [],
    plainFallback: false,
    joinedText: null,
    choice: 'textOnly',
  };
}

const KEEPS = new Set(['word', 'gdocs', 'onenote', 'web']);

function fromHtml(html: string, input: PasteInput, newId: () => string, options: PasteOptions): PasteResult | null {
  const doc = parseHtml(html);
  const body = doc.body;
  const forRegistry = { ...registryInput(input), html };
  const own = !!options.fidelity && isOpenNoteCopy(body);
  const def = own ? null : detectSource(forRegistry, doc);
  const source = own ? OPENNOTE_SOURCE : (def?.id ?? 'web');
  if (source === 'vscode') {
    const pieces = codePieces(input.text ?? codeText(body));
    return pieces.length === 0
      ? null
      : { source, pieces, images: [], plainFallback: false, joinedText: null, choice: null };
  }
  const choice: PasteChoice = options.fidelity
    ? (options.mode ?? choiceFor(source, options.defaults))
    : 'mergeFormatting';
  if (choice === 'textOnly') return textOnly(input, body, source);
  // Paragraph formatting never comes from the HTML itself, except OpenNote's own copy.
  if (!own) body.querySelectorAll(`[${PARA_DATA}]`).forEach((element) => element.removeAttribute(PARA_DATA));
  if (choice === 'keepSource' && KEEPS.has(source)) keepSourceFormatting(body);
  if (own) {
    dropUnwanted(body);
    webHygiene(body, forRegistry);
    if (choice === 'mergeFormatting') mergeOpenNote(body);
  } else def?.normalize(doc, forRegistry);
  dropUnknownImages(body);
  const tables = extractTables(body, newId);
  const pieces = splitPieces(pasteParser().parse(body), tables);
  if (pieces.length === 0) return null;
  return { source, pieces, images: imagesOf(pieces), plainFallback: false, joinedText: null, choice };
}

function fromText(text: string, newId: () => string, plainFallback: boolean): PasteResult {
  const grid = tabTableData(text, newId);
  if (grid) {
    return {
      source: 'plain',
      pieces: [{ kind: 'table', data: grid }],
      images: [],
      plainFallback,
      joinedText: null,
      choice: null,
    };
  }
  const markdown = looksLikeMarkdown(text);
  const pieces = markdown ? parsePastedMarkdown(text, newId) : plainTextPieces(text);
  const joinedText = markdown ? null : joinBrokenLines(text);
  return {
    source: markdown ? 'markdown' : 'plain',
    pieces,
    images: imagesOf(pieces),
    plainFallback,
    joinedText,
    choice: null,
  };
}

/**
 * The pieces for one paste. HTML is parsed into an inert document and read through the schema, so only what the
 * schema allows survives. Plain text is read as Markdown when it looks like it, or else as one paragraph for each
 * line. HTML over 5 MB falls back to its plain text.
 */
export function sanitizePaste(input: PasteInput, options: PasteOptions = {}): PasteResult {
  const newId = options.newId ?? (() => makeId());
  if (options.plain) {
    return {
      source: 'plain',
      pieces: plainTextPieces(input.text ?? ''),
      images: [],
      plainFallback: false,
      joinedText: null,
      choice: null,
    };
  }
  const html = input.html?.trim() ? input.html : null;
  const tooLarge = html !== null && html.length > MAX_HTML_LENGTH;
  if (html !== null && !tooLarge) {
    const result = fromHtml(html, input, newId, options);
    if (result) return result;
  }
  return fromText(input.text ?? '', newId, tooLarge);
}
