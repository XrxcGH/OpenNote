// The computer systems tool's network, logical clock, relational design, relational algebra, and digest modes.
import { fail, lines, num } from '../core/util';
import type { Mode, Outcome, Values } from '../ui/types';
import { evaluate, parseTables } from './algebra';
import { relation, runClocks } from './clocks';
import { f, list, one, pick, qty, s, solveWith, whole, yes } from './common';
import { DIGESTS, bytesOf } from './hash';
import type { HashAlgo } from './hash';
import {
  arqRounds,
  delays,
  distanceVector,
  ipText,
  ipv6Full,
  ipv6Network,
  ipv6Short,
  linkState,
  mathis,
  parseCidr,
  parseIpv6,
  subnet,
  utilization,
  vlsm,
  windowThroughput,
} from './net';
import type { Arq } from './net';
import {
  attrSet,
  bcnf,
  candidateKeys,
  closure,
  fdText,
  lossless,
  lostDependencies,
  minimalCover,
  normalForm,
  parseSchema,
  setText,
  synthesize3nf,
} from './relational';

const bin = (x: number) => [24, 16, 8, 0].map((k) => ((x >>> k) & 255).toString(2).padStart(8, '0')).join('.');
/** Seconds as ms (or µs when small). */
const ms = (sec: number) =>
  Math.abs(sec) < 1e-3 && sec !== 0 ? s('us', { x: num(sec * 1e6, 6) }) : s('ms', { x: num(sec * 1e3, 6) });
const rate = (bps: number) =>
  bps >= 1e9
    ? s('gbps', { x: num(bps / 1e9, 6) })
    : bps >= 1e6
      ? s('mbps', { x: num(bps / 1e6, 6) })
      : bps >= 1e3
        ? s('kbps', { x: num(bps / 1e3, 6) })
        : s('bps', { x: num(bps, 6) });

/* ---------- Addressing ---------- */

function subnetOutcome(v: Values): Outcome {
  const c = parseCidr(v.cidr ?? '');
  const n = subnet(c.ip, c.prefix);
  const size = 2 ** (32 - c.prefix);
  return {
    ok: true,
    answer: s('subnetAnswer', {
      network: ipText(n.network),
      prefix: c.prefix,
      first: ipText(n.first),
      last: ipText(n.last),
      broadcast: ipText(n.broadcast),
      hosts: n.hosts,
    }),
    latex: `2^{32 - ${c.prefix}} - 2 = ${n.hosts}`,
    note: c.prefix >= 31 ? s('pointToPoint') : c.ip !== n.network ? s('hostInNet', { ip: ipText(c.ip) }) : undefined,
    steps: [
      s('steps.block', { prefix: c.prefix, size }),
      s('steps.network', { ip: ipText(c.ip), network: ipText(n.network) }),
      s('steps.broadcast', { network: ipText(n.network), size, broadcast: ipText(n.broadcast) }),
      s('steps.hosts', { size, hosts: n.hosts }),
    ],
    tables: [
      {
        caption: s('table.subnet'),
        header: [s('table.item'), s('table.dotted'), s('table.binary')],
        rows: [
          [s('table.addressItem'), ipText(c.ip), bin(c.ip)],
          [s('table.mask'), ipText(n.mask), bin(n.mask)],
          [s('table.wildcard'), ipText(2 ** 32 - 1 - n.mask), bin(2 ** 32 - 1 - n.mask)],
          [s('table.networkItem'), ipText(n.network), bin(n.network)],
          [s('table.broadcastItem'), ipText(n.broadcast), bin(n.broadcast)],
        ],
      },
    ],
  };
}

function vlsmOutcome(v: Values): Outcome {
  const block = parseCidr(v.block ?? '');
  const needs = lines(v.needs ?? '').map((l) => {
    const m = /^(\S+)\s+(\d+)$/.exec(l);
    return m ? { name: m[1], hosts: Number(m[2]) } : fail('needLine', { line: l });
  });
  if (!needs.length) fail('noNeeds');
  const r = vlsm(block, needs);
  return {
    ok: true,
    answer: s('vlsmAnswer', { count: r.subnets.length, used: r.used, total: r.total }),
    steps: [
      s('steps.vlsm'),
      ...r.subnets.map((x) =>
        s('steps.vlsmOne', {
          name: x.name,
          need: x.need,
          prefix: x.prefix,
          size: 2 ** (32 - x.prefix),
          network: ipText(x.network),
        }),
      ),
    ],
    tables: [
      {
        caption: s('table.plan'),
        header: [
          s('table.name'),
          s('table.need'),
          s('table.subnetCol'),
          s('table.mask'),
          s('table.range'),
          s('table.broadcastItem'),
          s('table.spare'),
        ],
        rows: r.subnets.map((x) => [
          x.name,
          String(x.need),
          `${ipText(x.network)}/${x.prefix}`,
          ipText(x.mask),
          `${ipText(x.first)}–${ipText(x.last)}`,
          ipText(x.broadcast),
          String(x.hosts - x.need),
        ]),
      },
    ],
  };
}

function ipv6Outcome(v: Values): Outcome {
  const g = parseIpv6(v.ipv6 ?? '');
  const prefix = whole(v, 'prefix6');
  const net = ipv6Network(g, prefix);
  const bits = 128 - prefix;
  return {
    ok: true,
    answer: s('ipv6Answer', { short: ipv6Short(g), network: `${ipv6Short(net)}/${prefix}` }),
    latex: `2^{128 - ${prefix}} = 2^{${bits}}`,
    steps: [s('steps.ipv6Full', { full: ipv6Full(g) }), s('steps.ipv6Short'), s('steps.ipv6Net', { prefix })],
    tables: [
      {
        caption: s('table.ipv6'),
        header: [s('table.item'), s('table.value')],
        rows: [
          [s('table.full'), ipv6Full(g)],
          [s('table.short'), ipv6Short(g)],
          [s('table.networkItem'), `${ipv6Short(net)}/${prefix}`],
          [s('table.addresses'), bits <= 52 ? String(2 ** bits) : `2^${bits}`],
        ],
      },
    ],
  };
}

/* ---------- Delays and protocols ---------- */

function delaysOutcome(v: Values): Outcome {
  const link = {
    bits: qty(v, 'packet', 'size', 8),
    rate: qty(v, 'rate', 'rate'),
    distance: qty(v, 'distance', 'distance', 1000),
    speed: qty(v, 'speed', 'speed'),
    queue: qty(v, 'queue', 'time', 1e-3),
    processing: qty(v, 'processing', 'time', 1e-3),
  };
  if (link.queue < 0 || link.processing < 0) fail('linkValues');
  const d = delays(link);
  return {
    ok: true,
    answer: s('delayAnswer', { total: ms(d.total), tx: ms(d.transmission), prop: ms(d.propagation) }),
    latex: `d = \\frac{L}{R} + \\frac{d}{s} + d_q + d_p = ${num(d.total * 1e3, 6)}\\ \\text{ms}`,
    note: s('bdpNote', { bdp: num(d.bdp, 6), bytes: num(d.bdp / 8, 6), rtt: num(d.bdpRtt, 6) }),
    steps: [
      s('steps.tx', { bits: num(link.bits), rate: num(link.rate), t: ms(d.transmission) }),
      s('steps.prop', { m: num(link.distance), speed: num(link.speed), t: ms(d.propagation) }),
      s('steps.total', { t: ms(d.total) }),
      s('steps.bdp', { bdp: num(d.bdp, 6) }),
    ],
  };
}

function throughputOutcome(v: Values): Outcome {
  const kind = pick(v, 'tcp', ['window', 'mathis']);
  const rtt = qty(v, 'rtt', 'time', 1e-3);
  if (!(rtt > 0)) fail('positive');
  if (kind === 'window') {
    const w = qty(v, 'windowSize', 'size', 8);
    const t = windowThroughput(w, rtt);
    return {
      ok: true,
      answer: s('windowAnswer', { r: rate(t) }),
      latex: `\\frac{W}{\\text{RTT}} = \\frac{${num(w)}}{${num(rtt)}} = ${num(t, 6)}\\ \\text{bit/s}`,
      steps: [s('steps.window')],
    };
  }
  const mss = qty(v, 'mss', 'size', 8);
  const p = one(v, 'loss');
  if (!(p > 0 && p < 1)) fail('fraction', { field: s('fields.loss') });
  const t = mathis(mss, rtt, p);
  return {
    ok: true,
    answer: s('mathisAnswer', { r: rate(t) }),
    latex: `\\frac{\\text{MSS}}{\\text{RTT}} \\cdot \\frac{\\sqrt{3/2}}{\\sqrt{p}} = ${num(t, 6)}\\ \\text{bit/s}`,
    steps: [s('steps.mathis')],
  };
}

function arqOutcome(v: Values): Outcome {
  const kind = pick<Arq>(v, 'arq', ['stopwait', 'gbn', 'sr']);
  const frames = whole(v, 'frameCount', 1);
  const w = kind === 'stopwait' ? 1 : whole(v, 'window', 1);
  const lostText = (v.lost ?? '').trim();
  const lost = lostText ? list(v, 'lost') : [];
  if (lost.some((x) => !Number.isInteger(x) || x < 0 || x >= frames)) fail('lostFrames', { max: frames - 1 });
  const r = arqRounds(kind, frames, w, new Set(lost));
  const tf = qty(v, 'frameTime', 'time', 1e-3);
  const rtt = qty(v, 'rtt', 'time', 1e-3);
  if (!(tf > 0) || rtt < 0) fail('positive');
  const u = utilization(tf, rtt, w);
  return {
    ok: true,
    answer: s('arqAnswer', { sent: r.transmissions, frames, rounds: r.rounds.length, u: num(u * 100, 4) }),
    latex: `U = \\min\\left(1, \\frac{W T_f}{\\text{RTT} + T_f}\\right) = ${num(u, 6)}`,
    steps: [s(`steps.arq_${kind}`)],
    tables: [
      {
        caption: s('table.rounds'),
        header: [s('table.round'), s('table.sent'), s('table.lostDeps')],
        rows: r.rounds.map((x, i) => [String(i + 1), x.sent.join(', '), x.lost.join(', ')]),
      },
    ],
  };
}

function routingOutcome(v: Values): Outcome {
  const kind = pick(v, 'routing', ['linkstate', 'dv']);
  const cell = (cost: number, next: string) =>
    cost === Infinity ? '∞' : next === '—' ? num(cost) : `${num(cost)} (${next})`;
  if (kind === 'linkstate') {
    const r = linkState(v.links ?? '');
    return {
      ok: true,
      answer: s('routingAnswer', { count: r.nodes.length }),
      steps: [s('steps.linkState')],
      tables: [
        {
          caption: s('table.routes'),
          header: [s('table.router'), ...r.nodes],
          rows: r.nodes.map((q, i) => [q, ...r.tables[i].map((e) => cell(e.cost, e.next))]),
        },
      ],
    };
  }
  const r = distanceVector(v.links ?? '');
  return {
    ok: true,
    answer: s('routingAnswer', { count: r.nodes.length }),
    note: s('dvRounds', { rounds: r.rounds }),
    steps: [s('steps.distanceVector')],
    tables: [
      {
        caption: s('table.routes'),
        header: [s('table.router'), ...r.nodes],
        rows: r.nodes.map((a) => [
          a,
          ...r.nodes.map((b) => cell(r.dv.get(a)!.get(b)!.cost, r.dv.get(a)!.get(b)!.next)),
        ]),
      },
    ],
  };
}

/* ---------- Clocks ---------- */

function clocksOutcome(v: Values): Outcome {
  const r = runClocks(v.events ?? '');
  const all = r.events.flat();
  const find = (id: string) =>
    all.find((e) => e.id.toLowerCase() === id.trim().toLowerCase()) ?? fail('noEvent', { id: id.trim() });
  const a = (v.eventA ?? '').trim();
  const b = (v.eventB ?? '').trim();
  const rel = a && b ? relation(find(a), find(b)) : null;
  return {
    ok: true,
    answer: rel ? s(`rel_${rel}`, { a, b }) : s('clocksAnswer', { count: all.length }),
    steps: [s('steps.lamport'), s('steps.vector'), s('steps.happened')],
    tables: [
      {
        caption: s('table.clocks'),
        header: [s('table.event'), s('table.process'), s('table.label'), s('table.lamport'), s('table.vectorCol')],
        rows: all.map((e) => [e.id, r.processes[e.process], e.label, String(e.lamport), `[${e.vector.join(', ')}]`]),
      },
    ],
  };
}

/* ---------- Relational design ---------- */

function fdsOutcome(v: Values): Outcome {
  const sc = parseSchema(v.attrs ?? '', v.fds ?? '');
  const n = sc.attrs.length;
  const t = (m: number) => `{${sc.attrs.filter((_, i) => m & (1 << i)).join(', ')}}`;
  const rel = (m: number) => `(${sc.attrs.filter((_, i) => m & (1 << i)).join(', ')})`;
  const x = (v.closureOf ?? '').trim() ? attrSet(sc.attrs, v.closureOf ?? '') : null;
  const used: typeof sc.fds = [];
  const cx = x === null ? null : closure(x, sc.fds, used);
  const keys = candidateKeys(n, sc.fds);
  const cover = minimalCover(sc.fds, sc.attrs);
  const nf = normalForm(n, sc.fds);
  const b = bcnf(sc.attrs, sc.fds);
  const third = synthesize3nf(n, sc.fds);
  const check = (parts: number[]) => [
    yes(lossless(n, sc.fds, parts)),
    lostDependencies(sc.fds, parts)
      .map((d) => fdText(sc.attrs, d))
      .join('; ') || s('none'),
  ];
  return {
    ok: true,
    answer: s('fdsAnswer', {
      closure: x === null ? '' : s('closureIs', { x: setText(sc.attrs, x), c: t(cx!) }),
      keys: keys.map((k) => setText(sc.attrs, k)).join(', '),
      bcnf: b.parts.map(rel).join(', '),
    }),
    note: s(`nf_${nf.form}`, { fd: nf.breaks ? fdText(sc.attrs, nf.breaks) : '' }),
    steps: [
      ...(x === null
        ? []
        : [
            s('steps.closureStart', { x: t(x) }),
            ...used.map((d) => s('steps.closureAdd', { fd: fdText(sc.attrs, d) })),
            s('steps.closureEnd', { c: t(cx!) }),
          ]),
      s('steps.keys'),
      ...cover.steps.map((st) => s(`steps.${st.key}`, st.vars)),
      ...b.steps.map((st) => s(`steps.${st.key}`, st.vars)),
      third.addedKey !== null ? s('steps.addKey', { key: rel(third.addedKey) }) : s('steps.keyHeld'),
    ],
    tables: [
      {
        caption: s('table.cover'),
        header: [s('table.dependency')],
        rows: cover.cover.map((d) => [fdText(sc.attrs, d)]),
      },
      {
        caption: s('table.decompositions'),
        header: [s('table.form'), s('table.relations'), s('table.lossless'), s('table.lost')],
        rows: [
          [s('table.bcnfRow'), b.parts.map(rel).join(', '), ...check(b.parts)],
          [s('table.thirdRow'), third.parts.map(rel).join(', '), ...check(third.parts)],
        ],
      },
    ],
  };
}

function algebraOutcome(v: Values): Outcome {
  const db = parseTables(v.tables ?? '');
  const { result, log } = evaluate(v.expr ?? '', db);
  return {
    ok: true,
    answer: s('algebraAnswer', { rows: result.rows.length, cols: result.attrs.length }),
    steps: log.map((x) => s(`steps.op_${x.op}`, { rows: x.rows })),
    tables: [
      {
        caption: s('table.result'),
        header: result.attrs,
        rows: result.rows.map((r) => r.map((c) => (typeof c === 'number' ? num(c, 12) : c))),
      },
    ],
  };
}

const HASHES: readonly HashAlgo[] = ['sha256', 'sha1', 'md5', 'crc32'];

function hashOutcome(v: Values): Outcome {
  const as = pick(v, 'inputAs', ['text', 'hex']);
  const bytes = bytesOf(v.input ?? '', as);
  if (bytes.length > 1_000_000) fail('inputLong');
  const rows = HASHES.map((h) => [s(`hashNames.${h}`), DIGESTS[h](bytes)]);
  return {
    ok: true,
    answer: s('hashAnswer', { digest: rows[0][1] }),
    note: s('hashNote', { bytes: bytes.length }),
    steps: [s('steps.hashBytes', { bytes: bytes.length }), s('steps.hashPad'), s('steps.hashWarn')],
    tables: [{ caption: s('table.digests'), header: [s('table.algorithm'), s('table.digest')], rows }],
  };
}

/* ---------- Modes ---------- */

export const SUBNET: Mode = {
  id: 'subnet',
  fields: [f('cidr', '192.168.10.0/26', { help: true })],
  solve: solveWith(subnetOutcome),
};

export const VLSM: Mode = {
  id: 'vlsm',
  fields: [f('block', '10.0.0.0/24'), f('needs', 'Sales 100\nLab 50\nLink 2', { kind: 'area', help: true })],
  solve: solveWith(vlsmOutcome),
};

export const IPV6: Mode = {
  id: 'ipv6',
  fields: [f('ipv6', '2001:0db8:0000:0000:0000:ff00:0042:8329', { wide: true }), f('prefix6', '64')],
  solve: solveWith(ipv6Outcome),
};

export const DELAYS: Mode = {
  id: 'delays',
  fields: [
    f('packet', '1500 B', { help: true }),
    f('rate', '10 Mbit/s', { help: true }),
    f('distance', '2000 km'),
    f('speed', '2e8 m/s'),
    f('queue', '0 ms'),
    f('processing', '0 ms'),
  ],
  solve: solveWith(delaysOutcome),
};

export const THROUGHPUT: Mode = {
  id: 'throughput',
  fields: (v) => [
    { id: 'tcp', kind: 'select', options: ['window', 'mathis'] },
    f('rtt', '100 ms'),
    ...(v.tcp === 'mathis' ? [f('mss', '1460 B'), f('loss', '0.01')] : [f('windowSize', '64 KiB')]),
  ],
  solve: solveWith(throughputOutcome),
};

export const ARQ: Mode = {
  id: 'arq',
  fields: (v) => [
    { id: 'arq', kind: 'select', options: ['stopwait', 'gbn', 'sr'] },
    f('frameCount', '6'),
    ...(v.arq === 'stopwait' || v.arq === undefined ? [] : [f('window', '4')]),
    f('lost', '2', { help: true }),
    f('frameTime', '1 ms'),
    f('rtt', '30 ms'),
  ],
  solve: solveWith(arqOutcome),
};

export const ROUTING: Mode = {
  id: 'routing',
  fields: [
    f('links', 'u v 2\nu w 5\nv w 3\nv x 2\nw x 1', { kind: 'area', help: true }),
    { id: 'routing', kind: 'select', options: ['linkstate', 'dv'] },
  ],
  solve: solveWith(routingOutcome),
};

export const CLOCKS: Mode = {
  id: 'clocks',
  fields: [
    f('events', 'P1: a, send m1, c\nP2: d, recv m1, send m2\nP3: recv m2, f', { kind: 'area', help: true }),
    f('eventA', 'P1.1'),
    f('eventB', 'P3.2'),
  ],
  solve: solveWith(clocksOutcome),
};

export const FDS: Mode = {
  id: 'fds',
  fields: [
    f('attrs', 'R(A, B, C, D)', { help: true }),
    f('fds', 'A -> B\nB -> C', { kind: 'area', help: true }),
    f('closureOf', 'A'),
  ],
  solve: solveWith(fdsOutcome),
};

export const ALGEBRA: Mode = {
  id: 'algebra',
  fields: [
    f('tables', 'Emp(name, dept, pay)\nAnn, CS, 50\nBob, EE, 60\nCy, CS, 70\n\nDept(dept, floor)\nCS, 3\nEE, 1', {
      kind: 'area',
      rows: 9,
      help: true,
    }),
    f('expr', 'project[name, floor](select[pay > 55](Emp join Dept))', { wide: true, help: true }),
  ],
  solve: solveWith(algebraOutcome),
};

export const HASH: Mode = {
  id: 'hash',
  fields: [f('input', 'abc', { kind: 'area', rows: 3 }), { id: 'inputAs', kind: 'select', options: ['text', 'hex'] }],
  solve: solveWith(hashOutcome),
};
