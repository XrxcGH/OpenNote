// Every shape recognition can return has a name to announce (Beta 5 walk W2-3: a freeform shape had none).
import { describe, expect, it } from 'vitest';
import { en } from '../../../strings/en';
import { SIMPLICITY } from '../geometry/shapes/types';

describe('shape names', () => {
  it('names every shape kind', () => {
    for (const kind of Object.keys(SIMPLICITY)) expect(en.ink.shapes.names).toHaveProperty(kind);
  });
});
