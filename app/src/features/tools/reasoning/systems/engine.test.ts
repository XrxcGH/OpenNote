// Computer systems, networks, and databases: each validation case from the plan with its expected value worked by
// hand or taken from a published test vector, plus the edge cases each error message covers.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KitError } from '../core/util';
import { evaluate, parseTables } from './algebra';
import { relation, runClocks } from './clocks';
import {
  amdahl,
  cpiOf,
  gustafson,
  parseProcs,
  parseProgram,
  parseTasks,
  pipeline,
  predict,
  responseTimes,
  rmBound,
  schedule,
} from './cpu';
import { ragCycle, request, safety } from './deadlock';
import { bytesOf, crc32, md5, sha1, sha256 } from './hash';
import { amat, cacheShape, parseAccesses, replacePages, simulateCache, translate } from './memory';
import {
  arqRounds,
  delays,
  distanceVector,
  ipText,
  ipv6Network,
  ipv6Short,
  linkState,
  mathis,
  parseCidr,
  parseIpv6,
  subnet,
  vlsm,
} from './net';
import {
  attrSet,
  bcnf,
  candidateKeys,
  closure,
  lossless,
  lostDependencies,
  minimalCover,
  normalForm,
  parseSchema,
  setText,
  synthesize3nf,
} from './relational';
import { quantity } from './units';

const key = (run: () => unknown): string => {
  try {
    run();
  } catch (e) {
    if (e instanceof KitError) return e.key;
    throw e;
  }
  return 'none';
};

describe('caches and memory', () => {
  it('splits a 32 KB 4-way cache with 64-byte lines into tag 19, index 7, offset 6', () => {
    const s = cacheShape(32 * 1024, 64, 4, 32);
    expect([s.offset, s.index, s.tag, s.sets]).toEqual([6, 7, 19, 128]);
  });

  it('gives AMAT 1 + 0.05 × 100 = 6 cycles, and adds levels from memory up', () => {
    expect(amat([{ hit: 1, missRate: 0.05 }], 100).total).toBe(6);
    // L1 1 + 0.1 × (L2 10 + 0.2 × 100) = 1 + 0.1 × 30 = 4.
    expect(
      amat(
        [
          { hit: 1, missRate: 0.1 },
          { hit: 10, missRate: 0.2 },
        ],
        100,
      ).total,
    ).toBeCloseTo(4, 12);
  });

  it('runs a trace through a direct-mapped cache with conflict misses', () => {
    // 4 lines of 16 bytes, direct-mapped: 0 and 64 both map to set 0 and evict each other.
    const shape = cacheShape(64, 16, 1, 16);
    const r = simulateCache(shape, parseAccesses('0, 4, 64, 0, 16'), 'lru', true);
    expect(r.rows.map((x) => x.hit)).toEqual([false, true, false, false, false]);
    expect(r.hits).toBe(1);
  });

  it('keeps both lines in a 2-way set under LRU, and writes back a dirty victim', () => {
    const shape = cacheShape(64, 16, 2, 16);
    const r = simulateCache(shape, parseAccesses('W 0, 32, 0, 64, 32'), 'lru', true);
    // Set 0 holds tags of 0 and 32; 64 evicts the least recent (32), then 32 evicts dirty 0.
    expect(r.rows.map((x) => x.hit)).toEqual([false, false, true, false, false]);
    expect(r.memoryWrites).toBe(1);
  });

  it('finds 9 and 10 FIFO faults with 3 and 4 frames (Belady), 10 under LRU, and 7 under OPT', () => {
    const refs = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5];
    expect(replacePages(refs, 3, 'fifo').faults).toBe(9);
    expect(replacePages(refs, 4, 'fifo').faults).toBe(10);
    expect(replacePages(refs, 3, 'lru').faults).toBe(10);
    expect(replacePages(refs, 3, 'opt').faults).toBe(7);
  });

  it('counts Clock faults: the second chance spares a referenced page', () => {
    // Worked by hand: 7 0 1 2 0 3 0 4 with 3 frames; 2 clears every bit and takes 7's frame, 3 takes 1's (its bit
    // was cleared), and 4 takes 2's: 6 faults.
    const run = replacePages([7, 0, 1, 2, 0, 3, 0, 4], 3, 'clock');
    expect(run.faults).toBe(6);
    expect(run.rows[5].out).toBe(1);
  });

  it('translates through a page table and an LRU TLB', () => {
    const table = new Map<number, number | null>([
      [0, 5],
      [1, null],
      [2, 3],
    ]);
    const t = translate(4096, table, 2, [100, 8300, 200, 5000]);
    expect(t[0]).toMatchObject({ page: 0, offset: 100, tlbHit: false, physical: 5 * 4096 + 100 });
    expect(t[1]).toMatchObject({ page: 2, physical: 3 * 4096 + 108 });
    expect(t[2].tlbHit).toBe(true);
    expect(t[3].physical).toBeNull();
  });

  it('rejects impossible shapes and traces', () => {
    expect(key(() => cacheShape(1000, 64, 4, 32))).toBe('cacheWays');
    expect(key(() => cacheShape(96 * 64, 64, 1, 32))).toBe('powerOfTwo');
    expect(key(() => cacheShape(0, 64, 1, 32))).toBe('cacheSizes');
    expect(key(() => parseAccesses('X 12'))).toBe('accessLine');
    expect(key(() => parseAccesses(''))).toBe('noAccesses');
    expect(key(() => replacePages([1], 0, 'lru'))).toBe('frames');
    expect(key(() => amat([{ hit: 1, missRate: 2 }], 100))).toBe('levelValues');
  });
});

describe('processors', () => {
  const procs = parseProcs('P1 0 24\nP2 0 3\nP3 0 3');
  const avg = (algo: Parameters<typeof schedule>[1]) => {
    const t = schedule(procs, algo, 4).times;
    return t.reduce((a, x) => a + x.waiting, 0) / t.length;
  };

  it('averages waiting 17 under FCFS, 3 under SJF, and 17/3 under round robin with quantum 4', () => {
    expect(avg('fcfs')).toBe(17);
    expect(avg('sjf')).toBe(3);
    expect(avg('rr')).toBeCloseTo(5.667, 3);
  });

  it('preempts under SRTF: the classic 4-process example averages 6.5', () => {
    const p = parseProcs('P1 0 8\nP2 1 4\nP3 2 9\nP4 3 5');
    const t = schedule(p, 'srtf').times;
    expect(t.reduce((a, x) => a + x.waiting, 0) / 4).toBe(6.5);
  });

  it('runs lower numbers first under priority scheduling', () => {
    const p = parseProcs('P1 0 10 3\nP2 0 1 1\nP3 0 2 4\nP4 0 1 5\nP5 0 5 2');
    const t = schedule(p, 'priority').times;
    // Order P2, P5, P1, P3, P4: waits 6, 0, 16, 18, 1 → 8.2.
    expect(t.reduce((a, x) => a + x.waiting, 0) / 5).toBeCloseTo(8.2, 12);
  });

  it('gives the rate-monotonic bound 3(2^(1/3) − 1) = 0.7798 and response times', () => {
    expect(rmBound(3)).toBeCloseTo(0.7798, 4);
    // C, T: (1, 4), (2, 6), (3, 13): R3 = 3 + ⌈R/4⌉·1 + ⌈R/6⌉·2 converges at 10.
    const r = responseTimes(parseTasks('1 4\n2 6\n3 13')).r;
    expect(r).toEqual([1, 3, 10]);
    expect(responseTimes(parseTasks('3 4\n3 6')).r[1]).toBeNull();
  });

  it('stalls a load-use pair 1 cycle with forwarding and 2 without', () => {
    const prog = parseProgram('lw x1, 0(x2)\nadd x3, x1, x4');
    expect(pipeline(prog, true).stalls).toBe(1);
    expect(pipeline(prog, false).stalls).toBe(2);
    const alu = parseProgram('add x1, x2, x3\nsub x4, x1, x5');
    expect(pipeline(alu, true).stalls).toBe(0);
    expect(pipeline(alu, true).cycles).toBe(6);
  });

  it('counts predictor misses on a loop branch: 3 for 1-bit and 2 for 2-bit from strongly taken', () => {
    const loop = [true, true, true, false, true, true, true, false];
    expect(predict(loop, 1, 1).misses).toBe(3);
    expect(predict(loop, 2, 3).misses).toBe(2);
  });

  it('gives Amdahl 1/(0.1 + 0.09) = 5.263, Gustafson 9.1, and the CPI of a mix', () => {
    expect(amdahl(0.9, 10)).toBeCloseTo(5.2632, 4);
    expect(gustafson(0.9, 10)).toBeCloseTo(9.1, 12);
    expect(
      cpiOf([
        [50, 1],
        [30, 2],
        [20, 3],
      ]),
    ).toBeCloseTo(1.7, 12);
  });

  it('rejects bad process, task, and program lines', () => {
    expect(key(() => parseProcs('P1 0'))).toBe('procLine');
    expect(key(() => parseProcs('P1 0 0'))).toBe('procLine');
    expect(key(() => parseTasks('1 -4'))).toBe('taskLine');
    expect(key(() => parseProgram(''))).toBe('noProgram');
    expect(key(() => schedule(procs, 'rr', 0))).toBe('quantum');
    expect(key(() => cpiOf([[0, 1]]))).toBe('mix');
  });
});

describe('deadlock', () => {
  // The textbook 5-process, 3-resource state: safe, with sequence P1, P3, P4, P0, P2 by the first-fit scan.
  const b = {
    alloc: [
      [0, 1, 0],
      [2, 0, 0],
      [3, 0, 2],
      [2, 1, 1],
      [0, 0, 2],
    ],
    max: [
      [7, 5, 3],
      [3, 2, 2],
      [9, 0, 2],
      [2, 2, 2],
      [4, 3, 3],
    ],
    available: [3, 3, 2],
  };

  it('finds a safe sequence', () => {
    const s = safety(b);
    expect(s.safe).toBe(true);
    expect(s.order).toEqual([1, 3, 4, 0, 2]);
  });

  it('grants P1 (1, 0, 2), and refuses P4 (3, 3, 0) as unsafe, P0 (0, 4, 0) as waiting, and P1 (2, 0, 0) as over need', () => {
    expect(request(b, 1, [1, 0, 2]).granted).toBe(true);
    expect(request(b, 4, [3, 3, 0]).reason).toBe('unsafe');
    expect(request(b, 0, [0, 4, 0]).reason).toBe('mustWait');
    expect(request(b, 1, [2, 0, 0]).reason).toBe('overNeed');
  });

  it('finds the cycle in a deadlocked resource graph', () => {
    expect(ragCycle('P1 -> R1\nR1 -> P2\nP2 -> R2\nR2 -> P1').cycle).toEqual(['P1', 'R1', 'P2', 'R2', 'P1']);
    expect(ragCycle('P1 -> R1\nR1 -> P2').cycle).toBeNull();
  });

  it('rejects allocation over the maximum', () => {
    expect(key(() => safety({ alloc: [[2]], max: [[1]], available: [0] }))).toBe('allocOverMax');
  });
});

describe('networks', () => {
  it('gives 192.168.10.0/26 hosts .1 to .62 and broadcast .63', () => {
    const c = parseCidr('192.168.10.0/26');
    const s = subnet(c.ip, c.prefix);
    expect([s.hosts, ipText(s.first), ipText(s.last), ipText(s.broadcast), ipText(s.mask)]).toEqual([
      62,
      '192.168.10.1',
      '192.168.10.62',
      '192.168.10.63',
      '255.255.255.192',
    ]);
  });

  it('packs a VLSM plan largest first', () => {
    const c = parseCidr('10.0.0.0/24');
    const plan = vlsm(c, [
      { name: 'A', hosts: 50 },
      { name: 'B', hosts: 100 },
      { name: 'C', hosts: 2 },
    ]);
    expect(plan.subnets.map((x) => `${x.name} ${ipText(x.network)}/${x.prefix}`)).toEqual([
      'B 10.0.0.0/25',
      'A 10.0.0.128/26',
      'C 10.0.0.192/30',
    ]);
    expect(key(() => vlsm(parseCidr('10.0.0.0/28'), [{ name: 'A', hosts: 100 }]))).toBe('vlsmFull');
  });

  it('shortens and masks IPv6 addresses', () => {
    const g = parseIpv6('2001:0db8:0000:0000:0000:ff00:0042:8329');
    expect(ipv6Short(g)).toBe('2001:db8::ff00:42:8329');
    expect(ipv6Short(ipv6Network(g, 32))).toBe('2001:db8::');
    expect(key(() => parseIpv6('1::2::3'))).toBe('ipv6');
  });

  it('adds transmission and propagation delays and the bandwidth-delay product', () => {
    // 12000 bits at 10 Mbit/s = 1.2 ms; 2000 km at 2e8 m/s = 10 ms; BDP 10e6 × 0.01 = 100000 bits.
    const d = delays({ bits: 12000, rate: 10e6, distance: 2e6, speed: 2e8, queue: 0, processing: 0 });
    expect(d.transmission).toBeCloseTo(0.0012, 12);
    expect(d.propagation).toBeCloseTo(0.01, 12);
    expect(d.bdp).toBeCloseTo(1e5, 6);
  });

  it('gives the Mathis throughput (MSS/RTT)·√1.5/√p', () => {
    // 1460 B = 11680 bits, RTT 0.1 s, p 0.01: 116800 × 1.22474 / 0.1 = 1.4305e6 bit/s.
    expect(mathis(11680, 0.1, 0.01)).toBeCloseTo(1430500, -2);
  });

  it('resends the whole window under go-back-N and only the lost frame under selective repeat', () => {
    const lost = new Set([2]);
    expect(arqRounds('gbn', 6, 4, lost).transmissions).toBe(8);
    expect(arqRounds('sr', 6, 4, lost).transmissions).toBe(7);
    expect(arqRounds('stopwait', 3, 1, lost).transmissions).toBe(4);
  });

  it('builds the same routing tables by link state and by distance vector', () => {
    const edges = 'u v 2\nu w 5\nv w 3\nv x 2\nw x 1';
    const ls = linkState(edges);
    const u = ls.tables[ls.nodes.indexOf('u')];
    expect(u.find((r) => r.dst === 'x')).toMatchObject({ cost: 4, next: 'v' });
    expect(u.find((r) => r.dst === 'w')!.cost).toBe(5);
    const dv = distanceVector(edges);
    expect(dv.dv.get('u')!.get('w')!.cost).toBe(5);
    expect(dv.dv.get('u')!.get('x')!.cost).toBe(4);
  });

  it('reads quantities with units and refuses a unit of the wrong kind', () => {
    expect(quantity('10 Mbit/s', 'rate', 'r')).toBe(1e7);
    expect(quantity('1500 B', 'size', 's')).toBe(12000);
    expect(quantity('20 ms', 'time', 't')).toBeCloseTo(0.02, 12);
    expect(quantity('2 KiB', 'size', 's')).toBe(16384);
    expect(quantity('5', 'time', 't', 1e-3)).toBeCloseTo(0.005, 12);
    expect(key(() => quantity('5 ms', 'rate', 'r'))).toBe('unitKind.rate');
    expect(key(() => quantity('5 furlongs', 'distance', 'd'))).toBe('unknownUnit');
    expect(key(() => quantity('', 'time', 't'))).toBe('quantity');
  });
});

describe('logical clocks', () => {
  it('stamps Lamport and vector clocks and finds happened-before', () => {
    const { events } = runClocks('P1: a, send m, c\nP2: d, recv m, e');
    expect(events[0].map((e) => e.lamport)).toEqual([1, 2, 3]);
    expect(events[1].map((e) => e.lamport)).toEqual([1, 3, 4]);
    expect(events[1][1].vector).toEqual([2, 2]);
    expect(relation(events[0][0], events[1][2])).toBe('before');
    expect(relation(events[0][2], events[1][2])).toBe('concurrent');
  });

  it('refuses a receive with no send', () => {
    expect(key(() => runClocks('P1: recv z'))).toBe('neverSent');
  });
});

describe('relational design', () => {
  const s = parseSchema('R(A, B, C, D)', 'A -> B\nB -> C');
  const n = s.attrs.length;
  const t = (m: number) => setText(s.attrs, m);

  it('gives A+ = ABC, key AD, and BCNF parts BC, AB, AD', () => {
    expect(t(closure(attrSet(s.attrs, 'A'), s.fds))).toBe('ABC');
    expect(candidateKeys(n, s.fds).map(t)).toEqual(['AD']);
    expect(bcnf(s.attrs, s.fds).parts.map(t)).toEqual(['BC', 'AB', 'AD']);
    expect(normalForm(n, s.fds).form).toBe('1nf');
  });

  it('checks the BCNF parts are lossless and keep both dependencies', () => {
    const parts = bcnf(s.attrs, s.fds).parts;
    expect(lossless(n, s.fds, parts)).toBe(true);
    expect(lostDependencies(s.fds, parts)).toEqual([]);
    // Splitting into ACD and BC shares only C, which determines nothing: lossy.
    const bad = [attrSet(s.attrs, 'ACD'), attrSet(s.attrs, 'BC')];
    expect(lossless(n, s.fds, bad)).toBe(false);
  });

  it('shows BCNF losing a dependency where 3NF keeps it', () => {
    // R(S, T, J): SJ → T, T → J. Keys SJ and ST; in 3NF but not BCNF; BCNF loses SJ → T.
    const r = parseSchema('S T J', 'S J -> T\nT -> J');
    expect(candidateKeys(3, r.fds).map((m) => setText(r.attrs, m))).toEqual(['ST', 'SJ']);
    expect(normalForm(3, r.fds).form).toBe('3nf');
    const parts = bcnf(r.attrs, r.fds).parts;
    expect(lostDependencies(r.fds, parts).length).toBe(1);
    expect(lostDependencies(r.fds, synthesize3nf(3, r.fds).parts)).toEqual([]);
  });

  it('finds a minimal cover', () => {
    // A → BC, B → C, AB → C: cover A → B, B → C.
    const r = parseSchema('A B C', 'A -> B C\nB -> C\nA B -> C');
    expect(minimalCover(r.fds, r.attrs).cover.map((f) => `${t(f.lhs)}>${t(f.rhs)}`)).toEqual(['A>B', 'B>C']);
  });

  it('rejects unknown attributes and bad lines', () => {
    expect(key(() => parseSchema('A B', 'A -> Z'))).toBe('unknownAttr');
    expect(key(() => parseSchema('A B', 'A B'))).toBe('fdLine');
    expect(key(() => parseSchema('', ''))).toBe('noAttrs');
  });
});

describe('relational algebra', () => {
  const db = parseTables('Emp(name, dept, pay)\nAnn, CS, 50\nBob, EE, 60\nCy, CS, 70\nDept(dept, floor)\nCS, 3\nEE, 1');

  it('selects, projects, and joins', () => {
    const r = evaluate('project[name, floor](select[pay > 55](Emp join Dept))', db).result;
    expect(r.attrs).toEqual(['name', 'floor']);
    expect(r.rows).toEqual([
      ['Bob', 1],
      ['Cy', 3],
    ]);
  });

  it('drops duplicates on projection and takes set differences', () => {
    expect(evaluate('project[dept](Emp)', db).result.rows).toEqual([['CS'], ['EE']]);
    expect(evaluate('project[dept](Emp) minus project[dept](select[floor = 1](Dept))', db).result.rows).toEqual([
      ['CS'],
    ]);
  });

  it('names a missing table or attribute', () => {
    expect(key(() => evaluate('Nope', db))).toBe('noTable');
    expect(key(() => evaluate('project[age](Emp)', db))).toBe('noAttribute');
    expect(key(() => evaluate('Emp union Dept', db))).toBe('notCompatible');
    expect(key(() => parseTables('Ann, CS'))).toBe('rowBeforeHeader');
  });
});

describe('digests', () => {
  const abc = bytesOf('abc', 'text');

  it('matches the published vectors for abc', () => {
    expect(sha256(abc)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(md5(abc)).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(sha1(abc)).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(crc32(bytesOf('123456789', 'text'))).toBe('cbf43926');
  });

  it('matches Node for the empty string, 2-block, and non-ASCII inputs', () => {
    for (const text of ['', 'a'.repeat(55), 'a'.repeat(56), 'b'.repeat(200), 'naïve café ✓']) {
      const bytes = bytesOf(text, 'text');
      for (const algo of ['md5', 'sha1', 'sha256'] as const) {
        const ours = { md5, sha1, sha256 }[algo](bytes);
        expect(ours, `${algo} of ${text.length} chars`).toBe(createHash(algo).update(text, 'utf8').digest('hex'));
      }
    }
  });

  it('reads hex bytes and rejects odd hex', () => {
    expect(md5(bytesOf('61 62 63', 'hex'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(key(() => bytesOf('abc', 'hex'))).toBe('hexBytes');
  });
});
