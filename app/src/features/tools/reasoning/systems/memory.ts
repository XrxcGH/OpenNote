// Memory systems. A cache splits each address into tag, index, and offset, and a trace runs through it. It replaces
// lines by LRU, FIFO, or a seeded random choice, and writes back or writes through. Also here: average memory access
// time over several levels, page replacement (FIFO, LRU, OPT, and Clock) with fault counts, and address translation
// through a page table and a TLB.
import { fail, seeded } from '../core/util';

const log2 = (n: number): number => {
  const k = Math.log2(n);
  return Number.isInteger(k) ? k : fail('powerOfTwo', { value: n });
};

export interface CacheShape {
  sets: number;
  ways: number;
  offset: number;
  index: number;
  tag: number;
  lines: number;
}

/** The shape of a cache of `bytes` with `line`-byte lines; ways 0 means fully associative. */
export function cacheShape(bytes: number, line: number, ways: number, addressBits: number): CacheShape {
  if (!(bytes > 0 && line > 0) || line > bytes) fail('cacheSizes');
  if (!Number.isInteger(addressBits) || addressBits < 4 || addressBits > 64) fail('addressBits');
  const lines = bytes / line;
  const w = ways === 0 ? lines : ways;
  if (!Number.isInteger(lines) || !Number.isInteger(w) || w < 1 || lines % w !== 0) fail('cacheWays');
  const sets = lines / w;
  const offset = log2(line);
  const index = log2(sets);
  log2(lines);
  const tag = addressBits - offset - index;
  if (tag < 0) fail('addressBits');
  return { sets, ways: w, offset, index, tag, lines };
}

export type Replace = 'lru' | 'fifo' | 'random';

export interface Access {
  write: boolean;
  address: number;
}

/** Accesses such as 0x1A2B, 4096, or W 0x40 (R is the default). */
export function parseAccesses(text: string): Access[] {
  const out: Access[] = [];
  for (const raw of text
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = /^(?:([RW])\s+)?(0x[0-9a-f]+|0b[01]+|\d+)$/i.exec(raw);
    if (!m) fail('accessLine', { line: raw });
    out.push({ write: m![1]?.toUpperCase() === 'W', address: Number(m![2]) });
  }
  if (!out.length) fail('noAccesses');
  if (out.length > 5000) fail('tooManyAccesses', { max: 5000 });
  return out;
}

export interface CacheRow {
  address: number;
  tag: number;
  set: number;
  offset: number;
  hit: boolean;
  evicted: number | null;
  writeBack: boolean;
}

export function simulateCache(
  shape: CacheShape,
  accesses: readonly Access[],
  replace: Replace,
  writeBack: boolean,
  seed = 1,
) {
  const rand = seeded(seed);
  const sets = Array.from(
    { length: shape.sets },
    () => [] as { tag: number; dirty: boolean; used: number; loaded: number }[],
  );
  const rows: CacheRow[] = [];
  let memoryWrites = 0;
  let clock = 0;
  for (const a of accesses) {
    clock += 1;
    const offset = a.address % 2 ** shape.offset;
    const set = Math.floor(a.address / 2 ** shape.offset) % shape.sets;
    const tag = Math.floor(a.address / 2 ** (shape.offset + shape.index));
    const lines = sets[set];
    const hit = lines.find((l) => l.tag === tag);
    let evicted: number | null = null;
    let wb = false;
    if (hit) {
      hit.used = clock;
      if (a.write) {
        if (writeBack) hit.dirty = true;
        else memoryWrites += 1;
      }
    } else if (a.write && !writeBack) {
      // Write-through without write-allocate: the write goes to memory only.
      memoryWrites += 1;
    } else {
      if (lines.length >= shape.ways) {
        const victim =
          replace === 'random'
            ? Math.floor(rand() * lines.length)
            : lines.reduce(
                (best, l, i) =>
                  (replace === 'lru' ? l.used < lines[best].used : l.loaded < lines[best].loaded) ? i : best,
                0,
              );
        evicted = lines[victim].tag;
        if (lines[victim].dirty) {
          wb = true;
          memoryWrites += 1;
        }
        lines.splice(victim, 1);
      }
      lines.push({ tag, dirty: a.write && writeBack, used: clock, loaded: clock });
    }
    rows.push({ address: a.address, tag, set, offset, hit: !!hit, evicted, writeBack: wb });
  }
  const hits = rows.filter((r) => r.hit).length;
  return { rows, hits, misses: rows.length - hits, memoryWrites };
}

/** Average memory access time: hit time plus miss rate times the next level's time, ending at memory. */
export function amat(
  levels: readonly { hit: number; missRate: number }[],
  memory: number,
): { total: number; parts: number[] } {
  if (!levels.length) fail('noLevels');
  for (const l of levels) if (!(l.missRate >= 0 && l.missRate <= 1) || l.hit < 0) fail('levelValues');
  if (!(memory >= 0)) fail('levelValues');
  const parts: number[] = [];
  let t = memory;
  for (let i = levels.length - 1; i >= 0; i -= 1) {
    t = levels[i].hit + levels[i].missRate * t;
    parts.unshift(t);
  }
  return { total: t, parts };
}

/* ---------- Page replacement ---------- */

export type PageAlgo = 'fifo' | 'lru' | 'opt' | 'clock';

export interface PageRun {
  faults: number;
  /** Frame contents after each reference, and whether it faulted. */
  rows: { page: number; frames: (number | null)[]; fault: boolean; out: number | null }[];
}

export function replacePages(refs: readonly number[], frames: number, algo: PageAlgo): PageRun {
  if (!Number.isInteger(frames) || frames < 1 || frames > 64) fail('frames');
  const mem: (number | null)[] = new Array(frames).fill(null);
  const loaded = new Array<number>(frames).fill(0);
  const used = new Array<number>(frames).fill(0);
  const ref = new Array<boolean>(frames).fill(false);
  let hand = 0;
  let faults = 0;
  const rows: PageRun['rows'] = [];
  refs.forEach((p, t) => {
    const at = mem.indexOf(p);
    if (at >= 0) {
      used[at] = t;
      ref[at] = true;
      rows.push({ page: p, frames: [...mem], fault: false, out: null });
      return;
    }
    faults += 1;
    let slot = mem.indexOf(null);
    if (slot < 0) {
      if (algo === 'fifo') slot = loaded.indexOf(Math.min(...loaded));
      else if (algo === 'lru') slot = used.indexOf(Math.min(...used));
      else if (algo === 'opt') {
        const next = mem.map((q) => {
          const k = refs.indexOf(q!, t + 1);
          return k < 0 ? Infinity : k;
        });
        slot = next.indexOf(Math.max(...next));
      } else {
        while (ref[hand]) {
          ref[hand] = false;
          hand = (hand + 1) % frames;
        }
        slot = hand;
        hand = (hand + 1) % frames;
      }
    } else if (algo === 'clock') hand = (slot + 1) % frames;
    const out = mem[slot];
    mem[slot] = p;
    loaded[slot] = t;
    used[slot] = t;
    ref[slot] = true;
    rows.push({ page: p, frames: [...mem], fault: true, out });
  });
  return { faults, rows };
}

/* ---------- Address translation ---------- */

export interface Translation {
  virtual: number;
  page: number;
  offset: number;
  tlbHit: boolean;
  frame: number | null;
  physical: number | null;
}

/** Translates through a page table (page → frame, or - when not present) with an LRU TLB of the given size. */
export function translate(
  pageSize: number,
  table: ReadonlyMap<number, number | null>,
  tlbSize: number,
  addresses: readonly number[],
): Translation[] {
  log2(pageSize);
  if (!Number.isInteger(tlbSize) || tlbSize < 0 || tlbSize > 256) fail('tlbSize');
  const tlb: { page: number; frame: number }[] = [];
  return addresses.map((v) => {
    const page = Math.floor(v / pageSize);
    const offset = v % pageSize;
    const hit = tlb.findIndex((e) => e.page === page);
    if (hit >= 0) {
      const [e] = tlb.splice(hit, 1);
      tlb.push(e);
      return { virtual: v, page, offset, tlbHit: true, frame: e.frame, physical: e.frame * pageSize + offset };
    }
    const frame = table.get(page) ?? null;
    if (frame !== null && tlbSize > 0) {
      if (tlb.length >= tlbSize) tlb.shift();
      tlb.push({ page, frame });
    }
    return {
      virtual: v,
      page,
      offset,
      tlbHit: false,
      frame,
      physical: frame === null ? null : frame * pageSize + offset,
    };
  });
}
