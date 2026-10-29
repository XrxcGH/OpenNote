// One tool of the kit: its fields, a choice of SI or US units, ready-made examples, the results, and the Insert menu.
// The typed texts are kept on this device for each tool, and the unit system for the whole kit.
import { useEffect, useId, useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, announce, openMenu } from '../../../../ui';
import type { MenuItemSpec } from '../../../../ui';
import type { MechError } from '../kit/errors';
import { PAGE } from '../kit/picture';
import { firstTexts, pinUnits, runTool } from '../kit/read';
import { shownFields, type Field, type ToolSpec } from '../kit/spec';
import { unitOf, type System } from '../kit/units';
import {
  answerLatex,
  answerText,
  extraTable,
  pictureRequest,
  plotPicture,
  plotTitle,
  resultTable,
  sendToPage,
  stepsHtml,
  type InsertContext,
  type Say,
} from './insert';
import { calcData } from './calc';
import { Results } from './Results';
import styles from './mechdyn.module.css';

/** t for keys built at run time. Every key the kit builds exists in strings/en/kitMechDyn.ts (a test checks). */
export const say = t as unknown as Say;

const PREFIX = 'opennote.tools.kitMechDyn.';
/** The page's panel type for a calculation block (PANEL_TYPES.mechDynCalc); the page checks it before it inserts. */
const KIT_CALC_TYPE = 'ext:org.opennote/kitcalc-mechdyn';

function load<T>(name: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + name);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

function save(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // The tool keeps working; it just won't remember.
  }
}

export const errorText = (error: MechError): string => say(`kitMechDyn.errors.${error.key}`, error.vars);

function FieldInput(props: {
  tool: string;
  field: Field;
  text: string;
  system: System;
  problem: MechError | undefined;
  onChange: (text: string) => void;
}) {
  const { tool, field, text, system, problem } = props;
  const id = useId();
  const label = say(`kitMechDyn.${tool}.field.${field.id}`);
  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;
  const hint = field.hint ? say(`kitMechDyn.${tool}.hint.${field.id}`) : '';
  if (field.type === 'choice') {
    return (
      <div className={styles.field}>
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          className={styles.input}
          value={text}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option} value={option}>
              {say(`kitMechDyn.${tool}.option.${option}`)}
            </option>
          ))}
        </select>
        {hint && (
          <span id={hintId} className={styles.hint}>
            {hint}
          </span>
        )}
      </div>
    );
  }
  const unit = field.type === 'quantity' ? unitOf(field.kind, system) : '';
  const many = field.type === 'text' && (field.rows ?? 1) > 1;
  const described = [problem ? problemId : '', hint || unit ? hintId : ''].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    value: text,
    spellCheck: false,
    'aria-invalid': problem ? true : undefined,
    'aria-describedby': described,
  } as const;
  return (
    <div className={field.type === 'text' ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.entry}>
        {many ? (
          <textarea
            {...common}
            className={`${styles.input} ${styles.textarea}`}
            rows={field.type === 'text' ? field.rows : 3}
            onChange={(event) => props.onChange(event.target.value)}
          />
        ) : (
          <input
            {...common}
            type="text"
            inputMode={field.type === 'quantity' ? 'decimal' : 'text'}
            autoComplete="off"
            className={field.type === 'text' ? `${styles.input} ${styles.mono}` : styles.input}
            onChange={(event) => props.onChange(event.target.value)}
          />
        )}
        {unit && (
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
      {problem && (
        <p id={problemId} className={styles.problem}>
          {errorText(problem)}
        </p>
      )}
      {(hint || unit) && (
        <span id={hintId} className={hint ? styles.hint : undefined} hidden={!hint}>
          {hint || say('kitMechDyn.ui.unitHint', { unit })}
        </span>
      )}
    </div>
  );
}

function insertItems(c: InsertContext, texts: Readonly<Record<string, string>>): MenuItemSpec[] {
  const done = (ok: boolean) => announce(say(ok ? 'kitMechDyn.ui.inserted' : 'kitMechDyn.ui.noPage'));
  const items: MenuItemSpec[] = [
    {
      id: 'answer',
      label: say('kitMechDyn.ui.insertAnswer'),
      onSelect: () => done(sendToPage({ text: `${answerText(c)} ` })),
    },
  ];
  const latex = answerLatex(c);
  if (latex)
    items.push({
      id: 'equation',
      label: say('kitMechDyn.ui.insertEquation'),
      onSelect: () => done(sendToPage({ math: { source: latex, display: true } })),
    });
  items.push(
    {
      id: 'table',
      label: say('kitMechDyn.ui.insertTable'),
      onSelect: () => done(sendToPage({ table: resultTable(c) })),
    },
    {
      id: 'steps',
      label: say('kitMechDyn.ui.insertSteps'),
      onSelect: () => done(sendToPage({ text: stepsHtml(c) })),
    },
  );
  // A live block: the answer, with a button that reopens this tool with these inputs.
  items.push({
    id: 'calc',
    label: say('kitMechDyn.ui.insertCalc'),
    onSelect: () => {
      const data = calcData(c, texts);
      done(sendToPage({ panel: { type: KIT_CALC_TYPE, data: { ...data }, fallback: data.summary } }));
    },
  });
  c.outcome.tables?.forEach((table, i) =>
    items.push({
      id: `table-${table.id}`,
      label: say('kitMechDyn.ui.insertNamedTable', { name: say(`kitMechDyn.${c.tool}.table.${table.id}`) }),
      onSelect: () => {
        const extra = extraTable(c, i);
        if (extra) done(sendToPage({ table: extra }));
      },
    }),
  );
  c.outcome.plots?.forEach((plot, i) => {
    const title = plotTitle(say, plot);
    items.push({
      id: `plot-${i}`,
      label: say('kitMechDyn.ui.insertPlot', { name: title }),
      onSelect: () =>
        done(sendToPage({ picture: pictureRequest(plotPicture(say, plot, PAGE), `${c.tool}-${i + 1}.svg`, title) })),
    });
  });
  return items;
}

export function ToolPanel({ tool, spec }: { tool: string; spec: ToolSpec }) {
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...firstTexts(spec), ...load(tool, {}) }));
  const [system, setSystem] = useState<System>(() => (load<string>('system', 'si') === 'us' ? 'us' : 'si'));
  useEffect(() => save(tool, texts), [tool, texts]);
  useEffect(() => save('system', system), [system]);
  const run = useMemo(() => runTool(spec, texts, system), [spec, texts, system]);
  const values = run.ok ? run.values : Object.fromEntries(spec.fields.map((f) => [f.id, texts[f.id] ?? f.first]));
  const problems = new Map(run.ok ? [] : run.fields.map((one) => [one.field, one.error] as const));
  const unitsId = useId();
  const exampleId = useId();
  const changeSystem = (next: System) => {
    if (next === system) return;
    setTexts(pinUnits(spec, texts, system));
    setSystem(next);
  };
  const pickExample = (id: string) => {
    const example = spec.examples?.find((one) => one.id === id);
    if (example) setTexts({ ...firstTexts(spec), ...example.values });
  };
  const openInsert = (anchor: HTMLElement) => {
    if (!run.ok) return;
    const c: InsertContext = { tool, outcome: run.outcome, system, say };
    void openMenu({ label: say('kitMechDyn.ui.insertMenu'), items: insertItems(c, texts), anchor });
  };
  return (
    <div className={styles.panel}>
      <p className={styles.quiet}>{say(`kitMechDyn.${tool}.about`)}</p>
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor={unitsId}>{say('kitMechDyn.ui.units')}</label>
          <select
            id={unitsId}
            className={styles.input}
            value={system}
            onChange={(event) => changeSystem(event.target.value as System)}
          >
            <option value="si">{say('kitMechDyn.ui.si')}</option>
            <option value="us">{say('kitMechDyn.ui.us')}</option>
          </select>
        </div>
        {spec.examples && (
          <div className={styles.field}>
            <label htmlFor={exampleId}>{say('kitMechDyn.ui.example')}</label>
            <select
              id={exampleId}
              className={styles.input}
              value=""
              onChange={(event) => pickExample(event.target.value)}
            >
              <option value="">{say('kitMechDyn.ui.exampleNone')}</option>
              {spec.examples.map((example) => (
                <option key={example.id} value={example.id}>
                  {say(`kitMechDyn.${tool}.example.${example.id}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className={styles.row}>
        {shownFields(spec, values).map((field) => (
          <FieldInput
            key={field.id}
            tool={tool}
            field={field}
            text={texts[field.id] ?? field.first}
            system={system}
            problem={problems.get(field.id)}
            onChange={(text) => setTexts((current) => ({ ...current, [field.id]: text }))}
          />
        ))}
      </div>
      {!run.ok && (
        <p className={styles.problem} role="status">
          {run.error ? errorText(run.error) : say('kitMechDyn.ui.fixFields')}
        </p>
      )}
      {run.ok && (
        <>
          <div className={styles.buttons}>
            <Button variant="primary" aria-haspopup="menu" onClick={(event) => openInsert(event.currentTarget)}>
              {say('kitMechDyn.ui.insert')}
            </Button>
          </div>
          <Results tool={tool} outcome={run.outcome} system={system} say={say} />
        </>
      )}
    </div>
  );
}
