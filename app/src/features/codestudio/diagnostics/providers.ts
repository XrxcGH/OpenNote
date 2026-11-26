// The built-in providers and the ready-made diagnostics service: the Lezer syntax layer, OpenNote's checkers (both in
// the diagnostics worker), and every engine check the runtime lanes register, all behind one scheduler.

import type { Diagnostic } from '../contracts';
import { t, type MessageKey } from '../../../strings/t';
import { CHECKER_LANGUAGES } from './analyze';
import { createCheckerClient, type CheckerClient } from './client';
import { engineChecks, engineProvider, onEngineChecks } from './engine';
import { GRAMMAR_LANGUAGES } from './parsers';
import { createDiagnosticsScheduler, type DiagnosticsScheduler, type SchedulerOptions } from './scheduler';
import type { DiagnosticProvider, Finding } from './types';

/** A checker finding in words, for the editor and the Problems panel. */
export function toDiagnostic(file: string, source: string, finding: Finding): Diagnostic {
  const key = `codeStudio.diagnostics.messages.${finding.message}` as MessageKey;
  return {
    file,
    from: finding.from,
    to: finding.to,
    severity: finding.severity,
    code: finding.code,
    message: (t as (k: MessageKey, p?: Record<string, string | number>) => string)(key, finding.params),
    source,
  };
}

/** Layer L-a: Lezer syntax errors for every language with a grammar. */
export function syntaxProvider(client: CheckerClient): DiagnosticProvider {
  return {
    id: 'lezer',
    layer: 'syntax',
    languages: GRAMMAR_LANGUAGES,
    async run(request) {
      const { syntax } = await client.analyze({ language: request.language, text: request.text, layers: ['syntax'] });
      return syntax.map((f) => toDiagnostic(request.file, 'lezer', f));
    },
  };
}

/** Layer L-b: OpenNote's checkers for Python, JavaScript, TypeScript, C, C++, and Lua. */
export function checkerProvider(client: CheckerClient): DiagnosticProvider {
  return {
    id: 'opennote',
    layer: 'checker',
    languages: CHECKER_LANGUAGES,
    async run(request) {
      const { checker } = await client.analyze({ language: request.language, text: request.text, layers: ['checker'] });
      return checker.map((f) => toDiagnostic(request.file, 'opennote', f));
    },
  };
}

export interface DiagnosticsService extends DiagnosticsScheduler {
  readonly client: CheckerClient;
}

/** A scheduler with the built-in layers and the registered engine checks, which follows checks added later. */
export function createDiagnostics(
  options: Omit<SchedulerOptions, 'providers'> & { client?: CheckerClient },
): DiagnosticsService {
  const client = options.client ?? createCheckerClient();
  const scheduler = createDiagnosticsScheduler({
    ...options,
    providers: [syntaxProvider(client), checkerProvider(client)],
  });
  const removers = new Map<string, () => void>();
  const add = (check: Parameters<typeof engineProvider>[0]) =>
    removers.set(check.id, scheduler.register(engineProvider(check)));
  engineChecks().forEach(add);
  const stop = onEngineChecks((check, added) => {
    removers.get(check.id)?.();
    removers.delete(check.id);
    if (added) add(check);
  });
  return {
    ...scheduler,
    client,
    dispose() {
      stop();
      scheduler.dispose();
      client.dispose();
    },
  };
}
