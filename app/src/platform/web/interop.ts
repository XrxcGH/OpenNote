// Import and export as an in-memory fake: it classifies a path by its name, makes up a dry run and a notebook,
// and reports progress on a timer. Playwright drives it with the hooks below (what the pickers answer, how slow
// a step is, and what the app asked for).

import type {
  DetectedSource,
  ExportRequest,
  ExportResult,
  ImportPreview,
  ImportResult,
  ImportedTree,
  InteropClient,
  JobEvent,
  JobOutcome,
  LossGroup,
  PickKind,
} from '../interop';
import { registerTestHook } from './testHooks';

const STEPS = 6;

const EVERNOTE_LOSSES: LossGroup[] = [
  {
    outcome: 'skipped',
    why: 'Reminders have no place in OpenNote yet.',
    examples: ['2 reminders'],
    pages: 2,
  },
  {
    outcome: 'simplified',
    why: 'Text colors outside the pens became the nearest pen.',
    examples: ['5 colored words'],
    pages: 3,
  },
];

function detectPath(path: string): DetectedSource {
  const lower = path.toLowerCase();
  const found = (kind: DetectedSource['kind'], label: string): DetectedSource => ({
    kind,
    label,
    supported: true,
    zipped: false,
    advice: null,
  });
  if (lower.endsWith('.enex')) return found('evernote', 'Evernote export');
  if (lower.endsWith('.docx')) return found('word', 'Word and OpenDocument documents');
  if (lower.endsWith('.txt')) return found('text', 'Text files');
  if (lower.endsWith('.one') || lower.endsWith('.onepkg')) {
    return {
      kind: 'oneNoteFile',
      label: 'OneNote file',
      supported: false,
      zipped: false,
      advice: 'OneNote keeps notebooks in its own files. In OneNote, choose File, then Export, and save as Word.',
    };
  }
  return found('markdown', 'Markdown notes');
}

function nameOf(path: string): string {
  const last = path.split(/[\\/]/).filter(Boolean).pop() ?? 'Imported notes';
  return last.replace(/\.[^.]+$/, '');
}

function previewOf(path: string, detected: DetectedSource): ImportPreview {
  const sections = [
    { title: 'Recipes', pages: 3 },
    { title: 'Travel', pages: 2 },
  ];
  return {
    detected,
    notebookTitle: nameOf(path),
    sections,
    pages: 5,
    blocks: 24,
    assets: 4,
    assetBytes: 3_400_000,
    losses: detected.kind === 'evernote' ? EVERNOTE_LOSSES : [],
    lostPages: detected.kind === 'evernote' ? 3 : 0,
    skipped: detected.kind === 'evernote' ? 2 : 0,
  };
}

function treeOf(path: string, id: number): ImportedTree {
  let page = 0;
  const pages = (titles: readonly string[]) =>
    titles.map((title) => ({ core: `core-${id}-${(page += 1)}`, title, level: 0 }));
  return {
    dir: `C:\\Users\\Sample\\AppData\\Local\\OpenNote\\phase4\\Imported\\${nameOf(path)}`,
    title: nameOf(path),
    color: null,
    sections: [
      { title: 'Recipes', color: null, pages: pages(['Sourdough', 'Lentil soup', 'Flatbread']) },
      { title: 'Travel', color: null, pages: pages(['Lisbon', 'Packing list']) },
    ],
  };
}

export interface InteropLog {
  picks: { kind: PickKind }[];
  previews: string[];
  imports: string[];
  adopted: { dir: string; pages: { ui: string; core: string }[] }[];
  exports: ExportRequest[];
  revealed: string[];
  canceled: string[];
}

export function createWebInterop(): InteropClient & {
  readonly log: InteropLog;
  /** How long each of a job's steps takes, so a test can press Cancel part way. */
  setStepMs(ms: number): void;
  /** Where the fake PC keeps Sticky Notes, or null for none. */
  setStickyNotes(path: string | null): void;
} {
  const log: InteropLog = {
    picks: [],
    previews: [],
    imports: [],
    adopted: [],
    exports: [],
    revealed: [],
    canceled: [],
  };
  const listeners = new Set<(event: JobEvent) => void>();
  const canceled = new Set<string>();
  let next: (string | null)[] = [];
  let stepMs = 15;
  let imports = 0;
  let sticky: string | null = null;

  registerTestHook('interopPickNext', (...answers: (string | null)[]) => void (next = answers));
  registerTestHook('interopStepMs', (ms: number) => void (stepMs = ms));
  registerTestHook('interopLog', () => log);
  registerTestHook('interopSticky', (path: string | null) => void (sticky = path));

  const emit = (event: JobEvent) => listeners.forEach((listener) => listener(event));
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, stepMs));

  /** Runs the fake job's steps with progress. Returns false when the job was canceled. */
  async function run(job: string, what: string, phase: 'scanning' | 'converting' | 'writing', pages: number) {
    emit({ job, event: 'started', what });
    for (let step = 1; step <= STEPS; step += 1) {
      await wait();
      if (canceled.has(job)) {
        emit({ job, event: 'canceled' });
        return false;
      }
      emit({
        job,
        event: 'progress',
        phase,
        unit: 'items',
        done: Math.round((pages * step) / STEPS),
        total: pages,
        current: `Page ${step}`,
      });
    }
    emit({ job, event: 'finished', pages });
    return true;
  }

  const done = <T>(result: T): JobOutcome<T> => ({ status: 'done', result });
  const stopped: JobOutcome<never> = { status: 'canceled' };

  return {
    log,
    setStepMs: (ms) => void (stepMs = ms),
    pick(kind) {
      log.picks.push({ kind });
      if (next.length > 0) return Promise.resolve(next.shift() ?? null);
      return Promise.resolve(
        kind === 'file' ? 'C:\\Users\\Sample\\Exports\\Recipes.enex' : 'C:\\Users\\Sample\\Documents',
      );
    },
    detect: (path) => Promise.resolve(detectPath(path)),
    localSources: () => Promise.resolve({ stickyNotes: sticky }),
    setStickyNotes: (path) => void (sticky = path),
    async preview(job, path) {
      log.previews.push(path);
      const detected = detectPath(path);
      if (!(await run(job, `Check ${nameOf(path)}`, 'scanning', 5))) return stopped;
      return done(previewOf(path, detected));
    },
    async importFrom(job, path, choices) {
      log.imports.push(path);
      imports += 1;
      if (!(await run(job, `Import from ${nameOf(path)}`, 'converting', 5))) return stopped;
      const tree = treeOf(path, imports);
      const losses = detectPath(path).kind === 'evernote' ? EVERNOTE_LOSSES : [];
      if (choices.reportPage)
        tree.sections.push({
          title: 'Import report',
          color: null,
          pages: [{ core: `core-${imports}-r`, title: 'Import report', level: 0 }],
        });
      const result: ImportResult = {
        tree,
        pages: 5,
        losses,
        lostPages: losses.length > 0 ? 3 : 0,
        skipped: losses.length > 0 ? 2 : 0,
      };
      return done(result);
    },
    adopt(dir, pages) {
      log.adopted.push({ dir, pages: [...pages] });
      return Promise.resolve();
    },
    async exportTo(job, request) {
      log.exports.push(request);
      const count = request.sections.reduce((total, section) => total + section.pages.length, 0);
      if (!(await run(job, `Export ${request.title}`, 'writing', count))) return stopped;
      const result: ExportResult = {
        reveal: `${request.folder}\\${request.title}`,
        pages: count,
        files: request.format === 'htmlSingle' || request.format === 'docx' ? 1 : count,
        losses: [],
        lostPages: 0,
        skipped: 0,
      };
      return done(result);
    },
    cancel(job) {
      log.canceled.push(job);
      canceled.add(job);
    },
    reveal(path) {
      log.revealed.push(path);
      return Promise.resolve();
    },
    onProgress(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
