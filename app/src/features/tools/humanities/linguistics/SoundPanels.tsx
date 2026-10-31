// The linguistics panels for sound: the feature chart and natural classes, ordered rules with a derivation table,
// syllables by sonority, and vowel charts from formants.
import '../text';
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { attempt, errorText, fixed } from '../ui/attempt';
import { Choice, DataTable, Field, Fields, InsertBar, Note, Picture, Problem, Results, Steps, ht } from '../ui/parts';
import { vowelSvg } from './draw';
import {
  FEATURES,
  bundleText,
  checkClass,
  difference,
  editInventory,
  naturalClass,
  parseBundle,
  segments,
} from './features';
import type { Inventory } from './features';
import { derive } from './rules';
import { syllabify } from './syllables';
import { normalize, parseFormants, vowelMeans } from './vowels';
import type { Scale } from './vowels';

const k = 'kitHumanities.linguistics';
const fail = (code: string) => <Problem text={errorText('linguistics', code)} />;

export function useInventory(): [string, (next: string) => void, ReturnType<typeof attempt<Inventory>>] {
  const [edits, setEdits] = useState('');
  return [edits, setEdits, attempt(() => editInventory(edits))];
}

function EditsField({ value, onChange }: { value: string; onChange(next: string): void }) {
  return <Field label={t(`${k}.edits`)} value={value} onChange={onChange} rows={2} mono hint={t(`${k}.editsHint`)} />;
}

export function FeaturePanel() {
  const [edits, setEdits, inventory] = useInventory();
  const [bundle, setBundle] = useState('[+voice -sonorant +continuant]');
  const [set, setSet] = useState('m n ŋ');
  const [pair, setPair] = useState('p b');
  if (!inventory.ok) {
    return (
      <>
        <EditsField value={edits} onChange={setEdits} />
        {fail(inventory.code)}
      </>
    );
  }
  const inv = inventory.value;
  const members = attempt(() => naturalClass(parseBundle(bundle), inv));
  const check = attempt(() => checkClass(segments(set, inv), inv));
  const diff = attempt(() => {
    const [a, b] = segments(pair, inv);
    if (!a || !b) throw new Error('pair');
    return { a, b, list: difference(a, b, inv) };
  });
  const chart = [...inv].map(([seg, f]) => [seg, ...FEATURES.map((name) => f[name])]);
  return (
    <>
      <Fields>
        <Field label={t(`${k}.bundle`)} value={bundle} onChange={setBundle} mono hint={t(`${k}.bundleHint`)} />
        <Field label={t(`${k}.segmentSet`)} value={set} onChange={setSet} mono />
        <Field label={t(`${k}.segmentPair`)} value={pair} onChange={setPair} mono />
      </Fields>
      {members.ok ? (
        <Note>
          {members.value.length === 0
            ? t(`${k}.classEmpty`)
            : t(`${k}.classMembers`, { bundle, members: members.value.join(' ') })}
        </Note>
      ) : (
        fail(members.code)
      )}
      {check.ok ? (
        <Note>
          {check.value.unknown.length > 0
            ? t(`${k}.unknownSegments`, { list: check.value.unknown.join(' ') })
            : t(check.value.natural ? `${k}.natural` : `${k}.notNatural`, {
                shared: bundleText(check.value.shared),
                members: check.value.members.join(' '),
              })}
        </Note>
      ) : (
        fail(check.code)
      )}
      {diff.ok ? (
        <Note>
          {diff.value.list.length === 0
            ? t(`${k}.noDifference`)
            : t(`${k}.difference`, {
                a: diff.value.a,
                b: diff.value.b,
                list: diff.value.list.map((d) => `${d.a}${d.feature} / ${d.b}${d.feature}`).join(', '),
              })}
        </Note>
      ) : (
        fail(diff.code)
      )}
      <EditsField value={edits} onChange={setEdits} />
      <DataTable caption={t(`${k}.chartTitle`)} header={[t(`${k}.headerSegment`), ...FEATURES]} rows={chart} />
      <Note>{t(`${k}.chartNote`)}</Note>
      <InsertBar payloads={{ table: { header: [t(`${k}.headerSegment`), ...FEATURES], rows: chart } }} />
    </>
  );
}

export function RulePanel() {
  const [edits, setEdits, inventory] = useInventory();
  const [rules, setRules] = useState('a -> e / _ C i\ni -> 0 / _ #');
  const [forms, setForms] = useState('/tapi/\n/tapa/');
  const result = inventory.ok ? attempt(() => derive(rules, forms, inventory.value)) : inventory;
  return (
    <>
      <Field label={t(`${k}.rules`)} value={rules} onChange={setRules} rows={4} mono hint={t(`${k}.rulesHint`)} />
      <Field label={t(`${k}.forms`)} value={forms} onChange={setForms} rows={3} mono hint={t(`${k}.formsHint`)} />
      <EditsField value={edits} onChange={setEdits} />
      {result.ok ? <Derivations result={result.value} /> : fail(result.code)}
    </>
  );
}

function Derivations({ result }: { result: ReturnType<typeof derive> }) {
  const header = [t(`${k}.headerStage`), ...result.rows.map((r) => `/${r.underlying}/`)];
  const rows = [
    ...result.rules.map((rule, i) => [`${i + 1}. ${rule.text}`, ...result.rows.map((r) => r.stages[i] ?? '—')]),
    [t(`${k}.surface`), ...result.rows.map((r) => `[${r.surface}]`)],
  ];
  const steps = result.rows.flatMap((r) =>
    r.stages.flatMap((stage, i) =>
      stage === null ? [] : [t(`${k}.ruleStep`, { form: r.underlying, rule: i + 1, result: stage })],
    ),
  );
  const notes = result.rows.flatMap((r) =>
    r.interactions.map((x) =>
      t(`${k}.interaction`, {
        form: r.underlying,
        first: x.first,
        second: x.second,
        kind: ht(`linguistics.interactions.${x.kind}`),
      }),
    ),
  );
  return (
    <>
      <DataTable caption={t(`${k}.derivation`)} header={header} rows={rows} />
      {notes.map((n) => (
        <Note key={n}>{n}</Note>
      ))}
      <Steps steps={steps.length > 0 ? steps : [t(`${k}.noChange`)]} />
      <InsertBar
        payloads={{ answer: result.rows.map((r) => `[${r.surface}]`).join(', '), table: { header, rows }, steps }}
      />
    </>
  );
}

export function SyllablePanel() {
  const [edits, setEdits, inventory] = useInventory();
  const [word, setWord] = useState('panda');
  const [onsets, setOnsets] = useState('p, n, d');
  const result = inventory.ok ? attempt(() => syllabify(word, onsets, inventory.value)) : inventory;
  return (
    <>
      <Fields>
        <Field label={t(`${k}.word`)} value={word} onChange={setWord} mono />
        <Field label={t(`${k}.onsets`)} value={onsets} onChange={setOnsets} mono hint={t(`${k}.onsetsHint`)} />
      </Fields>
      <EditsField value={edits} onChange={setEdits} />
      {result.ok ? (
        <>
          <Results
            label={t('kitHumanities.common.results')}
            rows={[[t(`${k}.rows.syllables`), result.value.syllables.map((s) => s.join('')).join('.')]]}
          />
          <Steps
            steps={[
              t(onsets.trim() === '' ? `${k}.sonorityStep` : `${k}.onsetStep`),
              ...result.value.splits.map((s) =>
                t(`${k}.splitStep`, { cluster: s.cluster || '∅', coda: s.coda || '∅', onset: s.onset || '∅' }),
              ),
            ]}
          />
          <InsertBar payloads={{ answer: result.value.syllables.map((s) => s.join('')).join('.') }} />
        </>
      ) : (
        fail(result.code)
      )}
    </>
  );
}

export function VowelPanel() {
  const [text, setText] = useState(() => ht('linguistics.formantExample'));
  const [scale, setScale] = useState<Scale>('hz');
  const result = attempt(() => {
    const points = normalize(parseFormants(text), scale);
    return { points, means: vowelMeans(points) };
  });
  const unit = ht(`linguistics.scaleUnits.${scale}`);
  return (
    <>
      <Field label={t(`${k}.formants`)} value={text} onChange={setText} rows={6} mono hint={t(`${k}.formantsHint`)} />
      <Choice<Scale>
        label={t(`${k}.scale`)}
        value={scale}
        options={(['hz', 'lobanov', 'bark'] as const).map((value) => ({
          value,
          label: ht(`linguistics.scales.${value}`),
        }))}
        onChange={setScale}
      />
      {result.ok ? <VowelResult {...result.value} unit={unit} scale={scale} /> : fail(result.code)}
    </>
  );
}

function VowelResult(props: {
  points: ReturnType<typeof normalize>;
  means: ReturnType<typeof vowelMeans>;
  unit: string;
  scale: Scale;
}) {
  const { points, means, unit, scale } = props;
  const digits = scale === 'hz' ? 0 : 3;
  const svg = vowelSvg(points, means, {
    title: t(`${k}.vowelTitle`),
    f1: t(`${k}.axisF1`, { unit }),
    f2: t(`${k}.axisF2`, { unit }),
  });
  const alt = t(`${k}.vowelAlt`, { list: means.map((m) => m.vowel).join(' ') });
  const header = [t(`${k}.headerVowel`), `F1 (${unit})`, `F2 (${unit})`, t(`${k}.headerTokens`)];
  const rows = means.map((m) => [m.vowel, fixed(m.y, digits), fixed(m.x, digits), String(m.n)]);
  return (
    <>
      <Picture svg={svg} alt={alt} />
      <DataTable caption={t(`${k}.vowelTitle`)} header={header} rows={rows} />
      <Steps steps={[ht(`linguistics.scaleSteps.${scale}`)]} />
      <InsertBar payloads={{ table: { header, rows }, picture: { svg, name: 'vowel-chart', alt } }} />
    </>
  );
}
