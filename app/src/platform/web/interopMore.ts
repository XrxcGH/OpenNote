// The web fake of the host's extra interop operations (`interop_more`): printed PDF pages staged for an export, and
// Markdown or text files opened as pages. It stays off, so the web build looks like a copy of OpenNote without those
// abilities, until a test turns it on: `window.__OPENNOTE_INTEROP_MORE__ = true` before the app loads (so the start-up
// file watcher runs), or the `interopMore` hook. Files live in memory; `interopFile` puts one there or changes it
// "in another app", and `interopStaged` reads what an export staged.
import { registerTestHook } from './testHooks';

interface FakeFile {
  text: string;
  modified: number;
}

declare global {
  interface Window {
    __OPENNOTE_INTEROP_MORE__?: boolean;
  }
}

const TEXT = /\.(md|markdown|txt)$/i;

export interface WebInteropMore {
  readonly on: () => boolean;
  readonly more: <T>(op: string, args?: Record<string, unknown>) => Promise<T>;
  /** The pages staged for an export job, by page ID, with their size in bytes. */
  readonly staged: (job: string) => Map<string, number>;
  /** The picker grants the file it gives, as the host's `interop_pick` does. */
  readonly grant: (path: string) => void;
}

export function createWebInteropMore(): WebInteropMore {
  let on = typeof window !== 'undefined' && window.__OPENNOTE_INTEROP_MORE__ === true;
  const files = new Map<string, FakeFile>();
  const granted = new Set<string>();
  const links = new Map<string, string>();
  const launch: string[] = [];
  const staged = new Map<string, Map<string, number>>();
  const writes: { path: string; text: string }[] = [];
  let clock = 1_000;
  const tick = () => (clock += 1_000);
  const key = (path: string) => path.replace(/\//g, '\\').toLowerCase();

  registerTestHook('interopMore', (value: boolean) => void (on = value));
  registerTestHook('interopFile', (path: string, text: string, opts?: { granted?: boolean; launch?: boolean }) => {
    files.set(key(path), { text, modified: tick() });
    if (opts?.granted || opts?.launch) granted.add(key(path));
    if (opts?.launch) launch.push(path);
  });
  registerTestHook('interopFileText', (path: string) => files.get(key(path))?.text ?? null);
  registerTestHook('interopWrites', () => writes);
  registerTestHook('interopStaged', () =>
    Object.fromEntries([...staged].map(([job, pages]) => [job, Object.fromEntries(pages)])),
  );

  const refuse = (message: string, code = 'invalid') => Promise.reject({ code, message });
  const grantedFile = (args: Record<string, unknown>) => {
    const path = String(args.path ?? '');
    const file = files.get(key(path));
    return granted.has(key(path)) && TEXT.test(path) && file ? { path, file } : null;
  };

  function more<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    const answer = (value: unknown) => Promise.resolve(value as T);
    switch (op) {
      case 'pdf_stage': {
        const job = String(args.job);
        const data = String(args.data ?? '');
        if (!data) return refuse('The page has no PDF.');
        const pages = staged.get(job) ?? new Map<string, number>();
        pages.set(String(args.page), Math.floor((data.length * 3) / 4));
        staged.set(job, pages);
        return answer({ staged: pages.size });
      }
      case 'pdf_unstage':
        staged.delete(String(args.job));
        return answer(null);
      case 'open_launch':
        return answer({ files: launch.splice(0) });
      case 'open_picked': {
        const found = grantedFile(args);
        return found ? answer({ path: found.path, share: false }) : refuse('OpenNote can only open files you chose.');
      }
      case 'open_read': {
        const found = grantedFile(args);
        if (!found) return refuse('OpenNote can only open files you chose.');
        const { path, file } = found;
        return answer({ path, text: file.text, modified: file.modified, markdown: !/\.txt$/i.test(path) });
      }
      case 'open_write': {
        const found = grantedFile(args);
        if (!found) return refuse('OpenNote can only open files you chose.');
        if (typeof args.expected === 'number' && args.expected !== found.file.modified)
          return refuse('The file changed outside OpenNote.', 'changed');
        found.file.text = String(args.text ?? '');
        found.file.modified = tick();
        writes.push({ path: found.path, text: found.file.text });
        return answer({ modified: found.file.modified });
      }
      case 'open_stat': {
        const found = grantedFile(args);
        if (found) return answer({ exists: true, modified: found.file.modified });
        return granted.has(key(String(args.path ?? '')))
          ? answer({ exists: false, modified: null })
          : refuse('OpenNote can only open files you chose.');
      }
      case 'open_list':
        return answer({ pages: Object.fromEntries(links) });
      case 'open_link':
        if (args.path === null) links.delete(String(args.page));
        else links.set(String(args.page), String(args.path));
        return answer(null);
      case 'open_default_apps':
        return answer(null);
      default:
        return refuse(`There is no operation called ${op}.`);
    }
  }

  return {
    on: () => on,
    more,
    staged: (job) => staged.get(job) ?? new Map(),
    grant: (path) => void granted.add(key(path)),
  };
}
