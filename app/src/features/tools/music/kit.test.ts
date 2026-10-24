import { describe, expect, it } from 'vitest';
import { kitMusic } from '../../../strings/en/kitMusic';
import { LOADERS } from './kit';
import { MUSIC_TOOLS } from './meta';
import { initialValues, runTool } from './spec';
import type { ToolSpec } from './spec';

const text = kitMusic as unknown as Record<string, Record<string, unknown>>;

/** Every combination of the first select field's choices, with the other fields at their starting values. */
function modesOf(spec: ToolSpec): Record<string, string>[] {
  const first = spec.fields.find((field) => field.kind === 'select');
  const base = initialValues(spec);
  if (!first?.options) return [base];
  return first.options.map((option) => ({ ...base, [first.id]: option.value }));
}

describe.each(MUSIC_TOOLS.map((tool) => tool.id))('the %s tool', (id) => {
  it('names itself, and every field, row, step and note it can show', async () => {
    const loaded = await LOADERS[id]();
    expect(text.t![id]).toBeTruthy();
    if (!loaded.spec) return;
    for (const field of loaded.spec.fields) {
      expect(text.f![field.label], `field ${field.label}`).toBeTruthy();
      if (field.hint) expect(text.f![field.hint], `hint ${field.hint}`).toBeTruthy();
      for (const option of field.options ?? []) expect(text.f![option.label], `option ${option.label}`).toBeTruthy();
    }
    for (const values of modesOf(loaded.spec)) {
      const result = runTool(loaded.spec, values);
      if (!result.ok) {
        expect(text.e![result.error], `error ${result.error}`).toBeTruthy();
        continue;
      }
      expect(result.answer.length).toBeGreaterThan(0);
      for (const row of result.rows) expect(text.r![row.key], `row ${row.key}`).toBeTruthy();
      for (const step of result.steps) expect(text.s![step.key], `step ${step.key}`).toBeTruthy();
      for (const note of result.notes) expect(text.n![note], `note ${note}`).toBeTruthy();
    }
  });

  it('answers every mode with its starting values', async () => {
    const loaded = await LOADERS[id]();
    if (!loaded.spec) return;
    for (const values of modesOf(loaded.spec)) {
      const result = runTool(loaded.spec, values);
      expect(result.ok, JSON.stringify(values) + JSON.stringify(result)).toBe(true);
    }
  });

  it('says what is wrong with an empty number instead of failing', async () => {
    const loaded = await LOADERS[id]();
    if (!loaded.spec) return;
    for (const values of modesOf(loaded.spec)) {
      const blank = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          loaded.spec?.fields.find((f) => f.id === key)?.kind === 'select' ? value : '',
        ]),
      );
      const result = runTool(loaded.spec, blank);
      if (!result.ok) expect(text.e![result.error], `error ${result.error}`).toBeTruthy();
    }
  });
});
