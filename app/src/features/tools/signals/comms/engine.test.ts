// Information, coding, and modulation. Each validation case from the plan comes first with its independent expected
// value (a hand calculation or a published check value); edge cases follow.
import { describe, expect, it } from 'vitest';
import { SignalError } from '../shared/errors';
import {
  CRC_PRESETS,
  bitsText,
  convEncode,
  convolutionalCode,
  crc,
  crcDivision,
  hammingDecode,
  hammingEncode,
  huffman,
  linearCode,
  lz78,
  readBits,
  shannonFano,
  viterbi,
  type Bit,
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
  berSteps,
  bitErrorRate,
  constellation,
  constellationPoints,
  eyeDiagram,
  qfunc,
  snrFromEbN0,
} from './modulation';

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const errorKey = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof SignalError ? error.key : 'other';
  }
  return 'none';
};

describe('information and capacity', () => {
  it('gives 1.5 bits for 0.5, 0.25, 0.25; 0.531004 for a BSC at 0.1; 4 Mbit/s for 1 MHz at SNR 15', () => {
    expect(entropy([0.5, 0.25, 0.25]).bits).toBeCloseTo(1.5, 12);
    expect(Math.abs(capacityBsc(0.1).bits - 0.531004)).toBeLessThan(1e-6);
    expect(Math.abs(capacityAwgn(1e6, 15).bitsPerSecond - 4e6)).toBeLessThan(1e-6);
  });

  it('agrees with the closed forms for the erasure and Z channels and for Blahut-Arimoto on a BSC', () => {
    expect(capacityBec(0.25).bits).toBeCloseTo(0.75, 12);
    // Z channel at p = 0.5: log₂(1 + 0.5 · 0.5¹) = log₂ 1.25.
    expect(capacityZ(0.5).bits).toBeCloseTo(Math.log2(1.25), 12);
    expect(
      capacityDmc([
        [0.9, 0.1],
        [0.1, 0.9],
      ]).bits,
    ).toBeCloseTo(capacityBsc(0.1).bits, 8);
    // A Z channel through Blahut-Arimoto matches its closed form.
    expect(
      capacityDmc([
        [1, 0],
        [0.5, 0.5],
      ]).bits,
    ).toBeCloseTo(Math.log2(1.25), 8);
  });

  it('finds no shared information in an independent table and the KL divergence by hand', () => {
    const joint = jointMeasures([
      [0.25, 0.25],
      [0.25, 0.25],
    ]);
    expect(joint.mutual).toBeCloseTo(0, 12);
    expect(joint.hxy).toBeCloseTo(2, 12);
    // 0.5·log₂(0.5/0.25) + 0.5·log₂(0.5/0.75) = 0.5 − 0.292481 = 0.207519.
    expect(divergence([0.5, 0.5], [0.25, 0.75]).bits).toBeCloseTo(0.2075187, 6);
    expect(divergence([0.5, 0.5], [1, 0]).bits).toBe(Infinity);
  });

  it('refuses probabilities that are negative or do not add to 1', () => {
    expect(errorKey(() => entropy([0.5, 0.6]))).toBe('probabilitySum');
    expect(errorKey(() => entropy([1.5, -0.5]))).toBe('probability');
    expect(errorKey(() => entropy([]))).toBe('empty');
    expect(errorKey(() => capacityAwgn(0, 15))).toBe('bandwidth');
    expect(errorKey(() => capacityAwgn(1e6, -1))).toBe('snr');
    expect(errorKey(() => jointMeasures([[0.5, 0.5], [0]]))).toBe('ragged');
  });
});

describe('source codes', () => {
  it('gives the Huffman code of 0.4, 0.2, 0.2, 0.1, 0.1 an average of 2.2 bits (entropy 2.12193)', () => {
    const code = huffman([0.4, 0.2, 0.2, 0.1, 0.1]);
    expect(Math.abs(code.average - 2.2)).toBeLessThan(1e-5);
    expect(Math.abs(code.entropy - 2.12193)).toBeLessThan(1e-5);
    // The code is prefix-free: no word starts another.
    for (const a of code.codes) for (const b of code.codes) if (a !== b) expect(b.startsWith(a)).toBe(false);
  });

  it('makes a Shannon-Fano code no shorter than the entropy, and one symbol a one-bit code', () => {
    const code = shannonFano([0.4, 0.2, 0.2, 0.1, 0.1]);
    expect(code.average).toBeGreaterThanOrEqual(code.entropy);
    expect(huffman([1]).codes).toEqual(['0']);
  });

  it('parses ABAABABAABAB into A, B, AA, BA, BAA, BAB', () => {
    expect(lz78('ABAABABAABAB').map((one) => one.phrase)).toEqual(['A', 'B', 'AA', 'BA', 'BAA', 'BAB']);
    expect(lz78('ABAABABAABAB').map((one) => one.prefix)).toEqual([0, 0, 1, 2, 4, 4]);
    expect(errorKey(() => lz78(''))).toBe('emptyText');
  });
});

describe('block codes and CRCs', () => {
  it('encodes 1011 as 0110011 and reads syndrome 101 for an error at position 5', () => {
    const word = hammingEncode(readBits('1011')).codeword;
    expect(bitsText(word)).toBe('0110011');
    const hit = [...word] as Bit[];
    hit[4] = (1 - hit[4]!) as Bit;
    const decoded = hammingDecode(hit);
    expect(bitsText(decoded.syndrome)).toBe('101');
    expect(decoded.position).toBe(5);
    expect(bitsText(decoded.data)).toBe('1011');
    expect(hammingDecode(word).position).toBe(0);
  });

  it('finds d_min 3 and eight coset leaders for the Hamming (7,4) generator', () => {
    const code = linearCode(
      [
        [1, 1, 1, 0, 0, 0, 0],
        [1, 0, 0, 1, 1, 0, 0],
        [0, 1, 0, 1, 0, 1, 0],
        [1, 1, 0, 1, 0, 0, 1],
      ].map((row) => row as Bit[]),
    );
    expect(code.dMin).toBe(3);
    expect(code.corrects).toBe(1);
    expect(code.leaders?.length).toBe(8);
    expect(code.leaders?.every((leader) => leader.filter(Boolean).length <= 1)).toBe(true);
    expect(
      errorKey(() =>
        linearCode([
          [1, 1, 0],
          [1, 1, 0],
        ] as Bit[][]),
      ),
    ).toBe('dependentRows');
  });

  it('gives the published check values of 123456789: CRC-8 0xF4, CRC-16/CCITT-False 0x29B1, CRC-32 0xCBF43926', () => {
    expect(crc(ascii('123456789'), CRC_PRESETS.crc8).value).toBe(0xf4);
    expect(crc(ascii('123456789'), CRC_PRESETS.crc16).value).toBe(0x29b1);
    expect(crc(ascii('123456789'), CRC_PRESETS.crc32).value).toBe(0xcbf43926);
  });

  it('divides 11010011101100 by 1011 to leave 100, as worked on paper', () => {
    const result = crcDivision(readBits('11010011101100'), readBits('1011'));
    expect(bitsText(result.remainder)).toBe('100');
    // The sent word divides with no remainder.
    expect(bitsText(crcDivision(result.transmitted, readBits('1011')).remainder)).toBe('000');
    expect(errorKey(() => crcDivision(readBits('101'), readBits('011')))).toBe('generator');
    expect(errorKey(() => readBits('10a1'))).toBe('notBits');
  });
});

describe('convolutional codes', () => {
  const code = convolutionalCode('7', '5');

  it('encodes 1011 with two flush zeros as 111000010111 and decodes it back to 101100', () => {
    const sent = convEncode(code, readBits('1011')).output;
    expect(bitsText(sent)).toBe('111000010111');
    expect(bitsText(viterbi(code, sent).decoded)).toBe('101100');
  });

  it('corrects any single flipped bit', () => {
    const sent = convEncode(code, readBits('1011')).output;
    for (let i = 0; i < sent.length; i += 1) {
      const hit = [...sent];
      hit[i] = (1 - hit[i]!) as Bit;
      const result = viterbi(code, hit);
      expect(bitsText(result.decoded)).toBe('101100');
      expect(result.metric).toBe(1);
    }
  });

  it('refuses constraint lengths outside 2 to 5 and an odd number of received bits', () => {
    expect(errorKey(() => convolutionalCode('177', '133'))).toBe('constraint');
    expect(errorKey(() => convolutionalCode('8', '5'))).toBe('octal');
    expect(errorKey(() => viterbi(code, readBits('111')))).toBe('pairs');
  });
});

describe('modulation', () => {
  it('gives BPSK a bit-error rate of 3.8721e-6 at Eb/N0 10 dB', () => {
    const ber = berSteps('bpsk', 2, 10).ber;
    expect(Math.abs(ber - 3.8721e-6) / 3.8721e-6).toBeLessThan(1e-3);
  });

  it('matches Q(x) at known points and the 16-QAM approximation by hand', () => {
    expect(qfunc(0)).toBeCloseTo(0.5, 12);
    // Q(1.959964) = 0.025 (the two-sided 95% point of the normal distribution).
    expect(qfunc(1.959964)).toBeCloseTo(0.025, 6);
    // 16-QAM at 10 dB: 0.75·Q(√8) with Q(2.828427) = 2.33887e-3.
    expect(bitErrorRate('qam', 16, 10)).toBeCloseTo(0.75 * 2.33887e-3, 6);
    // Noncoherent binary FSK at 10 dB: ½·e^(−5).
    expect(bitErrorRate('fskNoncoherent', 2, 10)).toBeCloseTo(0.5 * Math.exp(-5), 12);
  });

  it('converts Eb/N0 to SNR and Es/N0', () => {
    const result = snrFromEbN0(10, 2e6, 1e6, 2);
    expect(result.snrDb).toBeCloseTo(10 + 10 * Math.log10(2), 12);
    expect(result.esN0Db).toBeCloseTo(10 + 10 * Math.log10(2), 12);
  });

  it('scales every constellation to unit average energy and makes few errors at high Eb/N0', () => {
    for (const [scheme, order] of [
      ['qpsk', 4],
      ['psk', 8],
      ['qam', 16],
      ['qam', 64],
    ] as const) {
      const points = constellationPoints(scheme, order);
      expect(points.reduce((a, p) => a + p.i ** 2 + p.q ** 2, 0) / points.length).toBeCloseTo(1, 12);
    }
    expect(constellation('qpsk', 4, 30).symbolErrors).toBe(0);
    expect(constellation('qam', 16, 0).symbolErrors).toBeGreaterThan(0);
  });

  it('opens the raised-cosine eye fully at the sampling instant with no noise', () => {
    expect(eyeDiagram(0.5).opening).toBeCloseTo(1, 9);
    expect(eyeDiagram(0.35, 0.5).opening).toBeLessThan(1);
    expect(errorKey(() => eyeDiagram(1.5))).toBe('rolloff');
  });
});
