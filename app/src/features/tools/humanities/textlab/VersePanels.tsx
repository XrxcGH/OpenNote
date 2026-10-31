// The comparing panels and verse: keyness of a study text against a reference, versions compared word by word,
// a language sample's MLU, and scansion of English and Latin lines.
import '../text';
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { attempt, errorText, fixed } from '../ui/attempt';
import { Choice, DataTable, Field, Fields, InsertBar, Note, Problem, Results, Steps } from '../ui/parts';
import { ht } from '../ui/parts';
import { languageSample, words } from './counts';
import { frequencies, gSquared, keyness, tokens } from './corpus';
import { diffWords, variants } from './diff';
import { fitHexameter, fitPentameter, latinSyllables, rhymeScheme, scanEnglish } from './scansion';
import styles from '../ui/kit.module.css';
import { row } from './TextPanels';

const k = 'kitHumanities.textlab';

export function KeynessPanel({ text }: { text: string }) {
  const [reference, setReference] = useState('');
  const [word, setWord] = useState('');
  const result = attempt(() => {
    const study = tokens(text);
    const other = tokens(reference);
    if (study.length === 0 || other.length === 0) throw new Error('empty');
    const otherCounts = new Map(frequencies(other));
    const ranked = frequencies(study)
      .map(([item, a]) => ({
        item,
        a,
        b: otherCounts.get(item) ?? 0,
        ...keyness(a, study.length, otherCounts.get(item) ?? 0, other.length),
      }))
      .filter((entry) => entry.a / study.length > entry.b / other.length)
      .sort((x, y) => y.g2 - x.g2)
      .slice(0, 25);
    const target = word.trim().toLowerCase();
    const one =
      target === ''
        ? null
        : { a: study.filter((w) => w === target).length, b: other.filter((w) => w === target).length };
    return { study, other, ranked, target, one };
  });
  const header = [t(`${k}.headerWord`), ht('textlab.rows.g2'), ht('textlab.rows.logRatio')];
  return (
    <>
      <Field label={t(`${k}.reference`)} value={reference} onChange={setReference} rows={5} />
      <Fields>
        <Field label={t(`${k}.keyWord`)} value={word} onChange={setWord} />
      </Fields>
      {result.ok ? (
        (() => {
          const { study, other, ranked, target, one } = result.value;
          const rows = ranked.map((entry) => [entry.item, fixed(entry.g2, 4), fixed(entry.logRatio, 3)]);
          const detail = one ? keyness(one.a, study.length, one.b, other.length) : null;
          const steps =
            one && detail
              ? [
                  t(`${k}.keynessSteps.table`, {
                    a: one.a,
                    b: one.b,
                    c: study.length - one.a,
                    d: other.length - one.b,
                  }),
                  t(`${k}.keynessSteps.formula`, { n: study.length + other.length }),
                ]
              : [];
          return (
            <>
              {one && detail ? (
                <Results
                  label={t(`${k}.keynessValue`, {
                    word: target,
                    a: one.a,
                    n1: study.length,
                    b: one.b,
                    n2: other.length,
                  })}
                  rows={[
                    row('g2', fixed(gSquared(one.a, one.b, study.length - one.a, other.length - one.b), 4)),
                    row('logRatio', fixed(detail.logRatio, 3)),
                  ]}
                />
              ) : null}
              <Steps steps={steps} />
              <DataTable caption={t(`${k}.keyList`)} header={header} rows={rows} />
              <InsertBar payloads={{ table: { header, rows }, steps }} />
            </>
          );
        })()
      ) : (
        <Problem text={errorText('textlab', result.code)} />
      )}
    </>
  );
}

export function ComparePanel({ text }: { text: string }) {
  const [witness, setWitness] = useState('');
  const result = attempt(() => {
    const base = words(text);
    if (base.length === 0) throw new Error('empty');
    return variants(diffWords(base, words(witness)));
  });
  const header = (['at', 'base', 'witness'] as const).map((key) => ht(`textlab.variantHeader.${key}`));
  const omitted = t(`${k}.omitted`);
  const rows = result.ok ? result.value.map((v) => [String(v.at), v.base || omitted, v.witness || omitted]) : [];
  return (
    <>
      <Field label={t(`${k}.witness`)} value={witness} onChange={setWitness} rows={5} />
      {!result.ok ? (
        <Problem text={errorText('textlab', result.code)} />
      ) : rows.length === 0 ? (
        <Note>{t(`${k}.noVariants`)}</Note>
      ) : (
        <>
          <DataTable caption={t(`${k}.variantsTitle`)} header={header} rows={rows} />
          <InsertBar payloads={{ table: { header, rows } }} />
        </>
      )}
    </>
  );
}

export function SamplePanel() {
  const [text, setText] = useState(() => t(`${k}.sampleExample`));
  const result = attempt(() => languageSample(text));
  return (
    <>
      <Field label={t(`${k}.sample`)} value={text} onChange={setText} rows={6} mono hint={t(`${k}.sampleHint`)} />
      {result.ok ? (
        (() => {
          const s = result.value;
          const rows: [string, string][] = [
            row('utterances', String(s.utterances)),
            row('words', String(s.words)),
            row('morphemes', String(s.morphemes)),
            row('mluMorphemes', fixed(s.mluMorphemes, 2)),
            row('mluWords', fixed(s.mluWords, 2)),
            row('ndw', String(s.differentWords)),
          ];
          const steps = [`MLU = (${s.perUtterance.join(' + ')}) / ${s.utterances} = ${fixed(s.mluMorphemes, 2)}`];
          return (
            <>
              <Results label={t(`${k}.tabs.sample`)} rows={rows} />
              <Steps steps={steps} />
              <InsertBar
                payloads={{
                  table: { header: [t('kitHumanities.common.quantity'), t('kitHumanities.common.value')], rows },
                  steps,
                }}
              />
            </>
          );
        })()
      ) : (
        <Problem text={errorText('textlab', result.code)} />
      )}
    </>
  );
}

type Language = 'english' | 'latin';

function englishLines(lines: readonly string[]): { lines: string[]; scheme: string } {
  const out = lines.map((line, i) => {
    const scan = scanEnglish(line);
    const length = ht(`textlab.lineLengths.n${Math.min(Math.max(scan.feet, 1), 8)}`);
    const meter = [ht(`textlab.meters.${scan.meter}`), length].join(' ');
    return t(`${k}.englishLine`, {
      number: i + 1,
      count: scan.syllables,
      meter,
      pattern: scan.pattern.map((p) => (p ? '/' : '×')).join(' '),
    });
  });
  return { lines: out, scheme: rhymeScheme(lines) };
}

function latinLines(lines: readonly string[]): string[] {
  return lines.flatMap((line, i) => {
    const { syllables, elided } = latinSyllables(line);
    const weights = syllables.map((s) => s.weight);
    const marks = syllables.map((s) => `${s.text} ${ht(`textlab.weights.${s.weight}`)}`).join(' · ');
    const hex = fitHexameter(weights);
    const pent = fitPentameter(weights);
    const out = [t(`${k}.latinLine`, { number: i + 1, syllables: marks })];
    if (elided.length > 0) out.push(t(`${k}.elided`, { words: elided.join(', ') }));
    if (hex.length > 0) out.push(t(`${k}.hexameter`, { patterns: hex.join(', ') }));
    if (pent.length > 0) out.push(t(`${k}.pentameter`, { patterns: pent.join(', ') }));
    if (hex.length + pent.length === 0) out.push(t(`${k}.noFit`));
    else if (hex.length + pent.length > 1) out.push(t(`${k}.ambiguous`));
    return out;
  });
}

export function VersePanel() {
  const [language, setLanguage] = useState<Language>('english');
  const [text, setText] = useState(() => t(`${k}.verseExample`));
  const choose = (next: Language) => {
    setLanguage(next);
    setText(t(next === 'latin' ? `${k}.latinExample` : `${k}.verseExample`));
  };
  const result = attempt(() => {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length === 0) throw new Error('empty');
    return language === 'english' ? englishLines(lines) : { lines: latinLines(lines), scheme: '' };
  });
  const steps = [t(language === 'english' ? `${k}.verseSteps.english` : `${k}.verseSteps.latin`)];
  if (language === 'latin') steps.push(t(`${k}.verseSteps.key`));
  return (
    <>
      <Fields>
        <Choice<Language>
          label={t(`${k}.language`)}
          value={language}
          options={(['english', 'latin'] as const).map((value) => ({ value, label: ht(`textlab.languages.${value}`) }))}
          onChange={choose}
        />
      </Fields>
      <Field label={t(`${k}.lines`)} value={text} onChange={setText} rows={5} hint={t(`${k}.linesHint`)} />
      {result.ok ? (
        <>
          <ol className={styles.lines}>
            {result.value.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
          {result.value.scheme ? (
            <Results label={ht('textlab.rows.scheme')} rows={[row('scheme', result.value.scheme)]} />
          ) : null}
          <Steps steps={steps} />
          <InsertBar payloads={{ answer: result.value.lines.join('\n'), steps }} />
        </>
      ) : (
        <Problem text={errorText('textlab', result.code)} />
      )}
    </>
  );
}
