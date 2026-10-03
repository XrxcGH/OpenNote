// Helpers for the tests that print pages in a browser: running an export, and reading the printed sheets back from the
// document the PDF was made from.

import type { Browser } from '@playwright/test';
import type { ExportPage } from '../export/source';
import { exportPdf, type PdfExportResult } from '../pdf/job';
import type { PrintOptions } from '../print/sheets';
import { bundledFontFaces, edgeSurface, type EdgeSurface } from './edgeSurface';

let faces: string | undefined;

export interface Run {
  readonly result: PdfExportResult;
  readonly sheets: readonly SheetDom[];
}

/** What a printed sheet holds, read from the DOM that the PDF was printed from. */
export interface SheetDom {
  /** The visible text of the sheet, with runs of white space as one space. */
  readonly text: string;
  readonly slices: readonly {
    readonly top: number;
    readonly bottom: number;
    readonly tag: string;
    readonly last: string;
  }[];
}

export async function readSheets(surface: EdgeSurface): Promise<SheetDom[]> {
  return surface.page.evaluate(() => {
    /** The vertical extent of what a slice shows: its text, pictures, and rules, not the margins around them. */
    const shown = (el: Element, origin: DOMRect): { top: number; bottom: number } | null => {
      let top = Infinity;
      let bottom = -Infinity;
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ((n as Text).data.trim() === '') continue;
        range.selectNodeContents(n);
        for (const r of Array.from(range.getClientRects())) {
          top = Math.min(top, r.top);
          bottom = Math.max(bottom, r.bottom);
        }
      }
      for (const e of Array.from(el.querySelectorAll('img,svg,hr,.box'))) {
        const r = e.getBoundingClientRect();
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
      }
      return top === Infinity ? null : { top: top - origin.top, bottom: bottom - origin.top };
    };
    return Array.from(document.querySelectorAll<HTMLElement>('section.sheet'), (sheet) => {
      const box = sheet.getBoundingClientRect();
      const slices = Array.from(sheet.querySelectorAll<HTMLElement>(':scope > .slice'), (el) => {
        const r = el.getBoundingClientRect();
        const content = shown(el, box);
        return {
          top: content?.top ?? r.top - box.top,
          bottom: content?.bottom ?? r.bottom - box.top,
          tag: el.firstElementChild?.tagName ?? '',
          last: el.lastElementChild?.tagName ?? '',
        };
      });
      return { text: sheet.innerText.replace(/\s+/g, ' ').trim(), slices };
    });
  });
}

/** Prints a page to PDF in the browser, keeps the surface open long enough to read the sheets, and closes it. */
export async function printPage(
  browser: Browser,
  page: ExportPage,
  print: PrintOptions = {},
  assetUrls: Record<string, string> = {},
  request: { tagged?: boolean; outline?: boolean } = {},
): Promise<Run> {
  faces ??= bundledFontFaces();
  const surface = await edgeSurface(browser, faces);
  let sheets: SheetDom[] = [];
  const inner = {
    ...surface,
    async toPdf(options: Parameters<EdgeSurface['toPdf']>[0]) {
      sheets = await readSheets(surface);
      return surface.toPdf(options);
    },
  };
  const result = await exportPdf(inner, { input: { page, assetUrls, print }, ...request });
  return { result, sheets };
}

/** The letters of some text, sorted and without spaces: two texts with the same ones say the same thing. */
export function letters(text: string): string[] {
  return Array.from(text.normalize('NFC').replace(/\s+/g, '')).sort();
}

/** Words of some text, lowercased and with punctuation separated, so two texts compare by what they say. */
export function words(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '');
}
