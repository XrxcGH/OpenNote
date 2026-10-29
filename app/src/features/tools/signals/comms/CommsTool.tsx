// Information, coding, and modulation: one tab per topic. Information measures and channel capacity; source codes
// with the Huffman tree drawn; Hamming and linear block codes; CRCs; convolutional codes with Viterbi decoding; and
// digital modulation with constellations, bit-error-rate curves, and eye diagrams.
import { forwardRef, useImperativeHandle, useMemo, useRef, type ReactNode } from 'react';
import { t } from '../../../../strings/t';
import { fmt, readNumbers, readRows } from '../shared/num';
import { Plot, standaloneSvg, svgBytes, type PlotHandle } from '../shared/Plot';
import {
  Answer,
  Choice,
  DataTable,
  Field,
  Fields,
  InsertMenu,
  Note,
  Problem,
  Results,
  StepList,
  Tabs,
  TextBox,
  attempt,
  num,
  say,
  useStored,
  type TableData,
} from '../shared/ui';
import type { Step } from '../shared/steps';
import styles from '../shared/kit.module.css';
import {
  CRC_NAMES,
  CRC_PRESETS,
  bitsText,
  convEncode,
  convolutionalCode,
  crc,
  crcDivision,
  crcHex,
  hammingDecode,
  hammingEncode,
  huffman,
  linearCode,
  lz78,
  readBits,
  shannonFano,
  viterbi,
  type Bit,
  type CrcName,
  type HuffmanNode,
} from './coding';
import {
  capacityAwgn,
  capacityBec,
  capacityBsc,
  capacityDmc,
  capacityZ,
  divergence,
  entropy,
  jointMeasures,
} from './info';
import {
  SCHEMES,
  berSteps,
  bitErrorRate,
  bitsPerSymbol,
  checkOrder,
  constellation,
  eyeDiagram,
  isApproximate,
  snrFromEbN0,
  type Scheme,
} from './modulation';

type Mode = 'information' | 'capacity' | 'source' | 'block' | 'crc' | 'convolutional' | 'modulation';
const MODES: readonly Mode[] = ['information', 'capacity', 'source', 'block', 'crc', 'convolutional', 'modulation'];

/** The words of this tool, by their key under kitSignals.comms. */
const w = (key: string, vars?: Record<string, string | number>) => say(`kitSignals.comms.${key}`, vars);

function Outcome({
  answer,
  steps,
  latex,
  table,
  rows,
  picture,
  children,
}: {
  answer: string;
  steps: readonly Step[];
  latex?: string;
  table?: TableData;
  rows?: readonly (readonly [string, string])[];
  picture?: () => Promise<{ bytes: ArrayBuffer; name: string; alt: string; mime: string } | null>;
  children?: ReactNode;
}) {
  return (
    <>
      <Answer text={answer} />
      {rows ? <Results rows={rows} /> : null}
      {children}
      {table ? <DataTable caption={w('tableTitle')} table={table} /> : null}
      <StepList steps={steps} />
      <InsertMenu
        answer={answer}
        {...(latex ? { latex } : {})}
        {...(table ? { table } : {})}
        steps={steps}
        {...(picture ? { picture } : {})}
      />
    </>
  );
}

function InformationMode() {
  const [state, set] = useStored('comms.information', { p: '0.5, 0.25, 0.25', q: '' });
  const outcome = useMemo(
    () =>
      attempt(() => {
        const rows = readRows(state.p);
        if (rows.length > 1) {
          const joint = jointMeasures(rows);
          return {
            answer: w('mutualAnswer', { bits: fmt(joint.mutual) }),
            rows: [
              ['H(X)', `${fmt(joint.hx)} ${w('bits')}`],
              ['H(Y)', `${fmt(joint.hy)} ${w('bits')}`],
              ['H(X,Y)', `${fmt(joint.hxy)} ${w('bits')}`],
              ['H(X|Y)', `${fmt(joint.hxGivenY)} ${w('bits')}`],
              ['H(Y|X)', `${fmt(joint.hyGivenX)} ${w('bits')}`],
              ['I(X;Y)', `${fmt(joint.mutual)} ${w('bits')}`],
            ] as [string, string][],
            steps: joint.steps,
            latex: String.raw`I(X;Y) = H(X) + H(Y) - H(X,Y)`,
          };
        }
        const p = rows[0] ?? [];
        const h = entropy(p);
        const rowsOut: [string, string][] = [['H(P)', `${fmt(h.bits)} ${w('bits')}`]];
        const steps = [...h.steps];
        if (state.q.trim()) {
          const d = divergence(p, readNumbers(state.q));
          rowsOut.push(['D(P‖Q)', `${fmt(d.bits)} ${w('bits')}`]);
          steps.push(...d.steps);
        }
        return {
          answer: w('entropyAnswer', { bits: fmt(h.bits) }),
          rows: rowsOut,
          steps,
          latex: String.raw`H(X) = -\sum_x p(x)\log_2 p(x)`,
        };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <TextBox
          label={w('probabilities')}
          value={state.p}
          onChange={(p) => set({ p })}
          hint={w('probabilitiesHint')}
          rows={3}
        />
        <Field label={w('q')} value={state.q} onChange={(q) => set({ q })} hint={w('qHint')} wide />
      </Fields>
      {outcome.ok ? <Outcome {...outcome.value} /> : <Problem text={outcome.problem} />}
    </>
  );
}

type Channel = 'bsc' | 'bec' | 'z' | 'dmc' | 'awgn';
const CHANNELS: readonly Channel[] = ['bsc', 'bec', 'z', 'dmc', 'awgn'];

function CapacityMode() {
  const [state, set] = useStored('comms.capacity', {
    channel: 'bsc' as Channel,
    p: '0.1',
    matrix: '0.9 0.1\n0.1 0.9',
    bandwidth: '1000000',
    snr: '15',
    snrDb: 'ratio' as 'ratio' | 'db',
  });
  const outcome = useMemo(
    () =>
      attempt(() => {
        if (state.channel === 'awgn') {
          const snr = state.snrDb === 'db' ? 10 ** (num(state.snr) / 10) : num(state.snr);
          const c = capacityAwgn(num(state.bandwidth), snr);
          return {
            answer: w('awgnAnswer', { rate: fmt(c.bitsPerSecond) }),
            steps: c.steps,
            latex: String.raw`C = B \log_2(1 + \mathrm{SNR})`,
          };
        }
        const c =
          state.channel === 'dmc'
            ? capacityDmc(readRows(state.matrix))
            : (state.channel === 'bsc' ? capacityBsc : state.channel === 'bec' ? capacityBec : capacityZ)(num(state.p));
        const latex: Record<Exclude<Channel, 'awgn'>, string> = {
          bsc: String.raw`C = 1 - H_2(p)`,
          bec: String.raw`C = 1 - \epsilon`,
          z: String.raw`C = \log_2\!\left(1 + (1-p)\,p^{p/(1-p)}\right)`,
          dmc: String.raw`C = \max_{p(x)} I(X;Y)`,
        };
        return { answer: w('capacityAnswer', { bits: fmt(c.bits) }), steps: c.steps, latex: latex[state.channel] };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <Choice
          label={w('channel')}
          value={state.channel}
          options={CHANNELS}
          name={(c) => w(`channels.${c}`)}
          onChange={(channel) => set({ channel })}
        />
        {state.channel === 'awgn' ? (
          <>
            <Field
              label={w('bandwidth')}
              value={state.bandwidth}
              onChange={(bandwidth) => set({ bandwidth })}
              unit="Hz"
            />
            <Field label={w('snr')} value={state.snr} onChange={(snr) => set({ snr })} />
            <Choice
              label={w('snrUnit')}
              value={state.snrDb}
              options={['ratio', 'db'] as const}
              name={(u) => w(`snrUnits.${u}`)}
              onChange={(snrDb) => set({ snrDb })}
            />
          </>
        ) : state.channel === 'dmc' ? (
          <TextBox
            label={w('matrix')}
            value={state.matrix}
            onChange={(matrix) => set({ matrix })}
            hint={w('matrixHint')}
            rows={3}
          />
        ) : (
          <Field
            label={w(state.channel === 'bec' ? 'erasure' : 'crossover')}
            value={state.p}
            onChange={(p) => set({ p })}
          />
        )}
      </Fields>
      {outcome.ok ? <Outcome {...outcome.value} /> : <Problem text={outcome.problem} />}
    </>
  );
}

interface TreeHandle {
  picture: PlotHandle['picture'];
}

/** The Huffman tree: leaves in code order along the bottom, each merge above its two children; 0 goes left, 1 right. */
const HuffmanTree = forwardRef<TreeHandle, { root: HuffmanNode; names: string[] }>(function HuffmanTree(
  { root, names },
  ref,
) {
  const svg = useRef<SVGSVGElement>(null);
  const placed: { node: HuffmanNode; x: number; depth: number }[] = [];
  let leaf = 0;
  let deepest = 0;
  const place = (node: HuffmanNode, depth: number): number => {
    deepest = Math.max(deepest, depth);
    if (!node.children) {
      const x = leaf++;
      placed.push({ node, x, depth });
      return x;
    }
    const x = (place(node.children[0], depth + 1) + place(node.children[1], depth + 1)) / 2;
    placed.push({ node, x, depth });
    return x;
  };
  place(root, 0);
  const width = Math.max(240, leaf * 56);
  const height = (deepest + 1) * 52 + 24;
  const sx = (x: number) => 28 + (x * (width - 56)) / Math.max(1, leaf - 1);
  const sy = (depth: number) => 20 + depth * 52;
  const at = new Map(placed.map((one) => [one.node.id, one]));
  const alt = w('treeAlt', { count: names.length });
  useImperativeHandle(ref, () => ({
    picture: async (name) =>
      svg.current
        ? { bytes: svgBytes(standaloneSvg(svg.current)), name: `${name}.svg`, alt, mime: 'image/svg+xml' }
        : null,
  }));
  return (
    <figure className={styles.figure}>
      <svg ref={svg} className={styles.plot} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={alt}>
        {placed.flatMap(({ node, x, depth }) =>
          (node.children ?? []).map((child, bit) => {
            const c = at.get(child.id)!;
            return (
              <g key={`${node.id}-${bit}`}>
                <line className={styles.frame} x1={sx(x)} y1={sy(depth)} x2={sx(c.x)} y2={sy(c.depth)} />
                <text
                  className={styles.tickText}
                  x={(sx(x) + sx(c.x)) / 2 + (bit ? 4 : -10)}
                  y={(sy(depth) + sy(c.depth)) / 2}
                >
                  {bit}
                </text>
              </g>
            );
          }),
        )}
        {placed.map(({ node, x, depth }) => (
          <text
            key={node.id}
            className={styles.tickText}
            x={sx(x)}
            y={sy(depth) + (node.children ? -4 : 14)}
            textAnchor="middle"
          >
            {node.children ? fmt(node.p, 3) : `${names[node.symbol!]} (${fmt(node.p, 3)})`}
          </text>
        ))}
      </svg>
    </figure>
  );
});

function SourceMode() {
  const [state, set] = useStored('comms.source', {
    p: '0.4, 0.2, 0.2, 0.1, 0.1',
    method: 'huffman' as 'huffman' | 'shannonFano',
    text: 'ABAABABAABAB',
  });
  const tree = useRef<TreeHandle>(null);
  const outcome = useMemo(
    () => attempt(() => (state.method === 'huffman' ? huffman : shannonFano)(readNumbers(state.p))),
    [state.p, state.method],
  );
  const parsed = useMemo(() => attempt(() => lz78(state.text)), [state.text]);
  const names = outcome.ok ? outcome.value.codes.map((_, i) => `s${i + 1}`) : [];
  return (
    <>
      <Fields>
        <Field label={w('probabilities')} value={state.p} onChange={(p) => set({ p })} wide />
        <Choice
          label={w('method')}
          value={state.method}
          options={['huffman', 'shannonFano'] as const}
          name={(m) => w(`methods.${m}`)}
          onChange={(method) => set({ method })}
        />
      </Fields>
      {outcome.ok ? (
        <Outcome
          answer={w('sourceAnswer', {
            average: fmt(outcome.value.average),
            entropy: fmt(outcome.value.entropy),
            efficiency: fmt(outcome.value.efficiency * 100, 4),
          })}
          steps={outcome.value.steps}
          latex={String.raw`\bar{L} = \sum_i p_i \ell_i \ge H(X)`}
          table={{
            header: [w('symbol'), 'p', w('codeword'), w('length')],
            rows: outcome.value.codes.map((code, i) => [
              names[i]!,
              fmt(readNumbers(state.p)[i]!),
              code,
              String(code.length),
            ]),
          }}
          {...(outcome.value.root
            ? { picture: () => tree.current?.picture('huffman-tree') ?? Promise.resolve(null) }
            : {})}
        >
          {outcome.value.root ? <HuffmanTree ref={tree} root={outcome.value.root} names={names} /> : null}
        </Outcome>
      ) : (
        <Problem text={outcome.problem} />
      )}
      <h3 className={styles.heading}>{w('lz78')}</h3>
      <Fields>
        <Field label={w('text')} value={state.text} onChange={(text) => set({ text })} wide />
      </Fields>
      {parsed.ok ? (
        <>
          <Answer text={w('lzAnswer', { count: parsed.value.length, chars: [...state.text].length })} />
          <DataTable
            caption={w('lz78')}
            table={{
              header: [w('index'), w('phrase'), w('output')],
              rows: parsed.value.map((one) => [String(one.index), one.phrase, `(${one.prefix}, ${one.next})`]),
            }}
          />
        </>
      ) : (
        <Problem text={parsed.problem} />
      )}
    </>
  );
}

type BlockTask = 'encode' | 'decode' | 'linear';

function BlockMode() {
  const [state, set] = useStored('comms.block', {
    task: 'encode' as BlockTask,
    data: '1011',
    received: '0110111',
    g: '1 1 1 0 0 0 0\n1 0 0 1 1 0 0\n0 1 0 1 0 1 0\n1 1 0 1 0 0 1',
  });
  const outcome = useMemo(
    () =>
      attempt(() => {
        if (state.task === 'encode') {
          const result = hammingEncode(readBits(state.data));
          return { answer: w('encodeAnswer', { word: bitsText(result.codeword) }), steps: result.steps };
        }
        if (state.task === 'decode') {
          const result = hammingDecode(readBits(state.received));
          return {
            answer: result.position
              ? w('decodeAnswer', {
                  syndrome: bitsText(result.syndrome),
                  position: result.position,
                  data: bitsText(result.data),
                })
              : w('decodeClean', { data: bitsText(result.data) }),
            steps: result.steps,
          };
        }
        const code = linearCode(readRows(state.g).map((row) => row.map((v) => (v ? 1 : 0) as Bit)));
        const table: TableData = {
          header: [w('message'), w('codeword'), w('weight')],
          rows: code.codewords
            .slice(0, 64)
            .map((c, i) => [i.toString(2).padStart(code.k, '0'), bitsText(c), String(c.filter(Boolean).length)]),
        };
        return {
          answer: w('linearAnswer', { n: code.n, k: code.k, d: code.dMin, t: code.corrects }),
          steps: code.steps,
          table,
          leaders: code.leaders,
        };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <Choice
          label={w('task')}
          value={state.task}
          options={['encode', 'decode', 'linear'] as const}
          name={(task) => w(`tasks.${task}`)}
          onChange={(task) => set({ task })}
        />
        {state.task === 'encode' ? (
          <Field label={w('data')} value={state.data} onChange={(data) => set({ data })} hint={w('orderHint')} />
        ) : null}
        {state.task === 'decode' ? (
          <Field
            label={w('received')}
            value={state.received}
            onChange={(received) => set({ received })}
            hint={w('orderHint')}
          />
        ) : null}
        {state.task === 'linear' ? (
          <TextBox
            label={w('generator')}
            value={state.g}
            onChange={(g) => set({ g })}
            hint={w('generatorHint')}
            rows={4}
          />
        ) : null}
      </Fields>
      {outcome.ok ? (
        <Outcome
          answer={outcome.value.answer}
          steps={outcome.value.steps}
          {...('table' in outcome.value && outcome.value.table ? { table: outcome.value.table } : {})}
          latex={
            state.task === 'linear'
              ? String.raw`t = \lfloor (d_{\min} - 1)/2 \rfloor`
              : String.raw`\mathbf{s} = \mathbf{H}\mathbf{r}^{\mathsf T}`
          }
        >
          {'leaders' in outcome.value && outcome.value.leaders ? (
            <DataTable
              caption={w('leaders')}
              table={{ header: [w('leader')], rows: outcome.value.leaders.map((leader) => [bitsText(leader)]) }}
            />
          ) : null}
        </Outcome>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function CrcMode() {
  const [state, set] = useStored('comms.crc', {
    task: 'preset' as 'preset' | 'division',
    preset: 'crc32' as CrcName,
    text: '123456789',
    message: '11010011101100',
    generator: '1011',
  });
  const outcome = useMemo(
    () =>
      attempt(() => {
        if (state.task === 'preset') {
          const preset = CRC_PRESETS[state.preset];
          const result = crc([...new TextEncoder().encode(state.text)], preset);
          return {
            answer: w('crcAnswer', { name: w(`presets.${state.preset}`), value: crcHex(result.value, preset.width) }),
            table: { header: [w('byte'), w('register')], rows: result.rows } as TableData,
            steps: [] as Step[],
          };
        }
        const result = crcDivision(readBits(state.message), readBits(state.generator));
        return {
          answer: w('divisionAnswer', { remainder: bitsText(result.remainder), sent: bitsText(result.transmitted) }),
          table: { header: [w('position'), w('afterXor')], rows: result.rows } as TableData,
          steps: result.steps,
        };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <Choice
          label={w('task')}
          value={state.task}
          options={['preset', 'division'] as const}
          name={(task) => w(`crcTasks.${task}`)}
          onChange={(task) => set({ task })}
        />
        {state.task === 'preset' ? (
          <>
            <Choice
              label={w('preset')}
              value={state.preset}
              options={CRC_NAMES}
              name={(p) => w(`presets.${p}`)}
              onChange={(preset) => set({ preset })}
            />
            <Field label={w('text')} value={state.text} onChange={(text) => set({ text })} />
          </>
        ) : (
          <>
            <Field label={w('messageBits')} value={state.message} onChange={(message) => set({ message })} />
            <Field label={w('generatorBits')} value={state.generator} onChange={(generator) => set({ generator })} />
          </>
        )}
      </Fields>
      {state.task === 'preset' ? <Note>{w('crcSource')}</Note> : null}
      {outcome.ok ? (
        <Outcome {...outcome.value} latex={String.raw`r(x) = x^{r} m(x) \bmod g(x)`} />
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function ConvolutionalMode() {
  const [state, set] = useStored('comms.convolutional', { g1: '7', g2: '5', input: '1011', flips: '3' });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const code = convolutionalCode(state.g1, state.g2);
        const encoded = convEncode(code, readBits(state.input));
        const received = [...encoded.output];
        for (const position of readNumbers(state.flips)) {
          if (!(Number.isInteger(position) && position >= 1 && position <= received.length)) continue;
          received[position - 1] = (1 - received[position - 1]!) as Bit;
        }
        return { code, encoded, received, decoded: viterbi(code, received) };
      }),
    [state],
  );
  const fields = (
    <Fields>
      <Field label={w('g1')} value={state.g1} onChange={(g1) => set({ g1 })} hint={w('octalHint')} />
      <Field label={w('g2')} value={state.g2} onChange={(g2) => set({ g2 })} />
      <Field label={w('inputBits')} value={state.input} onChange={(input) => set({ input })} />
      <Field label={w('flips')} value={state.flips} onChange={(flips) => set({ flips })} hint={w('flipsHint')} />
    </Fields>
  );
  if (!outcome.ok)
    return (
      <>
        {fields}
        <Problem text={outcome.problem} />
      </>
    );
  const { code, encoded, received, decoded } = outcome.value;
  const states = 2 ** (code.k - 1);
  const label = (s: number) => s.toString(2).padStart(code.k - 1, '0');
  const table: TableData = {
    header: [w('time'), ...Array.from({ length: states }, (_, s) => label(s))],
    rows: decoded.metrics.map((row, time) => [String(time), ...row.map((m) => (Number.isFinite(m) ? String(m) : '—'))]),
  };
  const answer = w('viterbiAnswer', { decoded: bitsText(decoded.decoded), errors: decoded.metric });
  return (
    <>
      {fields}
      <Results
        rows={[
          [w('encoded'), encoded.pairs.join(' ')],
          [w('receivedBits'), bitsText(received)],
          [w('constraintLength'), String(code.k)],
        ]}
      />
      <Plot
        ref={plot}
        title={w('trellisTitle')}
        spec={{
          series: [
            ...Array.from({ length: states }, (_, s) => ({
              label: label(s),
              x: decoded.metrics.map((_, time) => time),
              y: decoded.metrics.map(() => s),
              kind: 'dots' as const,
              tone: 4,
            })),
            { label: w('survivor'), x: decoded.path.map((_, time) => time), y: decoded.path, tone: 1 },
          ].slice(states > 8 ? states : 0),
          xLabel: w('time'),
          yLabel: w('state'),
        }}
      />
      <Outcome
        answer={answer}
        steps={[...encoded.steps, ...decoded.steps]}
        table={table}
        picture={() => plot.current?.picture('trellis') ?? Promise.resolve(null)}
      />
    </>
  );
}

const MODULATION = {
  scheme: 'bpsk' as Scheme,
  order: '16',
  ebN0: '10',
  rolloff: '0.35',
  noise: '0',
  bitRate: '1000000',
  bandwidth: '1000000',
};
type ModulationState = typeof MODULATION;

function modulate(state: ModulationState) {
  const order = state.scheme === 'psk' || state.scheme === 'qam' ? checkOrder(state.scheme, num(state.order)) : 2;
  const ebN0 = num(state.ebN0);
  const grid = Array.from({ length: 41 }, (_, i) => i * 0.5);
  return {
    ber: berSteps(state.scheme, order, ebN0),
    points: constellation(state.scheme, order, ebN0),
    snr: snrFromEbN0(ebN0, num(state.bitRate), num(state.bandwidth), bitsPerSymbol(state.scheme, order)),
    grid,
    curve: grid.map((db) => Math.log10(Math.max(1e-300, bitErrorRate(state.scheme, order, 10 ** (db / 10))))),
    eye: eyeDiagram(num(state.rolloff), num(state.noise)),
  };
}

function ModulationFields({ state, set }: { state: ModulationState; set(patch: Partial<ModulationState>): void }) {
  return (
    <Fields>
      <Choice
        label={w('scheme')}
        value={state.scheme}
        options={SCHEMES}
        name={(s) => w(`schemes.${s}`)}
        onChange={(scheme) => set({ scheme })}
      />
      {state.scheme === 'psk' || state.scheme === 'qam' ? (
        <Field label={w('order')} value={state.order} onChange={(order) => set({ order })} />
      ) : null}
      <Field label={w('ebN0')} value={state.ebN0} onChange={(ebN0) => set({ ebN0 })} unit="dB" />
      <Field label={w('bitRate')} value={state.bitRate} onChange={(bitRate) => set({ bitRate })} unit="bit/s" />
      <Field label={w('bandwidth')} value={state.bandwidth} onChange={(bandwidth) => set({ bandwidth })} unit="Hz" />
      <Field label={w('rolloff')} value={state.rolloff} onChange={(rolloff) => set({ rolloff })} />
      <Field label={w('noise')} value={state.noise} onChange={(noise) => set({ noise })} hint={w('noiseHint')} />
    </Fields>
  );
}

function ConstellationPlot({ points }: { points: ReturnType<typeof constellation> }) {
  return (
    <Plot
      title={w('constellationTitle')}
      spec={{
        series: [
          { label: w('receivedPoints'), x: points.noisy.i, y: points.noisy.q, kind: 'dots', tone: 4 },
          {
            label: w('idealPoints'),
            x: points.points.map((p) => p.i),
            y: points.points.map((p) => p.q),
            kind: 'dots',
            tone: 1,
          },
        ],
        xLabel: w('inPhase'),
        yLabel: w('quadrature'),
        square: true,
      }}
    />
  );
}

function ModulationMode() {
  const [state, set] = useStored('comms.modulation', MODULATION);
  const curve = useRef<PlotHandle>(null);
  const outcome = useMemo(() => attempt(() => modulate(state)), [state]);
  const fields = <ModulationFields state={state} set={set} />;
  if (!outcome.ok)
    return (
      <>
        {fields}
        <Problem text={outcome.problem} />
      </>
    );
  const value = outcome.value;
  const answer = w('berAnswer', { ber: value.ber.ber.toExponential(4), ebN0: state.ebN0 });
  return (
    <>
      {fields}
      {isApproximate(state.scheme) ? <Note>{w('approxNote')}</Note> : null}
      <Results
        rows={[
          [w('snrResult'), `${fmt(value.snr.snrDb)} dB`],
          [w('esN0'), `${fmt(value.snr.esN0Db)} dB`],
          [w('measuredSer'), fmt(value.points.symbolErrors, 4)],
          [w('eyeOpening'), fmt(value.eye.opening, 4)],
        ]}
      />
      <ConstellationPlot points={value.points} />
      <Plot
        ref={curve}
        title={w('berTitle')}
        spec={{
          series: [{ label: w(`schemes.${state.scheme}`), x: value.grid, y: value.curve }],
          xLabel: w('ebN0Axis'),
          yLabel: w('logBer'),
          markers: [{ x: num(state.ebN0), label: `${state.ebN0} dB` }],
        }}
      />
      <Plot
        title={w('eyeTitle')}
        spec={{
          series: [{ label: w('traces'), x: value.eye.x, y: value.eye.y, tone: 2 }],
          xLabel: w('symbolTime'),
          yLabel: w('amplitude'),
        }}
      />
      <Outcome
        answer={answer}
        steps={[...value.ber.steps, ...value.snr.steps]}
        latex={String.raw`P_b = Q\!\left(\sqrt{2E_b/N_0}\right)`}
        picture={() => curve.current?.picture('ber-curve') ?? Promise.resolve(null)}
      />
    </>
  );
}

export function CommsTool() {
  const [state, set] = useStored('comms', { mode: 'information' as Mode });
  return (
    <div className={styles.tool}>
      <Tabs
        label={t('kitSignals.ui.modes')}
        value={state.mode}
        options={MODES}
        name={(mode) => w(`modes.${mode}`)}
        onChange={(mode) => set({ mode })}
      >
        {state.mode === 'information' ? <InformationMode /> : null}
        {state.mode === 'capacity' ? <CapacityMode /> : null}
        {state.mode === 'source' ? <SourceMode /> : null}
        {state.mode === 'block' ? <BlockMode /> : null}
        {state.mode === 'crc' ? <CrcMode /> : null}
        {state.mode === 'convolutional' ? <ConvolutionalMode /> : null}
        {state.mode === 'modulation' ? <ModulationMode /> : null}
      </Tabs>
    </div>
  );
}
