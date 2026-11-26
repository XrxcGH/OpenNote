import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '../contracts';
import { createDiagnosticsScheduler } from './scheduler';
import type { DiagnosticProvider, DiagnosticRequest } from './types';

function item(source: string, from: number): Diagnostic {
  return { file: 'main.py', from, to: from + 1, severity: 'error', code: 'X', message: 'm', source };
}

function doc(version: number, text = 'x'): DiagnosticRequest {
  return { file: 'main.py', version, language: 'python', text };
}

describe('diagnostics scheduler versions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drops results computed for version 3 when the document is at version 4', () => {
    const publish = vi.fn();
    const scheduler = createDiagnosticsScheduler({ publish });
    scheduler.update(doc(3));
    scheduler.update(doc(4));
    expect(scheduler.accept({ file: 'main.py', version: 3, source: 'opennote', items: [item('opennote', 0)] })).toBe(
      false,
    );
    expect(publish).not.toHaveBeenCalled();
    expect(scheduler.current('main.py')).toEqual([]);
    expect(scheduler.accept({ file: 'main.py', version: 4, source: 'opennote', items: [item('opennote', 0)] })).toBe(
      true,
    );
    expect(publish).toHaveBeenCalledWith('main.py', [item('opennote', 0)]);
  });

  it('drops a slow provider answer once the file has moved on', async () => {
    let finish: (items: Diagnostic[]) => void = () => {};
    const slow: DiagnosticProvider = {
      id: 'slow',
      layer: 'checker',
      languages: ['python'],
      run: () => new Promise((resolve) => (finish = resolve)),
    };
    const publish = vi.fn();
    const scheduler = createDiagnosticsScheduler({ publish, providers: [slow] });
    scheduler.update(doc(3));
    await vi.advanceTimersByTimeAsync(300);
    scheduler.update(doc(4));
    finish([item('slow', 0)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('diagnostics scheduler layers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits each layer its own pause and restarts it on every change', async () => {
    const runs: string[] = [];
    const provider = (id: string, layer: DiagnosticProvider['layer']): DiagnosticProvider => ({
      id,
      layer,
      languages: ['python'],
      run: (r) => {
        runs.push(`${id}@${r.version}`);
        return [];
      },
    });
    const scheduler = createDiagnosticsScheduler({
      publish: () => {},
      providers: [provider('lezer', 'syntax'), provider('opennote', 'checker'), provider('clang', 'compiler')],
    });
    scheduler.update(doc(1));
    await vi.advanceTimersByTimeAsync(49);
    expect(runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toEqual(['lezer@1']);
    await vi.advanceTimersByTimeAsync(200);
    scheduler.update(doc(2));
    await vi.advanceTimersByTimeAsync(299);
    expect(runs).toEqual(['lezer@1', 'lezer@2']);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toEqual(['lezer@1', 'lezer@2', 'opennote@2']);
    await vi.advanceTimersByTimeAsync(500);
    expect(runs).toEqual(['lezer@1', 'lezer@2', 'opennote@2', 'clang@2']);
  });

  it('merges the layers, sorted, and runs only the languages a provider names', async () => {
    const publish = vi.fn();
    const scheduler = createDiagnosticsScheduler({
      publish,
      debounce: { syntax: 0, checker: 0 },
      providers: [
        { id: 'opennote', layer: 'checker', languages: ['python'], run: () => [item('opennote', 5)] },
        { id: 'lezer', layer: 'syntax', languages: ['python'], run: () => [item('lezer', 2)] },
        { id: 'sqlite', layer: 'engine', languages: ['sql'], run: () => [item('sqlite', 0)] },
      ],
    });
    scheduler.update(doc(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.current('main.py').map((d) => d.source)).toEqual(['lezer', 'opennote']);
  });
});

describe('diagnostics scheduler upkeep', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps shown problems on their text through a mapped change until the layers answer', () => {
    const scheduler = createDiagnosticsScheduler({ publish: () => {} });
    scheduler.update(doc(1, 'abc'));
    scheduler.accept({ file: 'main.py', version: 1, source: 'opennote', items: [item('opennote', 2)] });
    scheduler.update(doc(2, 'XXabc'), (pos) => pos + 2);
    expect(scheduler.current('main.py').map((d) => d.from)).toEqual([4]);
    scheduler.update(doc(3, 'abc'));
    expect(scheduler.current('main.py')).toEqual([]);
  });

  it('reports a failing provider and keeps the others', async () => {
    const onError = vi.fn();
    const scheduler = createDiagnosticsScheduler({
      publish: () => {},
      onError,
      debounce: { checker: 0 },
      providers: [
        { id: 'bad', layer: 'checker', languages: ['python'], run: () => Promise.reject(new Error('boom')) },
        { id: 'good', layer: 'checker', languages: ['python'], run: () => [item('good', 1)] },
      ],
    });
    scheduler.update(doc(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledOnce();
    expect(scheduler.current('main.py').map((d) => d.source)).toEqual(['good']);
  });

  it('removes a provider and its marks, and forgets closed files', () => {
    const publish = vi.fn();
    const scheduler = createDiagnosticsScheduler({ publish });
    const off = scheduler.register({ id: 'sqlite', layer: 'engine', languages: ['sql'], run: () => [] });
    scheduler.update(doc(1));
    scheduler.accept({ file: 'main.py', version: 1, source: 'sqlite', items: [item('sqlite', 0)] });
    off();
    expect(publish).toHaveBeenLastCalledWith('main.py', []);
    scheduler.close('main.py');
    expect(scheduler.accept({ file: 'main.py', version: 1, source: 'x', items: [] })).toBe(false);
  });
});
