// The linguistics panels for structure: syntax and dependency trees, and interlinear glosses.
import '../text';
import { t } from '../../../../strings/t';
import { attempt, errorText } from '../ui/attempt';
import { Choice, DataTable, Field, InsertBar, Note, Picture, Problem, Results, Steps, ht } from '../ui/parts';
import { dependencySvg, syntaxSvg } from './draw';
import { checkGloss } from './gloss';
import { BracketError, bracketOutline, crossingArcs, parseBrackets, parseDependencies, treeStats } from './trees';

const k = 'kitHumanities.linguistics';
export type TreeMode = 'syntax' | 'dependency';
export interface TreeInputs {
  mode: TreeMode;
  syntax: string;
  dependency: string;
}

function bracketProblem(error: unknown): string {
  if (error instanceof BracketError) {
    return t(`${k}.bracketAt`, { problem: errorText('linguistics', error.message), position: error.position + 1 });
  }
  return errorText('linguistics', error instanceof Error ? error.message : 'unknown');
}

function SyntaxResult({ inputs }: { inputs: TreeInputs }) {
  let root;
  try {
    root = parseBrackets(inputs.syntax);
  } catch (error) {
    return <Problem text={bracketProblem(error)} />;
  }
  const stats = treeStats(root);
  const outline = bracketOutline(root);
  const svg = syntaxSvg(root, t(`${k}.syntaxTitle`));
  const alt = t(`${k}.syntaxAlt`, { root: root.label, words: stats.leaves.join(' ') });
  const rows: [string, string][] = [
    [t(`${k}.rows.root`), root.label],
    [t(`${k}.rows.words`), String(stats.leaves.length)],
    [t(`${k}.rows.phrases`), String(stats.phrases)],
    [t(`${k}.rows.depth`), String(stats.depth)],
  ];
  return (
    <>
      <Results label={t('kitHumanities.common.results')} rows={rows} />
      <Picture svg={svg} alt={alt} />
      <Steps steps={[t(`${k}.outlineStep`), ...outline]} />
      <InsertBar
        payloads={{
          answer: stats.leaves.join(' '),
          steps: outline,
          picture: { svg, name: 'syntax-tree', alt },
          figure: { tool: 'linguistics', inputs, svg, alt, summary: inputs.syntax },
        }}
      />
    </>
  );
}

function DependencyResult({ inputs }: { inputs: TreeInputs }) {
  const result = attempt(() => parseDependencies(inputs.dependency));
  if (!result.ok) return <Problem text={errorText('linguistics', result.code)} />;
  const deps = result.value;
  const crossing = crossingArcs(deps);
  const svg = dependencySvg(deps, t(`${k}.dependencyTitle`));
  const root = deps.find((d) => d.head === 0);
  const alt = t(`${k}.dependencyAlt`, { root: root?.word ?? '', count: deps.length });
  const rows = deps.map((d) => [
    String(d.index),
    d.word,
    d.head === 0 ? t(`${k}.rootHead`) : `${d.head} ${deps[d.head - 1].word}`,
    d.relation,
  ]);
  const header = [t(`${k}.headerNumber`), t(`${k}.headerWord`), t(`${k}.headerHead`), t(`${k}.headerRelation`)];
  return (
    <>
      <Picture svg={svg} alt={alt} />
      <Note>
        {crossing.length === 0
          ? t(`${k}.projective`)
          : t(`${k}.nonProjective`, { pairs: crossing.map(([a, b]) => `${a}–${b}`).join(', ') })}
      </Note>
      <DataTable caption={t(`${k}.dependencyTitle`)} header={header} rows={rows} />
      <InsertBar
        payloads={{
          table: { header, rows },
          picture: { svg, name: 'dependency-tree', alt },
          figure: { tool: 'linguistics', inputs, svg, alt, summary: deps.map((d) => d.word).join(' ') },
        }}
      />
    </>
  );
}

export function TreePanel({ inputs, onChange }: { inputs: TreeInputs; onChange(next: TreeInputs): void }) {
  return (
    <>
      <Choice<TreeMode>
        label={t(`${k}.treeKind`)}
        value={inputs.mode}
        options={(['syntax', 'dependency'] as const).map((value) => ({
          value,
          label: ht(`linguistics.treeKinds.${value}`),
        }))}
        onChange={(mode) => onChange({ ...inputs, mode })}
      />
      {inputs.mode === 'syntax' ? (
        <>
          <Field
            label={t(`${k}.brackets`)}
            value={inputs.syntax}
            onChange={(syntax) => onChange({ ...inputs, syntax })}
            rows={3}
            mono
            hint={t(`${k}.bracketsHint`)}
          />
          <SyntaxResult inputs={inputs} />
        </>
      ) : (
        <>
          <Field
            label={t(`${k}.dependencies`)}
            value={inputs.dependency}
            onChange={(dependency) => onChange({ ...inputs, dependency })}
            rows={6}
            mono
            hint={t(`${k}.dependenciesHint`)}
          />
          <DependencyResult inputs={inputs} />
        </>
      )}
    </>
  );
}

export function GlossPanel(props: {
  value: { example: string; gloss: string; translation: string };
  onChange(next: { example: string; gloss: string; translation: string }): void;
}) {
  const { value, onChange } = props;
  const result = attempt(() => checkGloss(value.example, value.gloss, value.translation));
  return (
    <>
      <Field label={t(`${k}.example`)} value={value.example} onChange={(example) => onChange({ ...value, example })} />
      <Field
        label={t(`${k}.glossLine`)}
        value={value.gloss}
        onChange={(gloss) => onChange({ ...value, gloss })}
        hint={t(`${k}.glossHint`)}
      />
      <Field
        label={t(`${k}.translation`)}
        value={value.translation}
        onChange={(translation) => onChange({ ...value, translation })}
      />
      {result.ok ? <GlossResult result={result.value} /> : <Problem text={errorText('linguistics', result.code)} />}
    </>
  );
}

function GlossResult({ result }: { result: ReturnType<typeof checkGloss> }) {
  const header = result.words.map((w) => w.word);
  const rows = [result.words.map((w) => w.gloss)];
  const problems = result.problems.map((p) =>
    ht(`linguistics.glossProblems.${p.kind}`, {
      position: p.position,
      word: p.word || p.gloss,
      forms: p.forms,
      glosses: p.glosses,
    }),
  );
  const labels = result.labels.map((l) =>
    l.meaning
      ? t(`${k}.labelMeaning`, { label: l.label, meaning: l.meaning })
      : t(`${k}.labelUnknown`, { label: l.label }),
  );
  const morphemeRows = result.words.flatMap((w) => w.morphemes.map((m) => [w.word, m.form, m.gloss]));
  const answer = `${header.join(' ')}\n${rows[0].join(' ')}${result.translation ? `\n‘${result.translation}’` : ''}`;
  return (
    <>
      {problems.length === 0 ? <Note>{t(`${k}.glossAligned`)}</Note> : <Problem text={problems.join(' ')} />}
      <DataTable caption={t(`${k}.glossTable`)} header={header} rows={rows} />
      {result.translation ? <Note>{`‘${result.translation}’`}</Note> : null}
      <DataTable
        caption={t(`${k}.morphemeTable`)}
        header={[t(`${k}.headerWord`), t(`${k}.headerMorpheme`), t(`${k}.headerGloss`)]}
        rows={morphemeRows}
      />
      {labels.length > 0 ? <Steps steps={[t(`${k}.labelsStep`), ...labels]} /> : null}
      <InsertBar payloads={{ answer, table: { header, rows }, steps: labels }} />
    </>
  );
}
