// One tool of the kit, drawn from its description: labeled fields (with unit pickers), the Insert buttons, and the
// answer with its working. The state and the answer come from useToolState; the parts are in their own files.
import chem from '../../ui/chem.module.css';
import tools from '../../ui/tools.module.css';
import type { ToolSpec } from '../spec';
import type { System } from '../units';
import { FieldControl } from './FieldControl';
import { InsertBar } from './InsertBar';
import { Results } from './Results';
import { tr } from './text';
import { useToolState } from './useToolState';

export function ToolView({ spec, system }: { spec: ToolSpec; system: System }) {
  const { values, units, outcome, setValue, setUnit } = useToolState(spec, system);
  return (
    <div className={tools.tool} data-chemmat-tool={spec.id}>
      <p className={tools.note}>{tr(spec.intro)}</p>
      <div className={chem.grid}>
        {spec.fields.map((field) =>
          field.when && !field.when(values) ? null : (
            <FieldControl
              key={field.id}
              toolId={spec.id}
              field={field}
              value={values[field.id] ?? field.initial}
              unit={units[field.id]}
              onValue={(next) => setValue(field.id, next)}
              onUnit={(dim, next) => setUnit(field.id, dim, next)}
            />
          ),
        )}
      </div>
      {outcome.ok ? <InsertBar solved={outcome} system={system} toolId={spec.id} /> : null}
      <Results outcome={outcome} system={system} />
    </div>
  );
}
