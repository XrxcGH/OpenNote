// Networks. IPv4 subnets from CIDR notation, VLSM plans, and IPv6 address forms. Delays cover transmission,
// propagation, queueing, and the bandwidth-delay product; TCP throughput comes by the window and by the Mathis
// approximation. Stop-and-wait, go-back-N, and selective repeat are run round by round. Routing tables come by link
// state (Dijkstra at each router) and by distance vector (Bellman-Ford exchange rounds).
import { fail } from '../core/util';
import { adjacency, dijkstra, parseGraph } from '../algorithms/graphs';

/* ---------- IPv4 ---------- */

export const ipText = (x: number): string => [24, 16, 8, 0].map((s) => (x >>> s) & 255).join('.');

export function parseIp(text: string): number {
  const parts = text.trim().split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) fail('ipv4', { text });
  return parts.reduce((a, p) => a * 256 + Number(p), 0);
}

export function parseCidr(text: string): { ip: number; prefix: number } {
  const m = /^\s*([\d.]+)\s*\/\s*(\d{1,2})\s*$/.exec(text);
  if (!m || Number(m[2]) > 32) return fail('cidr', { text });
  return { ip: parseIp(m[1]), prefix: Number(m[2]) };
}

export interface Subnet {
  network: number;
  broadcast: number;
  prefix: number;
  mask: number;
  first: number;
  last: number;
  hosts: number;
}

export function subnet(ip: number, prefix: number): Subnet {
  const size = 2 ** (32 - prefix);
  const network = Math.floor(ip / size) * size;
  const broadcast = network + size - 1;
  const mask = 2 ** 32 - size;
  if (prefix >= 31) return { network, broadcast, prefix, mask, first: network, last: broadcast, hosts: size };
  return { network, broadcast, prefix, mask, first: network + 1, last: broadcast - 1, hosts: size - 2 };
}

/** Subnets for each host count, largest first, packed from the start of the block. */
export function vlsm(block: { ip: number; prefix: number }, needs: readonly { name: string; hosts: number }[]) {
  const base = subnet(block.ip, block.prefix);
  let at = base.network;
  const order = needs.map((n, i) => ({ ...n, i })).sort((a, b) => b.hosts - a.hosts || a.i - b.i);
  const out: (Subnet & { name: string; need: number })[] = [];
  for (const n of order) {
    if (!(n.hosts >= 1) || !Number.isInteger(n.hosts)) fail('hostCount', { name: n.name });
    let prefix = 30;
    while (prefix > 0 && 2 ** (32 - prefix) - 2 < n.hosts) prefix -= 1;
    const size = 2 ** (32 - prefix);
    at = Math.ceil(at / size) * size;
    if (at + size - 1 > base.broadcast) fail('vlsmFull', { name: n.name });
    out.push({ ...subnet(at, prefix), name: n.name, need: n.hosts });
    at += size;
  }
  return { subnets: out, used: at - base.network, total: base.broadcast - base.network + 1 };
}

/* ---------- IPv6 ---------- */

export function parseIpv6(text: string): number[] {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/\/\d+$/, '');
  if (!/^[0-9a-f:]+$/.test(t) || (t.match(/::/g) ?? []).length > 1) fail('ipv6', { text });
  const [head, tail] = t.includes('::') ? t.split('::') : [t, null];
  const hs = head ? head.split(':') : [];
  const ts = tail === null ? [] : tail ? tail.split(':') : [];
  const fill = tail === null ? 0 : 8 - hs.length - ts.length;
  const groups = [...hs, ...new Array(Math.max(0, fill)).fill('0'), ...ts];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g)) || fill < 0) fail('ipv6', { text });
  return groups.map((g) => parseInt(g, 16));
}

export const ipv6Full = (g: readonly number[]): string => g.map((x) => x.toString(16).padStart(4, '0')).join(':');

/** The shortest form: leading zeros dropped and the longest run of 2 or more zero groups as ::. */
export function ipv6Short(g: readonly number[]): string {
  let best = -1;
  let len = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j += 1;
    if (j - i > len && j - i >= 2) {
      best = i;
      len = j - i;
    }
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (best < 0) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + len).join(':')}`;
}

export function ipv6Network(g: readonly number[], prefix: number): number[] {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) fail('ipv6Prefix');
  return g.map((x, i) => {
    const bits = Math.max(0, Math.min(16, prefix - 16 * i));
    return bits === 16 ? x : bits === 0 ? 0 : x & (0xffff << (16 - bits)) & 0xffff;
  });
}

/* ---------- Delays and protocols ---------- */

export interface Link {
  bits: number;
  rate: number;
  distance: number;
  speed: number;
  queue: number;
  processing: number;
}

export function delays(l: Link) {
  if (!(l.rate > 0 && l.speed > 0) || l.bits < 0 || l.distance < 0) fail('linkValues');
  const transmission = l.bits / l.rate;
  const propagation = l.distance / l.speed;
  const total = transmission + propagation + l.queue + l.processing;
  return { transmission, propagation, total, bdp: l.rate * propagation, bdpRtt: l.rate * 2 * propagation };
}

export const windowThroughput = (windowBits: number, rtt: number): number => windowBits / rtt;
/** Mathis et al.: throughput ≈ (MSS / RTT) · √(3/2) / √p. */
export const mathis = (mssBits: number, rtt: number, loss: number): number =>
  (mssBits / rtt) * (Math.sqrt(1.5) / Math.sqrt(loss));

export type Arq = 'stopwait' | 'gbn' | 'sr';

/** Rounds of sending: each frame in `lost` is lost on its first try only. */
export function arqRounds(kind: Arq, frames: number, window: number, lost: ReadonlySet<number>) {
  if (!Number.isInteger(frames) || frames < 1 || frames > 500) fail('frameCount', { max: 500 });
  const w = kind === 'stopwait' ? 1 : window;
  if (!Number.isInteger(w) || w < 1) fail('window');
  const tried = new Set<number>();
  const rounds: { sent: number[]; lost: number[] }[] = [];
  const acked = new Set<number>();
  let base = 0;
  while (acked.size < frames && rounds.length < 10_000) {
    const sent: number[] = [];
    const gone: number[] = [];
    if (kind === 'sr') {
      for (let k = base; k < frames && sent.length < w; k += 1) if (!acked.has(k)) sent.push(k);
    } else for (let k = base; k < Math.min(frames, base + w); k += 1) sent.push(k);
    let broken = false;
    for (const k of sent) {
      const lose = lost.has(k) && !tried.has(k);
      tried.add(k);
      if (lose) {
        gone.push(k);
        broken = true;
      } else if (kind === 'sr' || !broken) acked.add(k);
    }
    while (acked.has(base)) base += 1;
    rounds.push({ sent, lost: gone });
  }
  return { rounds, transmissions: rounds.reduce((a, r) => a + r.sent.length, 0) };
}

/** Sender utilization: the share of time spent sending with a window of w frames. */
export const utilization = (frameTime: number, rtt: number, w: number): number =>
  Math.min(1, (w * frameTime) / (rtt + frameTime));

/* ---------- Routing ---------- */

export function linkState(edges: string) {
  const g = parseGraph(edges, false);
  if (g.edges.some((e) => e.w < 0)) fail('negativeCost');
  return {
    nodes: g.nodes,
    tables: g.nodes.map((src) => {
      const r = dijkstra(g, src);
      return g.nodes.map((dst) => {
        let hop = dst;
        while (r.prev.get(hop) !== undefined && r.prev.get(hop) !== src) hop = r.prev.get(hop)!;
        return { dst, cost: r.dist.get(dst)!, next: dst === src ? '—' : r.dist.get(dst) === Infinity ? '—' : hop };
      });
    }),
  };
}

/** Synchronous distance-vector exchange: each round every router reads its neighbors' vectors from the round before. */
export function distanceVector(edges: string) {
  const g = parseGraph(edges, false);
  const adj = adjacency(g);
  const n = g.nodes;
  let dv = new Map(
    n.map((a) => [a, new Map(n.map((b) => [b, { cost: a === b ? 0 : Infinity, next: a === b ? '—' : '—' }]))]),
  );
  let rounds = 0;
  for (; rounds < n.length + 2; rounds += 1) {
    let changed = false;
    const next = new Map(n.map((a) => [a, new Map(dv.get(a)!)]));
    for (const a of n)
      for (const b of n) {
        if (a === b) continue;
        let best = { cost: Infinity, next: '—' };
        for (const arc of adj.get(a)!) {
          const c = arc.w + dv.get(arc.to)!.get(b)!.cost;
          if (c < best.cost) best = { cost: c, next: arc.to };
        }
        if (best.cost !== dv.get(a)!.get(b)!.cost) changed = true;
        next.get(a)!.set(b, best);
      }
    dv = next;
    if (!changed) break;
  }
  return { nodes: n, dv, rounds };
}
