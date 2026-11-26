// Every field and option label a tool shows must be a real string key, or opening the tool throws.
import { describe, expect, it } from 'vitest';
import { kitElectrical } from '../../../strings/en/kitElectrical';
import { spec as energy } from './energy/tool';

describe('electrical tool labels', () => {
  it('energy fields and options resolve to strings', () => {
    const f = kitElectrical.f as Record<string, string>;
    for (const field of energy.fields) {
      expect(f[field.label], field.id).toBeTypeOf('string');
      for (const option of field.options ?? []) {
        if (!option.literal) expect(f[option.label], `${field.id}.${option.value}`).toBeTypeOf('string');
      }
    }
  });
});
