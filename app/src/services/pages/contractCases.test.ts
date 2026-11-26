// The contract cases compare what a service returns with what a case expects, whatever order the fields come in.
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './contractCases';

describe('canonicalJson', () => {
  it('writes the same text for objects whose keys come in another order, at every depth', () => {
    const memory = { kind: 'text', block: 'b', anchor: 6, head: 6, list: [{ y: 1, x: 2 }] };
    const core = { list: [{ x: 2, y: 1 }], head: 6, kind: 'text', block: 'b', anchor: 6 };
    expect(canonicalJson(core)).toBe(canonicalJson(memory));
  });

  it('still tells different values, and the order of an array, apart', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson(undefined)).toBe(canonicalJson(undefined));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson(undefined));
  });
});
