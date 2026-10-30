// The converting panels: romanization tables, Korean, Japanese, Chinese pinyin, Thai tones, and Vietnamese input.
// Each shows the result, the rules it used as steps, and the insert buttons.
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { attempt, errorText } from '../ui/attempt';
import { Check, Choice, DataTable, Field, InsertBar, Problem, Results, Steps, ht } from '../ui/parts';
import { decompose, romanizeKorean } from './hangul';
import { KANA_CHART, hepburn, toKana, toKatakana } from './kana';
import { sandhi, toMarks } from './pinyin';
import { thaiTone } from './thai';
import type { Scheme } from './translit';
import { cyrillicFromAlaLc, romanize } from './translit';
import { vietnamese } from './vietnamese';
import type { Method } from './vietnamese';

const k = 'kitHumanities.scripts';
const fail = (code: string) => <Problem text={errorText('scripts', code)} />;

function Answer({ rows, steps, answer }: { rows: [string, string][]; steps: string[]; answer: string }) {
  return (
    <>
      <Results label={t('kitHumanities.common.results')} rows={rows} />
      <Steps steps={steps} />
      <InsertBar payloads={{ answer, steps }} />
    </>
  );
}

type RomanScheme = Scheme | 'ru-reverse';
const SCHEMES: readonly RomanScheme[] = [
  'ru-alalc',
  'ru-bgn',
  'ru-reverse',
  'el-alalc',
  'hi-alalc',
  'hy-alalc',
  'ka-alalc',
];

export function RomanizePanel() {
  const [scheme, setScheme] = useState<RomanScheme>('ru-alalc');
  const [text, setText] = useState(() => ht(`scripts.samples.${'ru-alalc'}`));
  const choose = (next: RomanScheme) => {
    setScheme(next);
    setText(ht(`scripts.samples.${next}`));
  };
  const result = attempt(() => (scheme === 'ru-reverse' ? cyrillicFromAlaLc(text) : romanize(text, scheme)));
  return (
    <>
      <Choice<RomanScheme>
        label={t(`${k}.scheme`)}
        value={scheme}
        options={SCHEMES.map((value) => ({ value, label: ht(`scripts.schemes.${value}`) }))}
        onChange={choose}
      />
      <Field label={t(`${k}.source`)} value={text} onChange={setText} rows={2} />
      {result.ok ? (
        <Answer
          rows={[[t(`${k}.result`), result.value]]}
          steps={[ht(`scripts.schemeSteps.${scheme}`), t(`${k}.sourceNote`)]}
          answer={result.value}
        />
      ) : (
        fail(result.code)
      )}
    </>
  );
}

export function KoreanPanel() {
  const [text, setText] = useState('독립문');
  const [name, setName] = useState(true);
  const result = attempt(() => {
    const rr = romanizeKorean(text, 'rr', name);
    const mr = romanizeKorean(text, 'mr', name);
    const syllables = [...text].filter((c) => c >= '가' && c <= '힣');
    return { rr, mr, syllables };
  });
  if (!result.ok) {
    return (
      <>
        <Field label={t(`${k}.hangul`)} value={text} onChange={setText} hint={t(`${k}.hangulHint`)} />
        {fail(result.code)}
      </>
    );
  }
  const { rr, mr, syllables } = result.value;
  const rows = syllables.map((s) => {
    const j = decompose(s);
    return [s, `U+${s.codePointAt(0)?.toString(16).toUpperCase()}`, String(j.l), String(j.v), String(j.t)];
  });
  const steps = [
    t(`${k}.hangulFormula`),
    ...rr.rules.map((rule) => ht(`scripts.soundRules.${rule}`)),
    rr.rules.length === 0 ? t(`${k}.noSoundRules`) : '',
  ].filter(Boolean);
  return (
    <>
      <Field label={t(`${k}.hangul`)} value={text} onChange={setText} hint={t(`${k}.hangulHint`)} />
      <Check label={t(`${k}.asName`)} checked={name} onChange={setName} />
      <Results
        label={t('kitHumanities.common.results')}
        rows={[
          [t(`${k}.rr`), rr.text],
          [t(`${k}.mr`), mr.text],
        ]}
      />
      <DataTable
        caption={t(`${k}.jamoTable`)}
        header={[t(`${k}.syllable`), t(`${k}.codePoint`), 'L', 'V', 'T']}
        rows={rows}
      />
      <Steps steps={steps} />
      <InsertBar payloads={{ answer: `${rr.text} (${mr.text})`, steps }} />
    </>
  );
}

type KanaDirection = 'toRomaji' | 'toKana';

export function JapanesePanel() {
  const [direction, setDirection] = useState<KanaDirection>('toRomaji');
  const [text, setText] = useState('とうきょう');
  const result = attempt(() => {
    if (direction === 'toRomaji') return { main: hepburn(text), extra: '' };
    const kana = toKana(text);
    return { main: kana, extra: toKatakana(kana) };
  });
  const chart = KANA_CHART.map((row) => row.kana.map((kana, i) => `${kana} ${row.romaji[i]}`));
  const width = Math.max(...chart.map((r) => r.length));
  const padded = chart.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
  return (
    <>
      <Choice<KanaDirection>
        label={t(`${k}.direction`)}
        value={direction}
        options={(['toRomaji', 'toKana'] as const).map((value) => ({
          value,
          label: ht(`scripts.directions.${value}`),
        }))}
        onChange={(next) => {
          setDirection(next);
          setText(next === 'toRomaji' ? 'とうきょう' : 'kyouto');
        }}
      />
      <Field label={t(`${k}.source`)} value={text} onChange={setText} />
      {result.ok ? (
        <Answer
          rows={[
            [t(direction === 'toRomaji' ? `${k}.hepburn` : `${k}.hiragana`), result.value.main],
            ...(result.value.extra ? [[t(`${k}.katakana`), result.value.extra] as [string, string]] : []),
          ]}
          steps={[t(`${k}.hepburnSteps`)]}
          answer={result.value.main}
        />
      ) : (
        fail(result.code)
      )}
      <DataTable caption={t(`${k}.kanaChart`)} header={['a', 'i', 'u', 'e', 'o'].slice(0, width)} rows={padded} />
    </>
  );
}

export function ChinesePanel() {
  const [text, setText] = useState('ni3 hao3, yi1 ge4 xue2 sheng5');
  const result = attempt(() => ({ marks: toMarks(text), spoken: sandhi(text) }));
  if (!result.ok) {
    return (
      <>
        <Field label={t(`${k}.pinyin`)} value={text} onChange={setText} hint={t(`${k}.pinyinHint`)} />
        {fail(result.code)}
      </>
    );
  }
  const { marks, spoken } = result.value;
  const spokenText = toMarks(spoken.syllables.map((s) => `${s.letters}${s.tone}`).join(' '));
  const steps = [
    t(`${k}.markRule`),
    ...spoken.changes.map((c) =>
      ht(`scripts.sandhiRules.${c.rule}`, { syllable: spoken.syllables[c.index].letters, from: c.from, to: c.to }),
    ),
  ];
  return (
    <>
      <Field label={t(`${k}.pinyin`)} value={text} onChange={setText} hint={t(`${k}.pinyinHint`)} />
      <Answer
        rows={[
          [t(`${k}.citation`), marks],
          [t(`${k}.spoken`), spokenText],
        ]}
        steps={steps}
        answer={marks}
      />
    </>
  );
}

export function ThaiPanel() {
  const [text, setText] = useState('ข้าว');
  const result = attempt(() => thaiTone(text));
  return (
    <>
      <Field label={t(`${k}.thai`)} value={text} onChange={setText} hint={t(`${k}.thaiHint`)} />
      {result.ok ? (
        <Answer
          rows={[
            [t(`${k}.initial`), result.value.initial],
            [t(`${k}.class`), ht(`scripts.classes.${result.value.cls}`)],
            [t(`${k}.syllableKind`), t(result.value.live ? `${k}.live` : `${k}.dead`)],
            [t(`${k}.mark`), ht(`scripts.marks.${result.value.mark}`)],
            [t(`${k}.tone`), ht(`scripts.tones.${result.value.tone}`)],
          ]}
          steps={[
            ...(result.value.led ? [ht(`scripts.led.${result.value.led}`)] : []),
            t(`${k}.thaiRule`, {
              cls: ht(`scripts.classes.${result.value.cls}`),
              kind: t(result.value.live ? `${k}.live` : `${k}.dead`),
              mark: ht(`scripts.marks.${result.value.mark}`),
              tone: ht(`scripts.tones.${result.value.tone}`),
            }),
          ]}
          answer={ht(`scripts.tones.${result.value.tone}`)}
        />
      ) : (
        fail(result.code)
      )}
    </>
  );
}

export function VietnamesePanel() {
  const [method, setMethod] = useState<Method>('telex');
  const [text, setText] = useState('tieengs vieetj');
  const result = attempt(() => vietnamese(text, method));
  return (
    <>
      <Choice<Method>
        label={t(`${k}.method`)}
        value={method}
        options={(['telex', 'vni'] as const).map((value) => ({ value, label: ht(`scripts.methods.${value}`) }))}
        onChange={(next) => {
          setMethod(next);
          setText(next === 'telex' ? 'tieengs vieetj' : 'tie6ng1 vie6t5');
        }}
      />
      <Field label={t(`${k}.typed`)} value={text} onChange={setText} />
      {result.ok ? (
        <Answer
          rows={[[t(`${k}.result`), result.value]]}
          steps={[ht(`scripts.methodSteps.${method}`), t(`${k}.toneRule`)]}
          answer={result.value}
        />
      ) : (
        fail(result.code)
      )}
    </>
  );
}
