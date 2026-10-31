// Logical clocks. Each process is a line of events: a local event's name, `send m`, or `recv m`. From them come
// Lamport timestamps, vector clocks, and the happened-before relation between any 2 events.
import { fail, lines } from '../core/util';

export interface Event {
  id: string;
  process: number;
  label: string;
  send?: string;
  recv?: string;
  lamport: number;
  vector: number[];
}

/** Lines such as `P1: a, send m1, c` and `P2: recv m1, d`. */
export function runClocks(text: string): { processes: string[]; events: Event[][] } {
  const rows = lines(text).map((l) => {
    const m = /^([^:]+):(.*)$/.exec(l);
    if (!m) fail('clockLine', { line: l });
    const items = m![2]
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return { name: m![1].trim(), items };
  });
  if (!rows.length) fail('noProcesses');
  const n = rows.length;
  const events: Event[][] = rows.map(() => []);
  const sent = new Map<string, { lamport: number; vector: number[] }>();
  const pos = rows.map(() => 0);
  const lam = rows.map(() => 0);
  const vec = rows.map(() => new Array<number>(n).fill(0));
  const seen = new Set<string>();
  for (let progress = true; progress;) {
    progress = false;
    for (let p = 0; p < n; p += 1)
      while (pos[p] < rows[p].items.length) {
        const item = rows[p].items[pos[p]];
        const sm = /^send\s+(\S+)$/i.exec(item);
        const rm = /^(?:recv|receive)\s+(\S+)$/i.exec(item);
        if (rm && !sent.has(rm[1])) break;
        lam[p] += 1;
        vec[p][p] += 1;
        if (rm) {
          const msg = sent.get(rm[1])!;
          lam[p] = Math.max(lam[p], msg.lamport + 1);
          vec[p] = vec[p].map((x, i) => (i === p ? x : Math.max(x, msg.vector[i])));
        }
        if (sm) {
          if (seen.has(sm[1])) fail('messageTwice', { m: sm[1] });
          seen.add(sm[1]);
          sent.set(sm[1], { lamport: lam[p], vector: [...vec[p]] });
        }
        events[p].push({
          id: `${rows[p].name}.${pos[p] + 1}`,
          process: p,
          label: item,
          send: sm?.[1],
          recv: rm?.[1],
          lamport: lam[p],
          vector: [...vec[p]],
        });
        pos[p] += 1;
        progress = true;
      }
  }
  const stuck = pos.findIndex((x, p) => x < rows[p].items.length);
  if (stuck >= 0) fail('neverSent', { item: rows[stuck].items[pos[stuck]] });
  return { processes: rows.map((r) => r.name), events };
}

/** a → b when a's vector is at most b's everywhere and they differ. */
export function relation(a: Event, b: Event): 'before' | 'after' | 'concurrent' | 'same' {
  if (a.id === b.id) return 'same';
  const le = a.vector.every((x, i) => x <= b.vector[i]);
  const ge = a.vector.every((x, i) => x >= b.vector[i]);
  return le ? 'before' : ge ? 'after' : 'concurrent';
}
