// The numbers, counting, and groups tool's engines against the planning pass's validation cases (hand calculations
// and published textbook examples), with brute-force cross-checks and edge cases.
import { describe, expect, it } from 'vitest';
import { fracText } from '../core/frac';
import { KitError } from '../core/util';
import {
  bell,
  catalan,
  choose,
  closedText,
  derangements,
  master,
  multinomial,
  partitions,
  permutations,
  recurrence,
  stirling1,
  stirling2,
} from './counting';
import { affine, caesar, diffieHellman, elGamal, hill, lfsr, rsa, substitution, vigenere } from './crypto';
import { fieldInverse, fieldMul, makeField, parsePoly, polyText, powersOfX, ringZn } from './field';
import {
  center,
  classSize,
  cycleText,
  compose,
  elementOrder,
  isNormal,
  lattice,
  leftCosets,
  makeGroup,
  parseCayley,
  parseCycles,
  permOrder,
  permSign,
  subgroups,
} from './groups';
import {
  big,
  carmichael,
  continuedFraction,
  crt,
  diophantine,
  discreteLog,
  extendedEuclid,
  factor,
  isPrime,
  jacobi,
  modInverse,
  modPow,
  orderMod,
  parseBase,
  phi,
  primitiveRoot,
  toBase,
} from './numbers';

const errorKey = (run: () => unknown): string => {
  try {
    run();
  } catch (e) {
    if (e instanceof KitError) return e.key;
    throw e;
  }
  return 'none';
};

describe('number theory', () => {
  it('runs extended Euclid on 240 and 46: gcd 2 = 240(-9) + 46(47)', () => {
    const r = extendedEuclid(240n, 46n);
    expect([r.g, r.x, r.y]).toEqual([2n, -9n, 47n]);
    expect(240n * r.x + 46n * r.y).toBe(r.g);
  });

  it('solves x = 2 mod 3, 3 mod 5, 2 mod 7 as 23, and joins moduli that share factors', () => {
    expect(crt([2n, 3n, 2n], [3n, 5n, 7n]).x).toBe(23n);
    expect(crt([1n, 3n], [4n, 6n])).toMatchObject({ x: 9n, m: 12n });
    expect(errorKey(() => crt([1n, 2n], [4n, 6n]))).toBe('crtNone');
  });

  it('gives phi(36) = 12, 8051 = 83 x 97, and 561 composite (a Carmichael number)', () => {
    expect(phi(36n)).toBe(12n);
    expect(factor(8051n)).toEqual([
      { p: 83n, k: 1 },
      { p: 97n, k: 1 },
    ]);
    expect(isPrime(561n)).toBe(false);
    expect(factor(561n).map((f) => f.p)).toEqual([3n, 11n, 17n]);
    // A Carmichael number: lambda(561) = 80 divides 560.
    expect(560n % carmichael(561n)).toBe(0n);
  });

  it('agrees with trial division on primality below 5000', () => {
    const slow = (n: number) =>
      n > 1 && Array.from({ length: Math.floor(Math.sqrt(n)) - 1 }, (_, i) => i + 2).every((d) => n % d);
    for (let n = 0; n < 5000; n += 1) expect(isPrime(BigInt(n))).toBe(Boolean(slow(n)));
  });

  it('factors a product of 2 large primes by Pollard rho', () => {
    const p = 1000000007n;
    const q = 998244353n;
    expect(factor(p * q)).toEqual([
      { p: q, k: 1 },
      { p, k: 1 },
    ]);
    expect(isPrime(2n ** 61n - 1n)).toBe(true);
  });

  it('powers by square and multiply, and inverts', () => {
    expect(modPow(4n, 13n, 497n).value).toBe(445n);
    expect(modInverse(3n, 11n)).toBe(4n);
    expect(errorKey(() => modInverse(6n, 9n))).toBe('noInverse');
  });

  it('finds primitive roots, orders, and discrete logarithms', () => {
    expect(primitiveRoot(7n)).toBe(3n);
    expect(primitiveRoot(8n)).toBeNull();
    expect(orderMod(2n, 7n)).toBe(3n);
    const { x } = discreteLog(3n, 13n, 17n);
    expect(x).toBe(4n);
    expect(discreteLog(2n, 3n, 7n).x).toBeNull();
  });

  it('gives Jacobi symbols, continued fractions, and Diophantine solutions', () => {
    expect(jacobi(1001n, 9907n)).toBe(-1);
    expect(jacobi(2n, 7n)).toBe(1);
    const cf = continuedFraction(415n, 93n);
    expect(cf.terms).toEqual([4n, 2n, 6n, 7n]);
    expect(cf.convergents[cf.convergents.length - 1]).toEqual([415n, 93n]);
    const d = diophantine(240n, 46n, 4n)!;
    expect(240n * d.x + 46n * d.y).toBe(4n);
    expect(diophantine(4n, 6n, 3n)).toBeNull();
  });

  it('converts bases and words bad input', () => {
    expect(toBase(255n, 16)).toBe('ff');
    expect(parseBase('11111111', 2)).toBe(255n);
    expect(errorKey(() => parseBase('12', 2))).toBe('digits');
    expect(errorKey(() => big('1.5'))).toBe('whole');
    expect(errorKey(() => extendedEuclid(0n, 0n))).toBe('bothZero');
    expect(errorKey(() => phi(0n))).toBe('positive');
  });
});

describe('cryptography', () => {
  it('enciphers ATTACKATDAWN with key LEMON as LXFOPVEFRNHR', () => {
    expect(vigenere('ATTACKATDAWN', 'LEMON')).toBe('LXFOPVEFRNHR');
    expect(vigenere('LXFOPVEFRNHR', 'LEMON', true)).toBe('ATTACKATDAWN');
  });

  it('runs RSA with p 61, q 53, e 17', () => {
    const r = rsa(61n, 53n, 17n, 65n);
    expect([r.n, r.phi, r.d, r.c, r.back]).toEqual([3233n, 3120n, 2753n, 2790n, 65n]);
    expect(r.verified).toBe(true);
    expect(errorKey(() => rsa(61n, 53n, 3n, 65n))).toBe('rsaE');
    expect(errorKey(() => rsa(60n, 53n, 17n, 65n))).toBe('rsaPrimes');
  });

  it('round-trips the classical ciphers', () => {
    expect(caesar('Hello, World', 3)).toBe('Khoor, Zruog');
    expect(affine(affine('AFFINE', 5, 8), 5, 8, true)).toBe('AFFINE');
    expect(affine('AFFINE', 5, 8)).toBe('IHHWVC');
    const key = 'QWERTYUIOPASDFGHJKLZXCVBNM';
    expect(substitution(substitution('Secret', key), key, true)).toBe('Secret');
    // The textbook Hill example: key (3 3; 2 5) sends HELP to HIAT.
    expect(
      hill('HELP', [
        [3, 3],
        [2, 5],
      ]),
    ).toBe('HIAT');
    expect(
      hill(
        'HIAT',
        [
          [3, 3],
          [2, 5],
        ],
        true,
      ),
    ).toBe('HELP');
    expect(
      errorKey(() =>
        hill('AB', [
          [2, 4],
          [6, 8],
        ]),
      ),
    ).toBe('hillKey');
    expect(errorKey(() => affine('A', 2, 1))).toBe('affineKey');
  });

  it('agrees on a Diffie-Hellman key and decrypts ElGamal', () => {
    const d = diffieHellman(23n, 5n, 6n, 15n);
    expect([d.A, d.B, d.key]).toEqual([8n, 19n, 2n]);
    expect(elGamal(23n, 5n, 6n, 3n, 10n).back).toBe(10n);
  });

  it('runs a 4-bit LFSR with taps 1 and 4 through all 15 nonzero states', () => {
    expect(lfsr('1000', [1, 4], 15).period).toBe(15);
    expect(errorKey(() => lfsr('10a', [1], 4))).toBe('lfsrSeed');
  });
});

describe('counting', () => {
  it('gives C(10, 3) 120, S(5, 2) 15, Bell(5) 52, Catalan(5) 42, p(10) 42, D(5) 44', () => {
    expect(choose(10, 3)).toBe(120n);
    expect(stirling2(5, 2)).toBe(15n);
    expect(bell(5)).toBe(52n);
    expect(catalan(5)).toBe(42n);
    expect(partitions(10)).toBe(42n);
    expect(derangements(5)).toBe(44n);
  });

  it('matches small cases counted by hand', () => {
    expect(permutations(5, 2)).toBe(20n);
    expect(multinomial([2, 1, 1])).toBe(12n);
    expect(stirling1(4, 2)).toBe(11n);
    // The sum of c(n, k) over k is n!.
    expect([1, 2, 3, 4, 5].reduce((s, k) => s + stirling1(5, k), 0n)).toBe(120n);
    expect(partitions(100)).toBe(190569292n);
    expect(choose(5, 7)).toBe(0n);
    expect(errorKey(() => choose(-1, 2))).toBe('countWhole');
  });

  it('solves a_n = a_{n-1} + 2 a_{n-2} from 0, 1: a10 = 341 = (2^10 - (-1)^10) / 3', () => {
    const r = recurrence([1, 2], [0, 1], 11);
    expect(r.terms[10]).toBe(341n);
    expect((2n ** 10n - 1n) / 3n).toBe(341n);
    expect(r.closed!.map((t) => [fracText(t.c), fracText(t.r)])).toEqual([
      ['1/3', '2'],
      ['-1/3', '-1'],
    ]);
    expect(closedText(r.closed!)).toBe('1/3 (2)^n − 1/3 (-1)^n');
  });

  it('handles a repeated root and an irrational one', () => {
    // a_n = 4a_{n-1} - 4a_{n-2}, a0 1, a1 4: a_n = (1 + n) 2^n.
    const r = recurrence([4, -4], [1, 4], 6);
    expect(r.terms[5]).toBe(6n * 32n);
    expect(r.closed!.map((t) => [fracText(t.c), t.j])).toEqual([
      ['1', 0],
      ['1', 1],
    ]);
    const fib = recurrence([1, 1], [0, 1], 20);
    expect(fib.terms[19]).toBe(4181n);
    expect(fib.closed).toBeNull();
  });

  it('names the master theorem case', () => {
    expect(master(2, 2, 1, 0).case).toBe(2); // merge sort
    expect(master(8, 2, 2, 0).case).toBe(1);
    expect(master(1, 2, 1, 0).case).toBe(3);
    expect(errorKey(() => master(0.5, 2, 1, 0))).toBe('masterAB');
  });
});

describe('groups', () => {
  it('gives (1 2 3)(4 5) order 6 and odd sign', () => {
    const p = parseCycles('(1 2 3)(4 5)');
    expect(permOrder(p)).toBe(6);
    expect(permSign(p)).toBe(-1);
    expect(classSize(p)).toBe(20n);
  });

  it('composes right to left', () => {
    // (1 2)(2 3): 1 stays under (2 3), then goes to 2; 2 goes to 3; 3 goes to 2, then to 1.
    expect(cycleText(compose(parseCycles('(1 2)'), parseCycles('(2 3)')))).toBe('(1 2 3)');
    expect(errorKey(() => parseCycles('(1 1)'))).toBe('cycleRepeat');
  });

  it('gives 8 order 3 in Z_12 and the center {e, r^2} of D_4', () => {
    const z = makeGroup('cyclic', 12);
    expect(elementOrder(z, z.names.indexOf('8'))).toBe(3);
    const d = makeGroup('dihedral', 4);
    expect(center(d).map((i) => d.names[i])).toEqual(['e', 'r^2']);
  });

  it('counts subgroups of S_3, D_4, Q_8, and S_4 as published', () => {
    const s3 = makeGroup('symmetric', 3);
    expect(subgroups(s3).length).toBe(6);
    expect(subgroups(makeGroup('dihedral', 4)).length).toBe(10);
    const q8 = makeGroup('quaternion', 1);
    const subs = subgroups(q8);
    expect(subs.length).toBe(6);
    expect(subs.every((h) => isNormal(q8, h))).toBe(true);
    expect(subgroups(makeGroup('symmetric', 4)).length).toBe(30);
    expect(lattice(subgroups(s3)).length).toBe(8);
  });

  it('finds normal subgroups and cosets', () => {
    const s3 = makeGroup('symmetric', 3);
    const subs = subgroups(s3);
    const a3 = subs.find((h) => h.length === 3)!;
    expect(isNormal(s3, a3)).toBe(true);
    const t = subs.find((h) => h.length === 2)!;
    expect(isNormal(s3, t)).toBe(false);
    expect(leftCosets(s3, t).length).toBe(3);
    expect(makeGroup('alternating', 4).names.length).toBe(12);
    expect(makeGroup('units', 15).names).toEqual(['1', '2', '4', '7', '8', '11', '13', '14']);
  });

  it('checks a typed Cayley table against the axioms', () => {
    const g = parseCayley('e a b\ne a b\na b e\nb e a');
    expect(g.names.length).toBe(3);
    expect(errorKey(() => parseCayley('e a\ne a\na a'))).toBe('cayleyInverse');
    expect(errorKey(() => parseCayley('e a\ne q\na e'))).toBe('cayleyClosed');
  });
});

describe('rings and fields', () => {
  it('gives x * x^2 = x + 1 in GF(8) = GF(2)[x]/(x^3 + x + 1)', () => {
    const F = makeField(2, 'x^3 + x + 1');
    expect(F.field).toBe(true);
    expect(polyText(fieldMul(F, parsePoly('x', 2), parsePoly('x^2', 2)))).toBe('x + 1');
    expect(powersOfX(F).primitive).toBe(true);
    // Every nonzero element has an inverse.
    expect(polyText(fieldMul(F, parsePoly('x', 2), fieldInverse(F, parsePoly('x', 2))!))).toBe('1');
  });

  it('spots a reducible modulus', () => {
    expect(makeField(2, 'x^2 + 1').field).toBe(false);
    expect(makeField(3, 'x^2 + 1').field).toBe(true);
    expect(errorKey(() => makeField(4, 'x^2 + 1'))).toBe('notPrime');
  });

  it('lists units and zero divisors of Z_12', () => {
    const r = ringZn(12);
    expect(r.units).toEqual([1, 5, 7, 11]);
    expect(r.zeroDivisors).toEqual([2, 3, 4, 6, 8, 9, 10]);
    expect(r.nilpotent).toEqual([0, 6]);
    expect(r.idempotent).toEqual([0, 1, 4, 9]);
  });
});
