// One tool of the kit: its fields, ready-made examples, the results, and the Insert menu. The typed texts are kept
// on this device for each tool. The tool works the results out from a deferred copy of the texts, so typing stays
// quick while a larger model refits.
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, announce, openMenu } from '../../../../ui';
import type { MenuItemSpec } from '../../../../ui';
import { firstTexts, runTool } from '../kit/read';
import { shownFields, type ToolSpec } from '../kit/spec';
import type { StatError } from '../kit/types';
import { onKitInputs, takeKitInputs } from '../../kits/registry';
import { FieldInput } from './Fields';
import {
  answerLatex,
  answerText,
  extraTable,
  KIT_ID,
  liveBlockRequest,
  pictureName,
  pictureRequest,
  resultTable,
  savedTexts,
  sendToPage,
  stepWords,
  stepsHtml,
  type InsertContext,
  type Say,
} from './insert';
import { Results } from './Results';
import styles from './statmodels.module.css';

/** t for keys built at run time. Every key the kit builds exists in strings/en/kitStatModels.ts (a test checks). */
export const say = t as unknown as Say;

const PREFIX = 'opennote.tools.kitStatModels.';
/** Larger pasted tables are not kept on this device between sessions. */
const MAX_SAVED = 200_000;

function load<T>(name: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + name);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

function save(name: string, value: Record<string, string>): void {
  try {
    const text = JSON.stringify(value);
    if (text.length <= MAX_SAVED) localStorage.setItem(PREFIX + name, text);
  } catch {
    // The tool keeps working; it just will not remember.
  }
}

export function errorText(error: StatError): string {
  const [detail, other = ''] = error.detail.split('|');
  return say(`kitStatModels.error.${error.code}`, { detail, other });
}

function insertItems(c: InsertContext, texts: Readonly<Record<string, string>>): MenuItemSpec[] {
  const done = (ok: boolean) => announce(say(ok ? 'kitStatModels.ui.inserted' : 'kitStatModels.ui.noPage'));
  const item = (id: string, label: string, send: () => boolean): MenuItemSpec => ({
    id,
    label,
    onSelect: () => done(send()),
  });
  const items: MenuItemSpec[] = [
    item('answer', say('kitStatModels.ui.insertAnswer'), () => sendToPage({ text: `${answerText(c)} ` })),
    item('equation', say('kitStatModels.ui.insertEquation'), () =>
      sendToPage({ math: { source: answerLatex(c), display: true } }),
    ),
    item('table', say('kitStatModels.ui.insertTable'), () => sendToPage({ table: resultTable(c) })),
    item('steps', say('kitStatModels.ui.insertSteps'), () => sendToPage({ text: stepsHtml(c) })),
  ];
  const words = c.outcome.words;
  if (words)
    items.push(
      item('words', say('kitStatModels.ui.insertWords'), () => sendToPage({ text: `${stepWords(c, words)} ` })),
    );
  c.outcome.tables?.forEach((table, i) =>
    items.push(
      item(`table-${table.id}`, say(`kitStatModels.${c.tool}.table.${table.id}`), () => {
        const extra = extraTable(c, i);
        return extra ? sendToPage({ table: extra }) : false;
      }),
    ),
  );
  for (const picture of c.outcome.pictures ?? [])
    items.push(
      item(`picture-${picture.id}`, say('kitStatModels.ui.insertPicture', { name: pictureName(c, picture) }), () =>
        sendToPage({ picture: pictureRequest(c, picture) }),
      ),
    );
  items.push(item('live', say('kitStatModels.ui.insertLive'), () => sendToPage({ panel: liveBlockRequest(c, texts) })));
  return items;
}

export function ToolPanel({ tool, spec }: { tool: string; spec: ToolSpec }) {
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...firstTexts(spec), ...load(tool, {}) }));
  useEffect(() => save(tool, texts), [tool, texts]);
  // A live block's Open in tool: take the texts it saved, on opening or while this tool is already showing.
  useEffect(() => {
    const take = () => {
      const saved = savedTexts(takeKitInputs(KIT_ID, tool));
      if (saved) setTexts({ ...firstTexts(spec), ...saved });
    };
    take();
    return onKitInputs(KIT_ID, (which) => {
      if (which === tool) take();
    });
  }, [tool, spec]);
  const deferred = useDeferredValue(texts);
  const run = useMemo(() => runTool(spec, deferred), [spec, deferred]);
  const values = run.ok ? run.values : Object.fromEntries(spec.fields.map((f) => [f.id, texts[f.id] ?? f.first]));
  const problems = new Map(run.ok ? [] : run.fields.map((one) => [one.field, one.error] as const));
  const pickExample = (id: string) => {
    const example = spec.examples?.find((one) => one.id === id);
    if (example) setTexts({ ...firstTexts(spec), ...example.values });
  };
  const openInsert = (anchor: HTMLElement) => {
    if (!run.ok) return;
    const c: InsertContext = { tool, outcome: run.outcome, say };
    void openMenu({ label: say('kitStatModels.ui.insertMenu'), items: insertItems(c, texts), anchor });
  };
  return (
    <div className={styles.panel}>
      {spec.caution && <p className={styles.caution}>{say('kitStatModels.ui.caution')}</p>}
      {spec.examples && (
        <div className={styles.row}>
          <label className={styles.field}>
            <span>{say('kitStatModels.ui.example')}</span>
            <select className={styles.input} value="" onChange={(event) => pickExample(event.target.value)}>
              <option value="">{say('kitStatModels.ui.exampleNone')}</option>
              {spec.examples.map((example) => (
                <option key={example.id} value={example.id}>
                  {say(`kitStatModels.${tool}.example.${example.id}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className={styles.row}>
        {shownFields(spec, values).map((field) => (
          <FieldInput
            key={field.id}
            tool={tool}
            field={field}
            text={texts[field.id] ?? field.first}
            texts={texts}
            problem={problems.get(field.id)}
            say={say}
            errorText={errorText}
            onChange={(text) => setTexts((current) => ({ ...current, [field.id]: text }))}
          />
        ))}
      </div>
      {!run.ok && (
        <p className={styles.problem} role="status">
          {run.error ? errorText(run.error) : say('kitStatModels.ui.fixFields')}
        </p>
      )}
      {run.ok && (
        <>
          <div className={styles.buttons}>
            <Button variant="primary" aria-haspopup="menu" onClick={(event) => openInsert(event.currentTarget)}>
              {say('kitStatModels.ui.insert')}
            </Button>
          </div>
          <Results tool={tool} outcome={run.outcome} say={say} />
        </>
      )}
    </div>
  );
}
