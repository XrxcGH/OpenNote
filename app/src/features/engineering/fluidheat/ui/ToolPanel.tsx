// One tool of the kit: its fields, a choice of SI or US units, ready-made examples, the results, and the Insert
// menu. The typed texts are kept on this device for each tool, and the unit system for the whole kit.
import '../text';
import { useEffect, useId, useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { followKitForm } from '../../../tools';
import { Button, announce, openMenu } from '../../../../ui';
import type { MenuItemSpec } from '../../../../ui';
import { PAGE } from '../kit/picture';
import { firstTexts, pinUnits, runTool } from '../kit/read';
import { shownFields, type Field, type ToolSpec } from '../kit/spec';
import type { FluidHeatError } from '../kit/types';
import { unitOf, type System } from '../kit/units';
import {
  answerLatex,
  answerText,
  answerHtml,
  extraTable,
  pictureRequest,
  resultTable,
  sendToPage,
  stepsHtml,
  type InsertContext,
  type Say,
} from './insert';
import { Results, pictureSvg } from './Results';
import { FLUIDHEAT_TOOLS } from '../meta';
import styles from './fluidheat.module.css';

/** t for keys built at run time. Every key the kit builds exists in strings/en/kitFluidHeat.ts (a test checks). */
export const say = t as unknown as Say;

const PREFIX = 'opennote.tools.kitFluidHeat.';

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
    // The tool keeps working; it just will not remember.
  }
}

export function errorText(error: FluidHeatError): string {
  const [detail, other = ''] = error.detail.split('|');
  return say(`kitFluidHeat.error.${error.code}`, { detail, other });
}

function FieldInput(props: {
  tool: string;
  field: Field;
  text: string;
  system: System;
  problem: FluidHeatError | undefined;
  onChange: (text: string) => void;
}) {
  const { tool, field, text, system, problem } = props;
  const id = useId();
  const label = say(`kitFluidHeat.${tool}.field.${field.id}`);
  if (field.type === 'choice') {
    // A choice with long options takes the whole row, so the window's width does not cut the option off.
    const options = field.options.map((option) => say(`kitFluidHeat.${tool}.option.${option}`));
    const long = options.some((one) => one.length > 14);
    return (
      <label className={long ? `${styles.field} ${styles.wide}` : styles.field}>
        <span>{label}</span>
        <select className={styles.input} value={text} onChange={(event) => props.onChange(event.target.value)}>
          {field.options.map((option, index) => (
            <option key={option} value={option}>
              {options[index]}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const describedBy = problem ? `${id}-problem` : `${id}-hint`;
  const hint =
    field.type === 'text' ? say(`kitFluidHeat.${tool}.hint.${field.id}`, { length: unitOf('length', system) }) : '';
  const unit = field.type === 'quantity' ? unitOf(field.kind, system) : '';
  return (
    <div className={field.type === 'text' ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.entry}>
        {field.type === 'text' ? (
          <textarea
            id={id}
            className={`${styles.input} ${styles.textarea}`}
            rows={field.rows}
            value={text}
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => props.onChange(event.target.value)}
          />
        ) : (
          <input
            id={id}
            type="text"
            inputMode="decimal"
            className={styles.input}
            value={text}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={problem ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => props.onChange(event.target.value)}
          />
        )}
        {unit && (
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
      {problem ? (
        <p id={`${id}-problem`} className={styles.problem}>
          {errorText(problem)}
        </p>
      ) : (
        <span id={`${id}-hint`} hidden={field.type !== 'text'}>
          {field.type === 'text' ? hint : say('kitFluidHeat.ui.unitHint', { unit: unit || '1' })}
        </span>
      )}
    </div>
  );
}

/** Keeps this calculation as a live block in the page: Open in tool brings these texts and units back. */
async function insertLive(c: InsertContext, texts: Readonly<Record<string, string>>): Promise<boolean> {
  const tools = await import('../../../tools');
  const kits = await tools.loadKits();
  const title = FLUIDHEAT_TOOLS.find((one) => one.id === c.tool)?.title;
  return kits.insertLiveBlock({
    kit: 'fluidheat',
    tool: c.tool,
    title: title ? say(title) : c.tool,
    summary: answerText(c),
    inputs: { texts: { ...texts }, system: c.system },
    latex: answerLatex(c),
  });
}

function insertItems(c: InsertContext, texts: Readonly<Record<string, string>>): MenuItemSpec[] {
  const done = (ok: boolean) => announce(say(ok ? 'kitFluidHeat.ui.inserted' : 'kitFluidHeat.ui.noPage'));
  const items: MenuItemSpec[] = [
    {
      id: 'answer',
      label: say('kitFluidHeat.ui.insertAnswer'),
      onSelect: () => done(sendToPage({ text: answerHtml(c) })),
    },
    {
      id: 'equation',
      label: say('kitFluidHeat.ui.insertEquation'),
      onSelect: () => done(sendToPage({ math: { source: answerLatex(c), display: true } })),
    },
    {
      id: 'table',
      label: say('kitFluidHeat.ui.insertTable'),
      onSelect: () => done(sendToPage({ table: resultTable(c) })),
    },
    {
      id: 'steps',
      label: say('kitFluidHeat.ui.insertSteps'),
      onSelect: () => done(sendToPage({ text: stepsHtml(c) })),
    },
  ];
  c.outcome.tables?.forEach((table, i) =>
    items.push({
      id: `table-${table.id}`,
      label: say(`kitFluidHeat.${c.tool}.table.${table.id}`),
      onSelect: () => {
        const extra = extraTable(c, i);
        if (extra) done(sendToPage({ table: extra }));
      },
    }),
  );
  const svgText = pictureSvg(c, PAGE);
  if (svgText) {
    const alt = say(`kitFluidHeat.${c.tool}.picture`);
    items.push({
      id: 'picture',
      label: say('kitFluidHeat.ui.insertPicture'),
      onSelect: () => done(sendToPage({ picture: pictureRequest(svgText, `${c.tool}.svg`, alt) })),
    });
  }
  items.push({
    id: 'live',
    label: say('kitFluidHeat.ui.insertLive'),
    onSelect: () => void insertLive(c, texts).then(done),
  });
  return items;
}

export function ToolPanel({ tool, spec }: { tool: string; spec: ToolSpec }) {
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...firstTexts(spec), ...load(tool, {}) }));
  const [system, setSystem] = useState<System>(() => (load<string>('system', 'si') === 'us' ? 'us' : 'si'));
  // A live calculation block in a page put its values back: read them again.
  useEffect(
    () =>
      followKitForm('fluidheat', tool, () => {
        setTexts({ ...firstTexts(spec), ...load(tool, {}) });
        setSystem(load<string>('system', 'si') === 'us' ? 'us' : 'si');
      }),
    [tool, spec],
  );
  useEffect(() => save(tool, texts), [tool, texts]);
  useEffect(() => save('system', system), [system]);
  const run = useMemo(() => runTool(spec, texts, system), [spec, texts, system]);
  const values = run.ok ? run.values : Object.fromEntries(spec.fields.map((f) => [f.id, texts[f.id] ?? f.first]));
  const problems = new Map(run.ok ? [] : run.fields.map((one) => [one.field, one.error] as const));
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
    void openMenu({ label: say('kitFluidHeat.ui.insertMenu'), items: insertItems(c, texts), anchor });
  };
  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{say('kitFluidHeat.ui.units')}</span>
          <select
            className={styles.input}
            value={system}
            onChange={(event) => changeSystem(event.target.value as System)}
          >
            <option value="si">{say('kitFluidHeat.ui.si')}</option>
            <option value="us">{say('kitFluidHeat.ui.us')}</option>
          </select>
        </label>
        {spec.examples && (
          <label className={styles.field}>
            <span>{say('kitFluidHeat.ui.example')}</span>
            <select className={styles.input} value="" onChange={(event) => pickExample(event.target.value)}>
              <option value="">{say('kitFluidHeat.ui.exampleNone')}</option>
              {spec.examples.map((example) => (
                <option key={example.id} value={example.id}>
                  {say(`kitFluidHeat.${tool}.example.${example.id}`)}
                </option>
              ))}
            </select>
          </label>
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
          {run.error ? errorText(run.error) : say('kitFluidHeat.ui.fixFields')}
        </p>
      )}
      {run.ok && (
        <>
          <div className={styles.buttons}>
            <Button variant="primary" aria-haspopup="menu" onClick={(event) => openInsert(event.currentTarget)}>
              {say('kitFluidHeat.ui.insert')}
            </Button>
          </div>
          <Results tool={tool} outcome={run.outcome} system={system} say={say} />
        </>
      )}
    </div>
  );
}
