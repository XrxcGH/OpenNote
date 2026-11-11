import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeAdapter } from '../contracts';
import { createCheckerClient, type WorkerLike } from './client';
import { engineChecks, fromRuntimeAdapter, registerEngineCheck, runtimeToDiagnostic } from './engine';
import { createDiagnostics } from './providers';

describe('engine checks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns a runtime line and column into the word there, and a bare line into its text', () => {
    const text = 'SELECT nmae\n  FROM people;\n';
    expect(
      runtimeToDiagnostic(
        text,
        { file: 'q.sql', line: 1, column: 8, message: 'no such column: nmae', kind: 'error' },
        'sqlite',
      ),
    ).toEqual({
      file: 'q.sql',
      from: 7,
      to: 11,
      severity: 'error',
      code: 'error',
      message: 'no such column: nmae',
      source: 'sqlite',
    });
    const line = runtimeToDiagnostic(text, { file: 'q.sql', line: 2, message: 'm', kind: 'warning' }, 'sqlite');
    expect(text.slice(line.from, line.to)).toBe('FROM people;');
    expect(line.severity).toBe('warning');
  });

  it('joins checks registered before and after the service starts, and drops removed ones', async () => {
    const off = registerEngineCheck({
      id: 'sqlite',
      languages: ['sql'],
      check: async (file) => [{ file: file.path, line: 1, message: 'near "FORM": syntax error', kind: 'error' }],
    });
    const publish = vi.fn();
    const client = createCheckerClient(() => null);
    const service = createDiagnostics({ publish, client });
    service.update({ file: 'q.sql', version: 1, language: 'sql', text: 'SELECT 1 FORM t;' });
    await vi.advanceTimersByTimeAsync(300);
    expect(
      service
        .current('q.sql')
        .filter((d) => d.source === 'sqlite')
        .map((d) => d.message),
    ).toEqual(['near "FORM": syntax error']);

    const lua: RuntimeAdapter = {
      id: 'lua',
      load: async () => {},
      run: async () => {},
      check: async (file) => [{ file: file.path, line: 1, message: "'=' expected near 'x'", kind: 'error' }],
    };
    const offLua = registerEngineCheck(fromRuntimeAdapter(lua, ['lua'], 'wasmoon')!);
    service.update({ file: 'm.lua', version: 1, language: 'lua', text: 'local = x' });
    await vi.advanceTimersByTimeAsync(300);
    expect(service.current('m.lua').map((d) => d.source)).toContain('wasmoon');

    off();
    offLua();
    expect(engineChecks()).toEqual([]);
    expect(service.current('q.sql').filter((d) => d.source === 'sqlite')).toEqual([]);
    service.dispose();
  });

  it('has no check for an adapter without one', () => {
    expect(fromRuntimeAdapter({ id: 'r', load: async () => {}, run: async () => {} }, ['r'])).toBeNull();
  });
});

describe('checker client', () => {
  it('sends work to the worker and matches each answer to its request', async () => {
    const sent: unknown[] = [];
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: (m) => sent.push(m),
      terminate: vi.fn(),
    };
    const client = createCheckerClient(() => worker);
    const answer = client.analyze({ language: 'python', text: 'x', layers: ['checker'] });
    expect(sent).toEqual([{ id: 1, language: 'python', text: 'x', layers: ['checker'] }]);
    worker.onmessage?.({ data: { id: 1, result: { syntax: [], checker: [] } } });
    await expect(answer).resolves.toEqual({ syntax: [], checker: [] });
  });

  it('analyzes on the page when the worker fails', async () => {
    const worker: WorkerLike = { onmessage: null, onerror: null, postMessage: () => {}, terminate: vi.fn() };
    const client = createCheckerClient(() => worker);
    const answer = client.analyze({ language: 'python', text: 'import os\n', layers: ['checker'] });
    worker.onerror?.(new Event('error'));
    const result = await answer;
    expect(result.checker.map((f) => f.code)).toEqual(['F401']);
    expect(worker.terminate).toHaveBeenCalled();
  });
});
