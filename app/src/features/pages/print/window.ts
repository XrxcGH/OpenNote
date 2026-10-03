// The script of the hidden print window (ADR 0006). The shell opens `print.html` with the page to print in
// `window.__OPENNOTE_PRINT__`. This measures it, plans the sheets, shows the print document, and reports the plan to
// the shell through an event. The shell then calls PrintToPdf on this window. Nothing here touches the main window,
// so drawing and typing never wait for an export.
import { preparePrint, showDocument } from './prepare';
import type { PrepareInput } from './prepare';

interface Setup {
  readonly job: string;
  readonly input: PrepareInput;
}

interface TauriInternals {
  invoke(command: string, args: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    __OPENNOTE_PRINT__?: Setup;
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

/** The event the shell listens for (page_export.rs). */
const RESULT_EVENT = 'print://result';

async function run(): Promise<void> {
  const setup = window.__OPENNOTE_PRINT__;
  const internals = window.__TAURI_INTERNALS__;
  if (!setup || !internals) return;
  const report = (body: Record<string, unknown>) =>
    internals.invoke('plugin:event|emit', { event: RESULT_EVENT, payload: { job: setup.job, ...body } });
  try {
    const result = await preparePrint(document, setup.input);
    await showDocument(document, result.html);
    // The document stays here to print. The shell only needs the plan.
    await report({ ok: true, result: { ...result, html: '' } });
  } catch (error) {
    await report({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
}

void run();
