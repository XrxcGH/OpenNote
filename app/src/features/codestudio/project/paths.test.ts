// The path rules of DESIGN 3.2, against the shared case table that the Rust validator (code:L16) also reads.
import { describe, expect, it } from 'vitest';
import cases from './pathCases.json';
import { pathProblem, pathProblemAmong, pathsProblem } from './paths';

describe('project path rules', () => {
  it('refuses the lane known answers and accepts src/main.py', () => {
    // The lane's list, each with the rule of DESIGN 3.2 that refuses it.
    expect(pathProblem('../a')).toBe('dotSegment');
    expect(pathProblem('/a')).toBe('absolute');
    expect(pathProblem('a\\b')).toBe('backslash');
    expect(pathProblem('CON.py')).toBe('reserved');
    expect(pathProblem('a/./b')).toBe('dotSegment');
    expect(pathProblem('x ')).toBe('trailingDotOrSpace');
    expect(pathsProblem(['Main.py', 'main.py'])).toEqual({ path: 'main.py', problem: 'duplicate' });
    expect(pathProblem('src/main.py')).toBeNull();
  });

  it.each(cases.single)('$path: $problem', ({ path, problem }) => {
    expect(pathProblem(path)).toBe(problem);
  });

  it.each(cases.long)('a path of $chars characters: $problem', ({ chars, problem }) => {
    expect(pathProblem('a'.repeat(chars))).toBe(problem);
  });

  it.each(cases.sets)('$paths: $problem', ({ paths, problem, at }) => {
    expect(pathsProblem(paths)).toEqual(problem === null ? null : { path: at, problem });
  });

  it('counts characters, not UTF-16 units, toward the limit', () => {
    expect(pathProblem('😀'.repeat(255))).toBeNull();
    expect(pathProblem('😀'.repeat(256))).toBe('tooLong');
  });

  it('lets a file keep its own path when renamed to a different letter case', () => {
    expect(pathProblemAmong('Main.py', ['data/input.txt'])).toBeNull();
  });
});
