// The web platform's page export: a stand-in for the desktop app's hidden print window and Save dialog, so the
// interface runs in a plain browser and in Playwright. The planning is real (a hidden frame runs the same
// `preparePrint` the desktop's print window runs), but the PDF is a stand-in file with the planned pages and sizes, and
// nothing is written to disk. Tests read what was "saved" through the exportsSaved hook.
import type { ExportsClient } from '../types';
import { registerTestHook } from './testHooks';

interface Planned {
  readonly frame: HTMLIFrameElement;
  readonly sheets: number;
  readonly width: number;
  readonly height: number;
}

export interface SavedExport {
  readonly path: string;
  readonly files: readonly { readonly path: string; readonly length: number; readonly text: string }[];
}

const POINTS = 0.75;

/** A PDF with `count` blank pages of the given size in points. */
export function standInPdf(count: number, width: number, height: number): Uint8Array {
  const pages = Array.from({ length: count }, (_, i) => 3 + i);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((n) => `${n} 0 R`).join(' ')}] /Count ${count} >>`,
    ...pages.map(() => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] >>`),
  ];
  const body = objects.map((object, i) => `${i + 1} 0 obj\n${object}\nendobj\n`).join('');
  return new TextEncoder().encode(`%PDF-1.4\n${body}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\n%%EOF\n`);
}

export function createWebExports(): ExportsClient {
  const planned = new Map<string, Planned>();
  const saved: SavedExport[] = [];
  const opened: { path: string; reveal: boolean }[] = [];
  const state = { cancelNext: false, failNext: false };
  registerTestHook('exportsSaved', () => saved);
  registerTestHook('exportsOpened', () => opened);
  registerTestHook('exportsCancelNext', () => void (state.cancelNext = true));
  registerTestHook('exportsFailNext', () => void (state.failNext = true));

  const close = (job: string) => {
    planned.get(job)?.frame.remove();
    planned.delete(job);
  };

  return {
    async printPrepare(job, input) {
      close(job);
      if (state.failNext) {
        state.failNext = false;
        throw { code: 'internal', message: 'The print window failed.' };
      }
      const { preparePrint, showDocument } = await import('../../features/pages');
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:960px;border:0';
      document.body.append(frame);
      const doc = frame.contentDocument as Document;
      const result = await preparePrint(doc, input as Parameters<typeof preparePrint>[1]);
      await showDocument(doc, result.html);
      planned.set(job, {
        frame,
        sheets: result.plan.sheets.length,
        width: result.plan.box.width * POINTS,
        height: result.plan.box.height * POINTS,
      });
      return { ...result, html: '' };
    },
    async printRender(job) {
      const plan = planned.get(job);
      if (!plan) throw { code: 'notFound', message: 'The print window is not open.' };
      return standInPdf(plan.sheets, plan.width, plan.height);
    },
    async printClose(job) {
      close(job);
    },
    async selectionDocx(png) {
      // A stand-in: a zip signature and the picture's size, which is enough for the interface's own checks.
      return new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...png.subarray(0, 8)]);
    },
    async pickSave({ suggested }) {
      if (state.cancelNext) {
        state.cancelNext = false;
        return null;
      }
      return ['C:', 'Users', 'Test', 'Documents', suggested].join('\\');
    },
    async write(path, files) {
      const decoder = new TextDecoder();
      saved.push({
        path,
        files: files.map((file) => ({
          path: file.path,
          length: file.bytes.length,
          text: file.bytes.length < 2_000_000 ? decoder.decode(file.bytes) : '',
        })),
      });
    },
    async open(path, reveal) {
      opened.push({ path, reveal });
    },
  };
}
