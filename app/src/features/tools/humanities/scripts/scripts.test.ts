import { describe, expect, it } from 'vitest';
import { compose, composeJamo, decompose, romanizeKorean } from './hangul';
import { hepburn, toKana, toKatakana } from './kana';
import { codePoints, isCombining } from './palettes';
import { sandhi, toMarks } from './pinyin';
import { thaiTone } from './thai';
import { cyrillicFromAlaLc, romanize } from './translit';
import { vietnamese } from './vietnamese';

describe('pinyin', () => {
  it('mark zhong1 guo2, lv4, liu2, gui4, and xue2 sheng5', () => {
    expect(toMarks('zhong1 guo2')).toBe('zhōng guó');
    expect(toMarks('lv4')).toBe('lǜ');
    expect(toMarks('liu2')).toBe('liú');
    expect(toMarks('gui4')).toBe('guì');
    expect(toMarks('xue2 sheng5')).toBe('xué sheng');
    expect(toMarks('Lu:3 dou4')).toBe('Lǚ dòu');
    expect(() => toMarks(' ')).toThrow('empty');
  });

  it('apply third-tone, yi, and bu sandhi', () => {
    const tones = (text: string) => sandhi(text).syllables.map((s) => s.tone);
    expect(tones('ni3 hao3')).toEqual([2, 3]);
    expect(tones('yi1 ge4')).toEqual([2, 4]);
    expect(tones('yi1 tian1')).toEqual([4, 1]);
    expect(tones('bu4 shi4')).toEqual([2, 4]);
    expect(tones('bu4 hao3')).toEqual([4, 3]);
    expect(tones('di4 yi1')).toEqual([4, 1]);
  });
});

describe('Hangul', () => {
  it('compose h + a + n as U+D55C and take it apart as L 18, V 0, T 4', () => {
    expect(composeJamo('ㅎㅏㄴ')).toBe('한');
    expect(compose({ l: 18, v: 0, t: 4 }).codePointAt(0)).toBe(0xd55c);
    expect(decompose('한')).toEqual({ l: 18, v: 0, t: 4 });
    expect(composeJamo('ㅎㅏㄴㄱㅜㄱㅇㅓ')).toBe('한국어');
    expect(() => decompose('a')).toThrow('notHangul');
    expect(() => composeJamo('ㅏㅎ')).toThrow('jamoOrder');
  });

  it('romanize 한국어, 독립문, 신라, and 종로 in RR and MR', () => {
    expect(romanizeKorean('한국어', 'rr').text).toBe('hangugeo');
    expect(romanizeKorean('독립문', 'rr', true).text).toBe('Dongnimmun');
    expect(romanizeKorean('신라', 'rr', true).text).toBe('Silla');
    expect(romanizeKorean('종로', 'rr', true).text).toBe('Jongno');
    expect(romanizeKorean('한국어', 'mr').text).toBe('han’gugŏ'.replace('’', "'"));
    expect(romanizeKorean('독립문', 'mr', true).text).toBe('Tongnimmun');
    expect(romanizeKorean('신라', 'mr', true).text).toBe('Silla');
    expect(romanizeKorean('종로', 'mr', true).text).toBe('Chongno');
    expect(romanizeKorean('독립문', 'rr').rules).toEqual(['lToN', 'nasal']);
  });

  it('aspirate with h and palatalize before i', () => {
    expect(romanizeKorean('좋다', 'rr').text).toBe('jota');
    expect(romanizeKorean('굳이', 'rr').text).toBe('guji');
  });

  it('follow the official Revised Romanization examples for n-insertion, nouns, and nn', () => {
    const rr = (word: string, compound: boolean, noun = false) =>
      romanizeKorean(word, 'rr', true, { compound, noun }).text;
    expect(rr('학여울', true)).toBe('Hangnyeoul');
    expect(rr('알약', true)).toBe('Allyak');
    expect(rr('꽃잎', true)).toBe('Kkonnip');
    expect(rr('신문로', false)).toBe('Sinmunno');
    expect(rr('묵호', false, true)).toBe('Mukho');
    expect(rr('집현전', false, true)).toBe('Jiphyeonjeon');
    expect(rr('먹이', false)).toBe('Meogi');
  });

  it('type a double final from two consonant jamo', () => {
    expect(composeJamo('ㅂㅏㄹㄱㄷㅏ')).toBe('밝다');
    expect(composeJamo('ㅂㅏㄹㄱㅇㅡㅁ')).toBe('밝음');
    expect(composeJamo('ㅇㅏㄹㄱㅗ')).toBe('알고');
  });
});

describe('kana', () => {
  it('give shinbun, kippu, tōkyō, kin’en, and cha', () => {
    expect(hepburn('しんぶん')).toBe('shinbun');
    expect(hepburn('きっぷ')).toBe('kippu');
    expect(hepburn('とうきょう')).toBe('tōkyō');
    expect(hepburn('きんえん')).toBe("kin'en");
    expect(hepburn('ちゃ')).toBe('cha');
    expect(hepburn('マッチ')).toBe('matchi');
    expect(hepburn('コーヒー')).toBe('kōhī');
  });

  it('type romaji as kana', () => {
    expect(toKana('shinbun')).toBe('しんぶん');
    expect(toKana('kippu')).toBe('きっぷ');
    expect(toKana("kin'en")).toBe('きんえん');
    expect(toKana('kyouto')).toBe('きょうと');
    expect(toKatakana('こーひー')).toBe('コーヒー');
  });
});

describe('Thai tones', () => {
  it('read ไม่, ข้าว, มา, ขา, กา, and จะ as falling, falling, mid, rising, mid, and low', () => {
    expect(['ไม่', 'ข้าว', 'มา', 'ขา', 'กา', 'จะ'].map((s) => thaiTone(s).tone)).toEqual([
      'falling',
      'falling',
      'mid',
      'rising',
      'mid',
      'low',
    ]);
  });

  it('use a leading ห and dead syllables', () => {
    expect(thaiTone('หมา')).toMatchObject({ cls: 'high', led: 'ho', tone: 'rising' });
    expect(thaiTone('มาก')).toMatchObject({ live: false, long: true, tone: 'falling' });
    expect(thaiTone('นก')).toMatchObject({ live: false, tone: 'high' });
    expect(() => thaiTone('abc')).toThrow('notThai');
  });
});

describe('romanization tables', () => {
  it('give Chaĭkovskiĭ, Athēna, saṃskṛta, and Hayastan', () => {
    expect(romanize('Чайковский', 'ru-alalc').normalize('NFC')).toBe('Chaĭkovskiĭ'.normalize('NFC'));
    expect(romanize('Αθήνα', 'el-alalc').normalize('NFC')).toBe('Athēna'.normalize('NFC'));
    expect(romanize('संस्कृत', 'hi-alalc').normalize('NFC')).toBe('saṃskṛta'.normalize('NFC'));
    expect(romanize('Հայաստան', 'hy-alalc')).toBe('Hayastan');
  });

  it('use BGN/PCGN, Georgian, rough breathings, and go back to Cyrillic', () => {
    expect(romanize('Ельцин', 'ru-bgn')).toBe('Yel’tsin');
    expect(romanize('Чайковский', 'ru-bgn')).toBe('Chaykovskiy');
    expect(romanize('თბილისი', 'ka-alalc')).toBe('tʻbilisi');
    expect(romanize('ὁδός', 'el-alalc')).toBe('hodos');
    expect(romanize('ῥήτωρ', 'el-alalc')).toBe('rhētōr');
    expect(cyrillicFromAlaLc('Chaĭkovskiĭ')).toBe('Чайковский');
  });
});

describe('Vietnamese input', () => {
  it('convert Telex and VNI', () => {
    expect(vietnamese('tieengs vieetj', 'telex')).toBe('tiếng việt');
    expect(vietnamese('ddaau', 'telex')).toBe('đâu');
    expect(vietnamese('nguwowif', 'telex')).toBe('người');
    expect(vietnamese('tie6ng1 vie6t5', 'vni')).toBe('tiếng việt');
    expect(vietnamese('d9i', 'vni')).toBe('đi');
    expect(vietnamese('hoaf', 'telex')).toBe('hòa');
  });
});

describe('keyboards', () => {
  it('name keys by code point and spot combining marks', () => {
    expect(codePoints('ʃ')).toBe('U+0283');
    expect(isCombining('́')).toBe(true);
    expect(isCombining('a')).toBe(false);
  });
});
