import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../contracts';
import { countProblems, fromDiagnostic, fromRuntime, groupProblems, lineColumn } from './group';
import type { Problem } from './group';

const problem = (file: string, line: number, severity: Problem['severity'], message = 'm'): Problem => ({
  file,
  line,
  column: 1,
  severity,
  message,
  code: 'c',
  source: 's',
});

describe('the problems panel model', () => {
  it('reads the line and column of an offset (hand-counted)', () => {
    const text = 'a = 1\nprint(b)\n';
    expect(lineColumn(text, 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn(text, 12)).toEqual({ line: 2, column: 7 });
    const item: Diagnostic = {
      file: 'main.py',
      from: 12,
      to: 13,
      severity: 'error',
      code: 'F821',
      message: "undefined name 'b'",
      source: 'opennote',
    };
    expect(fromDiagnostic(item, text)).toMatchObject({ line: 2, column: 7, code: 'F821' });
  });

  it('takes a runtime error as an error at its line', () => {
    expect(fromRuntime({ file: 'main.py', line: 3, message: 'boom', kind: 'NameError' })).toMatchObject({
      severity: 'error',
      line: 3,
      column: 1,
      code: 'NameError',
    });
  });

  it('groups by file in project order with counts, and sorts each file by line', () => {
    const groups = groupProblems(
      [
        problem('util.py', 9, 'warning'),
        problem('main.py', 7, 'error'),
        problem('main.py', 2, 'hint'),
        problem('main.py', 2, 'info'),
        problem('zeta.py', 1, 'error'),
        problem('main.py', 7, 'error'),
      ],
      ['main.py', 'util.py'],
    );
    expect(groups.map((group) => group.file)).toEqual(['main.py', 'util.py', 'zeta.py']);
    expect(groups[0]!.problems.map((item) => [item.line, item.severity])).toEqual([
      [2, 'info'],
      [2, 'hint'],
      [7, 'error'],
    ]);
    expect(groups[0]!.counts).toEqual({ errors: 1, warnings: 0, infos: 2 });
    expect(countProblems(groups.flatMap((group) => group.problems))).toEqual({ errors: 2, warnings: 1, infos: 2 });
  });
});
