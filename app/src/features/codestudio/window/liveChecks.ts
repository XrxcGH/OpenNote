// The studio's live error checks (DESIGN 6.1, ADR 0074). The studio makes one diagnostics service on the first
// editor, feeds it each file's text with a new version on every change, and hands what it publishes to the Problems
// panel and the editor's marks. The runtimes' engine checks (Python, SQL, Lua, and clang) register once, when the
// first studio checks a file. The service and its checker worker load with the first editor, not at start-up.

import type { Diagnostic } from '../contracts';
import type { DiagnosticsService } from '../diagnostics';
import { fileLanguage } from './languages';

export interface CheckedFile {
  path: string;
  text: string;
}

type Publish = (file: string, items: Diagnostic[]) => void;
type Load = (publish: Publish) => Promise<DiagnosticsService>;

let runtimeChecks: Promise<unknown> | null = null;

/** The service with every built-in layer and the runtimes' engine checks. */
const loadService: Load = async (publish) => {
  const diagnostics = await import('../diagnostics');
  runtimeChecks ??= Promise.resolve(diagnostics.registerRuntimeChecks());
  return diagnostics.createDiagnostics({ publish });
};

export class LiveChecks {
  private service: Promise<DiagnosticsService> | null = null;
  private readonly versions = new Map<string, number>();
  private disposed = false;

  constructor(
    private readonly publish: Publish,
    private readonly load: Load = loadService,
  ) {}

  /** A file's new text. The other project files go with it, for checks that read more than one file. */
  update(file: CheckedFile, files: readonly CheckedFile[]): void {
    const version = (this.versions.get(file.path) ?? 0) + 1;
    this.versions.set(file.path, version);
    const others = files.filter((other) => other.path !== file.path).map(({ path, text }) => ({ path, text }));
    void this.started().then((service) => {
      // A newer change of the same file went first; a closed studio checks nothing.
      if (this.disposed || this.versions.get(file.path) !== version) return;
      service.update({ file: file.path, version, language: fileLanguage(file.path), text: file.text, files: others });
    });
  }

  /** Forgets a file that closed or was renamed away. */
  close(path: string): void {
    if (!this.versions.delete(path) || !this.service) return;
    void this.service.then((service) => service.close(path));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.service?.then((service) => service.dispose());
  }

  private started(): Promise<DiagnosticsService> {
    this.service ??= this.load((file, items) => {
      if (!this.disposed) this.publish(file, items);
    });
    return this.service;
  }
}
