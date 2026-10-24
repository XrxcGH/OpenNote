// Every earth kit calculation, run with the values its form starts with: each must give an answer, and every
// label, option, step, and picture description it uses must exist in the strings.
import { describe, expect, it } from 'vitest';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { figureSvg } from './core/figure';
import { MODE_LOADERS } from './loaders';
import { EARTH_TOOL_IDS } from './meta';
import { initialValues, run } from './ui/form';
import { stepsText, tableOf } from './ui/InsertControls';

describe('earth kit forms', () => {
  for (const tool of EARTH_TOOL_IDS) {
    it(`answers every ${tool} calculation with its first values`, async () => {
      expect(t(`kitEarth.tools.${tool}.title` as MessageKey)).toBeTruthy();
      expect(t(`kitEarth.tools.${tool}.open` as MessageKey)).toBeTruthy();
      for (const mode of await MODE_LOADERS[tool]()) {
        expect(t(mode.label), mode.id).toBeTruthy();
        if (mode.intro) expect(t(mode.intro)).toBeTruthy();
        for (const field of mode.fields) {
          expect(t(field.label), field.id).toBeTruthy();
          for (const option of field.options ?? []) expect(t(option.label), option.value).toBeTruthy();
        }
        const result = run(tool, mode, initialValues(mode));
        expect(result.ok ? 'ok' : result.message, `${tool} ${mode.id}`).toBe('ok');
        if (!result.ok) continue;
        expect(result.outcome.answer).not.toMatch(/NaN|undefined/);
        expect(stepsText(result.outcome)).not.toMatch(/NaN|undefined|\{/);
        tableOf(result.outcome);
        for (const figure of result.outcome.figures ?? []) {
          expect(figure.description).not.toMatch(/NaN|undefined/);
          expect(figureSvg(figure)).toMatch(/^<svg/);
        }
      }
    });
  }
});
