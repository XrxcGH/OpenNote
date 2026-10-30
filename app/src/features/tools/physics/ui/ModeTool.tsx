// One physics tool: a choice of calculation when it has several, its fields, and the answer, which updates as the
// person types. What was typed in each calculation is kept, so switching back finds it again.
import { useMemo } from 'react';
import { t } from '../../../../strings/t';
import { currentInputs, readState, solveMode } from '../kit/read';
import type { ToolState } from '../kit/read';
import { sayKey } from '../kit/say';
import type { KitToolProps, ToolSpec } from '../kit/types';
import { Fields } from './Fields';
import { OutcomeView } from './OutcomeView';
import extra from '../../ui/extra.module.css';
import tools from '../../ui/tools.module.css';

export function ModeTool({ spec, inputs, setInputs, system, insert }: KitToolProps & { spec: ToolSpec }) {
  const state = readState(spec, inputs);
  const { mode, inputs: current } = currentInputs(spec, state);
  const key = JSON.stringify(current);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the inputs are compared by their text
  const outcome = useMemo(() => solveMode(mode, current, system), [mode, key, system]);
  const keep = (next: ToolState) => setInputs(next);
  const kept = state.modes[mode.id] ?? { text: {}, unit: {} };
  const selectId = `physics-${spec.id}-mode`;
  return (
    <div className={tools.tool} data-physics-tool={spec.id}>
      {spec.modes.length > 1 ? (
        <div className={extra.field}>
          <label htmlFor={selectId}>{t('kitPhysics.ui.mode')}</label>
          <select
            id={selectId}
            className={extra.input}
            value={mode.id}
            onChange={(event) => keep({ ...state, mode: event.target.value })}
          >
            {spec.modes.map((one) => (
              <option key={one.id} value={one.id}>
                {sayKey(one.label)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {mode.intro ? <p className={tools.note}>{sayKey(mode.intro)}</p> : null}
      <Fields
        mode={mode}
        inputs={current}
        system={system}
        onText={(id, value) =>
          keep({ ...state, modes: { ...state.modes, [mode.id]: { ...kept, text: { ...kept.text, [id]: value } } } })
        }
        onUnit={(id, unit) =>
          keep({ ...state, modes: { ...state.modes, [mode.id]: { ...kept, unit: { ...kept.unit, [id]: unit } } } })
        }
      />
      <OutcomeView outcome={outcome} system={system} insert={insert} />
    </div>
  );
}
