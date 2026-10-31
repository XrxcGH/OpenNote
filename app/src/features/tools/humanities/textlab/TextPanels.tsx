// The text panels: readability with flags, word lists with a Zipf plot, and the concordance with collocates.
import '../text';
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { PAPER, r2, svgDocument, svgText } from '../svg';
import { attempt, errorText, fixed, num } from '../ui/attempt';
import { Check, Choice, DataTable, Field, Fields, InsertBar, Note, Picture, Problem, Results } from '../ui/parts';
import { ht } from '../ui/parts';
import { flags, readability, sentenceLengths } from './counts';
import { collocates, frequencies, kwic, movingTtr, ngrams, tokens, typeTokenRatio } from './corpus';

const k = 'kitHumanities.textlab';
export const row = (key: string, value: string): [string, string] => [ht(`textlab.rows.${key}`), value];

export function TextField({ value, onChange }: { value: string; onChange(next: string): void }) {
  return <Field label={t(`${k}.text`)} value={value} onChange={onChange} rows={7} hint={t(`${k}.textHint`)} />;
}

export function ReadPanel({ text }: { text: string }) {
  const result = attempt(() => ({ r: readability(text), lengths: sentenceLengths(text), found: flags(text) }));
  if (!result.ok) return <Problem text={errorText('textlab', result.code)} />;
  const { r, lengths, found } = result.value;
  const rows: [string, string][] = [
    row('words', String(r.words)),
    row('sentences', String(r.sentences)),
    row('syllables', String(r.syllables)),
    row('fleschEase', fixed(r.fleschEase, 3)),
    row('fleschKincaid', fixed(r.fleschKincaid, 2)),
    row('fog', fixed(r.fog, 2)),
    row('smog', fixed(r.smog, 2)),
    row('colemanLiau', fixed(r.colemanLiau, 2)),
    row('ari', fixed(r.ari, 2)),
  ];
  const steps = [
    `FRE = 206.835 − 1.015 × (${r.words}/${r.sentences}) − 84.6 × (${r.syllables}/${r.words}) = ${fixed(r.fleschEase, 3)}`,
    `FK = 0.39 × (${r.words}/${r.sentences}) + 11.8 × (${r.syllables}/${r.words}) − 15.59 = ${fixed(r.fleschKincaid, 2)}`,
  ];
  return (
    <>
      <Results label={t(`${k}.tabs.read`)} rows={rows} />
      <Note>{t(`${k}.lengths`, { list: lengths.join(', ') })}</Note>
      <Note>{t(`${k}.syllableNote`)}</Note>
      <strong>{t(`${k}.flagsTitle`)}</strong>
      {found.length === 0 ? (
        <Note>{t(`${k}.noFlags`)}</Note>
      ) : (
        <DataTable
          caption={t(`${k}.flagsTitle`)}
          header={[t(`${k}.headerWord`), t(`${k}.flagsTitle`)]}
          rows={found.map((flag) => [flag.text, ht(`textlab.flagKinds.${flag.kind}`)])}
        />
      )}
      <InsertBar
        payloads={{
          table: { header: [t('kitHumanities.common.quantity'), t('kitHumanities.common.value')], rows },
          steps,
        }}
      />
    </>
  );
}

function zipfSvg(counts: readonly number[], title: string, rankLabel: string, countLabel: string): string {
  const width = 360;
  const height = 240;
  const pad = 36;
  const maxRank = Math.log10(counts.length);
  const maxCount = Math.log10(counts[0] ?? 1);
  const x = (rank: number) => pad + (maxRank > 0 ? (Math.log10(rank) / maxRank) * (width - 2 * pad) : 0);
  const y = (count: number) => height - pad - (maxCount > 0 ? (Math.log10(count) / maxCount) * (height - 2 * pad) : 0);
  const dots = counts
    .map((count, i) => `<circle cx="${r2(x(i + 1))}" cy="${r2(y(count))}" r="2.5" fill="${PAPER.accent}"/>`)
    .join('');
  const axes =
    `<path d="M${pad} ${pad} V${height - pad} H${width - pad}" fill="none" stroke="${PAPER.line}"/>` +
    svgText(width / 2, height - 8, rankLabel, 11, ' text-anchor="middle"') +
    svgText(10, pad - 10, countLabel, 11);
  return svgDocument(width, height, axes + dots, title);
}

export function WordsPanel({ text }: { text: string }) {
  const [skip, setSkip] = useState(false);
  const [n, setN] = useState('1');
  const result = attempt(() => {
    const list = tokens(text);
    const size = num(n);
    return {
      list,
      top: (size === 1 ? frequencies(list, skip) : ngrams(list, size)).slice(0, 50),
      ttr: typeTokenRatio(list),
      mattr: movingTtr(list),
    };
  });
  return (
    <>
      <Fields>
        <Field label={t(`${k}.gram`)} value={n} onChange={setN} numeric />
        <Check label={t(`${k}.skipStop`)} checked={skip} onChange={setSkip} />
      </Fields>
      {result.ok ? (
        (() => {
          const { list, top, ttr, mattr } = result.value;
          const rows: [string, string][] = [
            row('words', String(list.length)),
            row('types', String(new Set(list).size)),
            row('ttr', fixed(ttr, 4)),
            row('mattr', fixed(mattr, 4)),
          ];
          const header = [t(`${k}.headerWord`), t(`${k}.headerCount`)];
          const table = top.map(([word, count]) => [word, String(count)]);
          const alt = t(`${k}.zipfAlt`, { count: top.length });
          const svg = zipfSvg(
            frequencies(list).map(([, count]) => count),
            alt,
            t(`${k}.zipfRank`),
            t(`${k}.zipfFrequency`),
          );
          return (
            <>
              <Results label={t(`${k}.tabs.words`)} rows={rows} />
              <DataTable caption={t(`${k}.top`)} header={header} rows={table} />
              <Picture svg={svg} alt={alt} />
              <InsertBar payloads={{ table: { header, rows: table }, picture: { svg, name: 'zipf-plot', alt } }} />
            </>
          );
        })()
      ) : (
        <Problem text={errorText('textlab', result.code)} />
      )}
    </>
  );
}

type Sort = 'order' | 'left' | 'right';

export function KwicPanel({ text }: { text: string }) {
  const [query, setQuery] = useState('');
  const [span, setSpan] = useState('5');
  const [sort, setSort] = useState<Sort>('order');
  const result = attempt(() => {
    const size = num(span);
    const lines = kwic(text, query, Math.max(1, Math.min(20, Math.round(size))), sort);
    const near = attempt(() => collocates(tokens(text), query.trim().split(/\s+/)[0] ?? '', Math.round(size)));
    return { lines, near: near.ok ? near.value.slice(0, 20) : [] };
  });
  const header = (['left', 'key', 'right'] as const).map((key) => ht(`textlab.kwicHeader.${key}`));
  const colHeader = (['word', 'observed', 'frequency', 'mi', 't', 'g2'] as const).map((key) =>
    ht(`textlab.collocateHeader.${key}`),
  );
  return (
    <>
      <Fields>
        <Field label={t(`${k}.query`)} value={query} onChange={setQuery} />
        <Field label={t(`${k}.span`)} value={span} onChange={setSpan} numeric />
        <Choice<Sort>
          label={t(`${k}.sort`)}
          value={sort}
          options={(['order', 'left', 'right'] as const).map((value) => ({
            value,
            label: ht(`textlab.sorts.${value}`),
          }))}
          onChange={setSort}
        />
      </Fields>
      {result.ok ? (
        <>
          <Note>{t(`${k}.hits`, { count: result.value.lines.length })}</Note>
          <DataTable
            caption={t(`${k}.tabs.kwic`)}
            header={header}
            rows={result.value.lines.map((line) => [line.left, line.key, line.right])}
          />
          <strong>{t(`${k}.collocatesTitle`)}</strong>
          {result.value.near.length === 0 ? (
            <Note>{t(`${k}.noCollocates`)}</Note>
          ) : (
            <DataTable
              caption={t(`${k}.collocatesTitle`)}
              header={colHeader}
              rows={result.value.near.map((item) => [
                item.word,
                String(item.observed),
                String(item.frequency),
                fixed(item.mi, 3),
                fixed(item.t, 3),
                fixed(item.g2, 3),
              ])}
            />
          )}
          <InsertBar
            payloads={{ table: { header, rows: result.value.lines.map((line) => [line.left, line.key, line.right]) } }}
          />
        </>
      ) : (
        <Problem text={errorText('textlab', result.code)} />
      )}
    </>
  );
}
