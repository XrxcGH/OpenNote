// The economics and finance window: a picker for the tool, a picker for the form within it, and the shared form
// (ui/ChemForm) that shows the answer, its steps, and Insert. The methods are plain modules beside this file.
import { useState } from 'react';
import { ChemForm } from '../ui/ChemForm';
import extra from '../ui/extra.module.css';
import { loadStored, saveStored } from '../ui/storage';
import styles from '../ui/tools.module.css';
import { tx } from './forms';
import { ECON_TOOLS } from './tools';

const STORE = 'econ';

export function EconTool() {
  const saved = loadStored<{ tool?: string; form?: Record<string, string> }>(STORE, {});
  const [toolId, setToolId] = useState(ECON_TOOLS.some((x) => x.id === saved.tool) ? saved.tool! : ECON_TOOLS[0].id);
  const [formId, setFormId] = useState<Record<string, string>>(saved.form ?? {});
  const tool = ECON_TOOLS.find((x) => x.id === toolId) ?? ECON_TOOLS[0];
  const current = tool.forms.find((f) => f.id === formId[tool.id]) ?? tool.forms[0];
  const { id, intro, ...props } = current;

  const remember = (nextTool: string, nextForm: Record<string, string>) =>
    saveStored(STORE, { tool: nextTool, form: nextForm });

  return (
    <div className={styles.tool}>
      <label className={extra.field}>
        {tx('common.tool')}
        <select
          className={extra.input}
          value={tool.id}
          onChange={(event) => {
            setToolId(event.target.value);
            remember(event.target.value, formId);
          }}
        >
          {ECON_TOOLS.map((x) => (
            <option key={x.id} value={x.id}>
              {tx(`${x.id}.title`)}
            </option>
          ))}
        </select>
      </label>
      <label className={extra.field}>
        {tx('common.calculator')}
        <select
          className={extra.input}
          value={current.id}
          onChange={(event) => {
            const next = { ...formId, [tool.id]: event.target.value };
            setFormId(next);
            remember(tool.id, next);
          }}
        >
          {tool.forms.map((f) => (
            <option key={f.id} value={f.id}>
              {tx(`${tool.id}.forms.${f.id}`)}
            </option>
          ))}
        </select>
      </label>
      <div className={extra.scroll}>
        <ChemForm key={`${tool.id}.${id}`} {...props} intro={intro ? tx(`${tool.id}.intro.${id}`) : undefined} />
      </div>
    </div>
  );
}
