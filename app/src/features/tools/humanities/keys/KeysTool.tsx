// Identification keys: type or pick a character table, then read the key it makes and run it couplet by couplet.
// Filter with a multi-access key, and keep a catalog of what was identified.
import { useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import { attempt, errorText, num, sig } from '../ui/attempt';
import { insertTable, insertText } from '../ui/insert';
import {
  Choice,
  DataTable,
  Field,
  Fields,
  InsertBar,
  Note,
  Picture,
  Problem,
  Results,
  Steps,
  Tabs,
  Tool,
  announceInsert,
  ht,
} from '../ui/parts';
import styles from '../ui/kit.module.css';
import { buildKey, couplets, parseMatrix, remaining, walk } from './engine';
import type { Answer, DichotomousKey, Lead, Matrix } from './engine';
import { keyLines, keySvg } from './print';

type Tab = 'table' | 'key' | 'multi' | 'catalog';
const TABS: readonly Tab[] = ['table', 'key', 'multi', 'catalog'];
const TEMPLATES = ['letters', 'instruments', 'minerals', 'artifacts', 'taxa'] as const;
type Template = (typeof TEMPLATES)[number];
const k = 'kitHumanities.keys';

const describe = (character: string, lead: Lead): string => {
  if (lead.kind === 'states') return t(`${k}.leadStates`, { character, states: lead.states.join(` ${t(`${k}.or`)} `) });
  const value = sig(lead.value, 6);
  return lead.kind === 'atMost'
    ? t(`${k}.leadAtMost`, { character, value })
    : t(`${k}.leadAbove`, { character, value });
};

const names = (matrix: Matrix, taxa: readonly number[]) => taxa.map((taxon) => matrix.taxa[taxon]!).join(', ');

function TablePanel({ text, setText }: { text: string; setText(next: string): void }) {
  const [template, setTemplate] = useState<Template>('letters');
  const parsed = attempt(() => parseMatrix(text));
  return (
    <>
      <Fields>
        <Choice<Template>
          label={t(`${k}.template`)}
          value={template}
          options={TEMPLATES.map((id) => ({ value: id, label: ht(`keys.templates.${id}`) }))}
          onChange={setTemplate}
        />
      </Fields>
      <div className={styles.actions}>
        <Button variant="quiet" onClick={() => setText(ht(`keys.tables.${template}`))}>
          {t(`${k}.use`)}
        </Button>
      </div>
      <Field label={t(`${k}.table`)} value={text} onChange={setText} rows={8} mono hint={t(`${k}.tableHint`)} />
      {parsed.ok ? (
        <Note>{t(`${k}.summary`, { taxa: parsed.value.taxa.length, characters: parsed.value.characters.length })}</Note>
      ) : (
        <Problem text={errorText('keys', parsed.code)} />
      )}
      <Note>{t(`${k}.source`)}</Note>
    </>
  );
}

function Runner({
  matrix,
  keyed,
  onIdentified,
}: {
  matrix: Matrix;
  keyed: DichotomousKey;
  onIdentified(name: string): void;
}) {
  const [path, setPath] = useState<(0 | 1)[]>([]);
  const node = attempt(() => walk(keyed.root, path));
  if (!node.ok) return <Problem text={errorText('keys', node.code)} />;
  const here = node.value;
  const trail = path.map((side, index) => {
    const couplet = walk(keyed.root, path.slice(0, index));
    return couplet.kind === 'couplet' ? `${couplet.number}${side === 0 ? 'a' : 'b'}` : '';
  });
  return (
    <div role="group" aria-label={t(`${k}.run`)} className={styles.group}>
      <strong>{t(`${k}.run`)}</strong>
      {trail.length > 0 ? <Note>{`${t(`${k}.trail`)}: ${trail.join(', ')}`}</Note> : null}
      {here.kind === 'couplet' ? (
        <>
          <span>{t(`${k}.couplet`, { number: here.number })}</span>
          <div className={styles.actions}>
            {here.split.leads.map((lead, side) => (
              <Button key={side} variant="quiet" onClick={() => setPath([...path, side as 0 | 1])}>
                {`${here.number}${side === 0 ? 'a' : 'b'}. ${describe(matrix.characters[here.split.character]!.name, lead)}`}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p role="status">
          {here.taxa.length === 1
            ? t(`${k}.reached`, { name: matrix.taxa[here.taxa[0]!]! })
            : t(`${k}.unresolved`, { names: names(matrix, here.taxa) })}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="quiet" disabled={path.length === 0} onClick={() => setPath(path.slice(0, -1))}>
          {t(`${k}.back`)}
        </Button>
        <Button variant="quiet" disabled={path.length === 0} onClick={() => setPath([])}>
          {t(`${k}.restart`)}
        </Button>
        {here.kind === 'end' && here.taxa.length === 1 ? (
          <Button variant="quiet" onClick={() => onIdentified(matrix.taxa[here.taxa[0]!]!)}>
            {t(`${k}.addToCatalog`)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function KeyPanel({ matrix, onIdentified }: { matrix: Matrix; onIdentified(name: string): void }) {
  const keyed = useMemo(() => buildKey(matrix), [matrix]);
  const list = couplets(keyed.root);
  const or = t(`${k}.or`);
  const lines = keyLines(list, matrix, describe, or);
  const svg = keySvg(keyed.root, matrix, t(`${k}.picture`), or);
  const alt = t(`${k}.pictureAlt`, { couplets: keyed.couplets });
  const steps = list.map((couplet) =>
    t(`${k}.why`, {
      number: couplet.number,
      character: matrix.characters[couplet.split.character]!.name,
      before: couplet.taxa.length,
      first: couplet.split.sides[0].length,
      second: couplet.split.sides[1].length,
      gain: sig(couplet.split.gain, 3),
    }),
  );
  return (
    <>
      <Note>{t(`${k}.keySummary`, { couplets: keyed.couplets, depth: keyed.depth })}</Note>
      {keyed.inseparable.length === 0 ? (
        <Note>{t(`${k}.allSeparated`)}</Note>
      ) : (
        keyed.inseparable.map((group) => (
          <Problem key={group.join()} text={t(`${k}.inseparable`, { names: names(matrix, group) })} />
        ))
      )}
      {lines.length > 0 ? (
        <div role="region" aria-label={t(`${k}.keyText`)} className={styles.group}>
          <strong>{t(`${k}.keyText`)}</strong>
          <ol className={styles.lines}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      ) : null}
      <Picture svg={svg} alt={alt} />
      <Steps steps={[...steps, t(`${k}.whyHint`)]} />
      <Runner key={lines.join()} matrix={matrix} keyed={keyed} onIdentified={onIdentified} />
      <div className={styles.actions}>
        <Button variant="quiet" onClick={() => announceInsert(insertText(lines.join('\n')))}>
          {t(`${k}.insertKey`)}
        </Button>
      </div>
      <InsertBar payloads={{ steps, picture: { svg, name: 'identification-key', alt } }} />
    </>
  );
}

const ANY = '';

function MultiPanel({ matrix }: { matrix: Matrix }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const parsed = attempt(() => {
    const map = new Map<number, Answer>();
    for (const [index, text] of Object.entries(answers)) {
      if (text === ANY) continue;
      const character = matrix.characters[Number(index)];
      if (!character) continue;
      map.set(Number(index), character.numeric ? { kind: 'value', value: num(text) } : { kind: 'state', state: text });
    }
    return remaining(matrix, map);
  });
  const set = (index: number, value: string) => setAnswers({ ...answers, [index]: value });
  return (
    <>
      <Fields>
        {matrix.characters.map((character, index) =>
          character.numeric ? (
            <Field
              key={index}
              label={`${character.name} (${t(`${k}.measured`)})`}
              value={answers[index] ?? ''}
              onChange={(value) => set(index, value)}
              numeric
            />
          ) : (
            <Choice<string>
              key={index}
              label={character.name}
              value={answers[index] ?? ANY}
              options={[
                { value: ANY, label: t(`${k}.any`) },
                ...character.states.map((state) => ({ value: state, label: state })),
              ]}
              onChange={(value) => set(index, value)}
            />
          ),
        )}
      </Fields>
      <div className={styles.actions}>
        <Button variant="quiet" onClick={() => setAnswers({})}>
          {t(`${k}.clear`)}
        </Button>
      </div>
      {!parsed.ok ? (
        <Problem text={errorText('keys', parsed.code)} />
      ) : parsed.value.length === 0 ? (
        <Problem text={t(`${k}.contradictory`)} />
      ) : (
        <Results
          label={t(`${k}.candidates`, { count: parsed.value.length })}
          rows={[[t(`${k}.candidates`, { count: parsed.value.length }), names(matrix, parsed.value)]]}
        />
      )}
    </>
  );
}

const CATALOG_COLUMNS = ['id', 'locality', 'date', 'collector', 'determination'] as const;

function splitRow(line: string): string[] {
  const cells = line.split(line.includes('\t') ? '\t' : ',').map((cell) => cell.trim());
  return CATALOG_COLUMNS.map((_, index) => cells[index] ?? '');
}

function CatalogPanel({ text, setText }: { text: string; setText(next: string): void }) {
  const header = CATALOG_COLUMNS.map((column) => ht(`keys.catalogHeader.${column}`));
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(splitRow);
  return (
    <>
      <Field label={t(`${k}.catalog`)} value={text} onChange={setText} rows={6} mono hint={t(`${k}.catalogHint`)} />
      {rows.length > 0 ? <DataTable caption={t(`${k}.catalog`)} header={header} rows={rows} /> : null}
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={rows.length === 0}
          onClick={() => announceInsert(insertTable(header, rows))}
        >
          {t(`${k}.insertCatalog`)}
        </Button>
      </div>
    </>
  );
}

export function KeysTool() {
  const [tab, setTab] = useState<Tab>('table');
  const [text, setText] = useState(() => ht('keys.tables.letters'));
  const [catalog, setCatalog] = useState('');
  const parsed = useMemo(() => attempt(() => parseMatrix(text)), [text]);
  const identified = (name: string) => {
    const next = catalog.split(/\r?\n/).filter((line) => line.trim() !== '').length + 1;
    setCatalog(`${catalog.trimEnd()}${catalog.trim() === '' ? '' : '\n'}${next}, , , , ${name}`);
    setTab('catalog');
  };
  return (
    <Tool label={t(`${k}.title`)}>
      <Tabs<Tab>
        label={t(`${k}.modes`)}
        items={TABS.map((id) => ({ id, label: ht(`keys.tabs.${id}`) }))}
        value={tab}
        onChange={setTab}
      />
      {tab === 'table' ? <TablePanel text={text} setText={setText} /> : null}
      {tab === 'catalog' ? <CatalogPanel text={catalog} setText={setCatalog} /> : null}
      {(tab === 'key' || tab === 'multi') && !parsed.ok ? <Problem text={errorText('keys', parsed.code)} /> : null}
      {tab === 'key' && parsed.ok ? <KeyPanel matrix={parsed.value} onIdentified={identified} /> : null}
      {tab === 'multi' && parsed.ok ? <MultiPanel matrix={parsed.value} /> : null}
    </Tool>
  );
}
