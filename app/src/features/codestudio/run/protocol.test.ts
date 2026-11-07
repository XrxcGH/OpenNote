// Run protocol version 2 (DESIGN 4.1): every message is checked, malformed and oversized ones are dropped, and rich
// output stays inside its caps (2 MiB per image, 10,000 table rows).

import { describe, expect, it } from 'vitest';
import { RICH_LIMITS } from '../contracts/run';
import {
  MESSAGE_LIMITS,
  RUN_LIMITS,
  base64Bytes,
  limitsWithin,
  readHostMessage,
  readMessage,
  readRequest,
} from './protocol';

/** A base64 string that decodes to exactly `bytes` bytes. */
function base64Of(bytes: number): string {
  const whole = Math.floor(bytes / 3) * 4;
  const rest = bytes % 3;
  return 'A'.repeat(whole) + (rest === 1 ? 'AA==' : rest === 2 ? 'AAA=' : '');
}

const request = {
  kind: 'run',
  runtime: 'python-quick',
  files: [{ path: 'main.py', text: 'print(1)' }],
  main: 'main.py',
  args: ['a'],
  stdin: { mode: 'prefilled', text: '' },
  limits: RUN_LIMITS,
  seed: 7,
};

describe('worker messages', () => {
  it('accepts each well-formed kind', () => {
    expect(readMessage({ kind: 'loading', percent: 40 })).toEqual({ kind: 'loading', percent: 40 });
    expect(readMessage({ kind: 'started', version: 'MicroPython 1.27.0', interactive: true })).toEqual({
      kind: 'started',
      version: 'MicroPython 1.27.0',
      interactive: true,
    });
    expect(readMessage({ kind: 'out', stream: 'err', text: 'x' })).toEqual({ kind: 'out', stream: 'err', text: 'x' });
    expect(readMessage({ kind: 'input-wanted', prompt: '> ' })).toEqual({ kind: 'input-wanted', prompt: '> ' });
    const item = { file: 'main.py', line: 3, column: 5, message: 'NameError: x', kind: 'NameError' };
    expect(readMessage({ kind: 'diagnostic', items: [item] })).toEqual({ kind: 'diagnostic', items: [item] });
    const result = { id: 't1', name: 'adds', status: 'pass', timeMs: 3 };
    expect(readMessage({ kind: 'test', result })).toEqual({ kind: 'test', result });
    const event = { i: 0, kind: 'line', file: 'main.py', line: 1, depth: 0, frame: 0, fn: '', locals: {}, stdout: 0 };
    expect(readMessage({ kind: 'trace', chunk: [event] })).toEqual({ kind: 'trace', chunk: [event] });
    expect(
      readMessage({ kind: 'done', status: 'ok', exitCode: 3, message: '', written: [{ path: 'o.txt', text: 'hi' }] }),
    ).toEqual({ kind: 'done', status: 'ok', exitCode: 3, message: '', written: [{ path: 'o.txt', text: 'hi' }] });
  });

  it('drops malformed messages', () => {
    for (const bad of [
      null,
      'done',
      42,
      [],
      { kind: 'nope' },
      { kind: 'loading', percent: 101 },
      { kind: 'loading', percent: '50' },
      { kind: 'out', stream: 'html', text: 'x' },
      { kind: 'out', stream: 'out', text: 5 },
      { kind: 'input-wanted' },
      { kind: 'diagnostic', items: [{ file: 'main.py', line: 0, message: 'x', kind: 'e' }] },
      { kind: 'diagnostic', items: 'x' },
      { kind: 'test', result: { id: 't', name: 'n', status: 'great', timeMs: 1 } },
      { kind: 'trace', chunk: [{ i: -1 }] },
      { kind: 'done', status: 'fine', message: '' },
      { kind: 'done', status: 'ok', message: '', exitCode: 1.5 },
      { kind: 'done', status: 'ok', message: '', written: [{ path: '', text: '' }] },
      { kind: 'rich', mime: 'text/html', data: '<b>x</b>' },
      { kind: 'rich', mime: 'image/png', data: 'not base64!' },
    ]) {
      expect(readMessage(bad)).toBeNull();
    }
  });

  it('drops oversized messages', () => {
    expect(readMessage({ kind: 'out', stream: 'out', text: 'x'.repeat(MESSAGE_LIMITS.textChars) })).not.toBeNull();
    expect(readMessage({ kind: 'out', stream: 'out', text: 'x'.repeat(MESSAGE_LIMITS.textChars + 1) })).toBeNull();
    expect(readMessage({ kind: 'input-wanted', prompt: 'x'.repeat(MESSAGE_LIMITS.shortChars + 1) })).toBeNull();
    const item = { file: 'main.py', line: 1, message: 'x', kind: 'e' };
    const items = Array.from({ length: MESSAGE_LIMITS.diagnostics + 1 }, () => item);
    expect(readMessage({ kind: 'diagnostic', items })).toBeNull();
    const written = Array.from({ length: 201 }, (_, i) => ({ path: `f${i}.txt`, text: '' }));
    expect(readMessage({ kind: 'done', status: 'ok', message: '', written })).toBeNull();
  });

  it('refuses rich images above 2 MiB', () => {
    expect(base64Bytes(base64Of(10))).toBe(10);
    expect(base64Bytes(base64Of(11))).toBe(11);
    const atCap = base64Of(RICH_LIMITS.imageBytes);
    expect(readMessage({ kind: 'rich', mime: 'image/png', data: atCap })).toEqual({
      kind: 'rich',
      mime: 'image/png',
      data: atCap,
    });
    expect(readMessage({ kind: 'rich', mime: 'image/png', data: base64Of(RICH_LIMITS.imageBytes + 1) })).toBeNull();
  });

  it('refuses tables above 10,000 rows', () => {
    const rows = (count: number) => JSON.stringify({ columns: ['a'], rows: Array.from({ length: count }, () => [1]) });
    const table = 'application/vnd.opennote.table+json';
    expect(readMessage({ kind: 'rich', mime: table, data: rows(RICH_LIMITS.tableRows) })).not.toBeNull();
    expect(readMessage({ kind: 'rich', mime: table, data: rows(RICH_LIMITS.tableRows + 1) })).toBeNull();
    expect(readMessage({ kind: 'rich', mime: table, data: '{"rows": 3}' })).toBeNull();
    const csv = (count: number) => 'a\n'.repeat(count);
    expect(readMessage({ kind: 'rich', mime: 'text/csv', data: csv(RICH_LIMITS.tableRows) })).not.toBeNull();
    expect(readMessage({ kind: 'rich', mime: 'text/csv', data: csv(RICH_LIMITS.tableRows + 1) })).toBeNull();
  });
});

describe('page messages inside the worker', () => {
  it('reads a run request and keeps its limits under the page limits', () => {
    const read = readRequest({ ...request, limits: { timeMs: 99_999_999, outputChars: 10 } });
    expect(read?.limits.timeMs).toBe(RUN_LIMITS.timeMs);
    expect(read?.limits.outputChars).toBe(10);
    expect(read?.seed).toBe(7);
    expect(limitsWithin({ memoryBytes: -1 }).memoryBytes).toBe(RUN_LIMITS.memoryBytes);
  });

  it('drops malformed run requests', () => {
    expect(readRequest({ ...request, runtime: 'cobol' })).toBeNull();
    expect(readRequest({ ...request, main: 'other.py' })).toBeNull();
    expect(readRequest({ ...request, args: [1] })).toBeNull();
    expect(readRequest({ ...request, stdin: { mode: 'tty', text: '' } })).toBeNull();
    expect(readRequest({ ...request, args: Array.from({ length: MESSAGE_LIMITS.args + 1 }, () => 'a') })).toBeNull();
    const big = { path: 'main.py', text: 'x'.repeat(RUN_LIMITS.sourceChars + 1) };
    expect(readRequest({ ...request, files: [big] })).toBeNull();
  });

  it('reads load, input, and end of input', () => {
    expect(readHostMessage({ kind: 'load', runtime: 'lua' })).toEqual({ kind: 'load', runtime: 'lua' });
    expect(readHostMessage({ kind: 'load', runtime: 'x' })).toBeNull();
    expect(readHostMessage({ kind: 'input', text: 'yes' })).toEqual({ kind: 'input', text: 'yes' });
    expect(readHostMessage({ kind: 'input', text: 'x'.repeat(MESSAGE_LIMITS.stdinChars + 1) })).toBeNull();
    expect(readHostMessage({ kind: 'eof' })).toEqual({ kind: 'eof' });
  });
});
