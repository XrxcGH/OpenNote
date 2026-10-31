// The on-screen keyboards: sets of characters grouped as their charts arrange them, each key typing its character
// into the compose field. Combining marks (accents, breathings, niqqud, harakat) attach to the letter before them.
// The IPA groups follow the layout of the International Phonetic Alphabet chart; the character list is Unicode's.

export interface Palette {
  id: string;
  groups: { id: string; chars: string }[];
}

const g = (id: string, chars: string) => ({ id, chars });

export const PALETTES: readonly Palette[] = [
  {
    id: 'ipa',
    groups: [
      g('plosive', 'p b t d ʈ ɖ c ɟ k ɡ q ɢ ʔ'),
      g('nasal', 'm ɱ n ɳ ɲ ŋ ɴ'),
      g('trill', 'ʙ r ʀ ⱱ ɾ ɽ'),
      g('fricative', 'ɸ β f v θ ð s z ʃ ʒ ʂ ʐ ç ʝ x ɣ χ ʁ ħ ʕ h ɦ ɬ ɮ'),
      g('approximant', 'ʋ ɹ ɻ j ɰ l ɭ ʎ ʟ w ʍ ɥ'),
      g('nonPulmonic', 'ʘ ǀ ǃ ǂ ǁ ɓ ɗ ʄ ɠ ʛ ʼ'),
      g('vowel', 'i y ɨ ʉ ɯ u ɪ ʏ ʊ e ø ɘ ɵ ɤ o ə ɛ œ ɜ ɞ ʌ ɔ æ ɐ a ɶ ɑ ɒ'),
      g('diacritic', '̥ ̊ ̬ ʰ ̹ ̜ ̟ ̠ ̈ ̽ ̩ ̯ ˞ ʷ ʲ ˠ ˤ ̃ ⁿ ˡ ̚'),
      g('suprasegmental', 'ˈ ˌ ː ˑ ̆ | ‖ . ‿ ˥ ˦ ˧ ˨ ˩ ↗ ↘'),
    ],
  },
  {
    id: 'greek',
    groups: [g('letters', 'α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ ς τ υ φ χ ψ ω'), g('marks', '̓ ̔ ́ ̀ ͂ ͅ ̈')],
  },
  { id: 'latin', groups: [g('macrons', 'ā ē ī ō ū ȳ Ā Ē Ī Ō Ū'), g('breves', 'ă ĕ ĭ ŏ ŭ Ă Ĕ Ĭ Ŏ Ŭ')] },
  { id: 'oldEnglish', groups: [g('letters', 'æ Æ þ Þ ð Ð ƿ Ƿ ȝ Ȝ ā ǣ ē ī ō ū ȳ ċ ġ ⁊')] },
  {
    id: 'cyrillic',
    groups: [
      g('russian', 'а б в г д е ё ж з и й к л м н о п р с т у ф х ц ч ш щ ъ ы ь э ю я'),
      g('others', 'і ї є ґ ў ђ ј љ њ ћ џ ѓ ќ ѕ ә ғ қ ң ө ұ ү һ'),
    ],
  },
  {
    id: 'arabic',
    groups: [
      g('letters', 'ا ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن ه و ي ء ة ى'),
      g('persian', 'پ چ ژ گ ک ی'),
      g('harakat', 'َ ُ ِ ْ ّ ً ٌ ٍ ٰ'),
    ],
  },
  {
    id: 'hebrew',
    groups: [
      g('letters', 'א ב ג ד ה ו ז ח ט י כ ך ל מ ם נ ן ס ע פ ף צ ץ ק ר ש ת'),
      g('niqqud', 'ְ ֱ ֲ ֳ ִ ֵ ֶ ַ ָ ֹ ֻ ּ ׁ ׂ'),
    ],
  },
  {
    id: 'devanagari',
    groups: [
      g('vowels', 'अ आ इ ई उ ऊ ऋ ए ऐ ओ औ'),
      g('consonants', 'क ख ग घ ङ च छ ज झ ञ ट ठ ड ढ ण त थ द ध न प फ ब भ म य र ल व श ष स ह'),
      g('signs', 'ा ि ी ु ू ृ े ै ो ौ ं ः ँ ् ।'),
    ],
  },
  {
    id: 'armenian',
    groups: [g('letters', 'ա բ գ դ ե զ է ը թ ժ ի լ խ ծ կ հ ձ ղ ճ մ յ ն շ ո չ պ ջ ռ ս վ տ ր ց ւ փ ք օ ֆ և')],
  },
  { id: 'georgian', groups: [g('letters', 'ა ბ გ დ ე ვ ზ თ ი კ ლ მ ნ ო პ ჟ რ ს ტ უ ფ ქ ღ ყ შ ჩ ც ძ წ ჭ ხ ჯ ჰ')] },
  { id: 'runic', groups: [g('futhark', 'ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚷ ᚹ ᚺ ᚾ ᛁ ᛃ ᛇ ᛈ ᛉ ᛊ ᛏ ᛒ ᛖ ᛗ ᛚ ᛜ ᛞ ᛟ ᛫')] },
  {
    id: 'ancient',
    groups: [
      g('linearB', '𐀀 𐀁 𐀂 𐀃 𐀄 𐀅 𐀆 𐀇 𐀈 𐀉 𐀊 𐀋 𐀍 𐀏 𐀐 𐀑 𐀒 𐀓 𐀔'),
      g('cuneiform', '𒀀 𒀭 𒁀 𒂗 𒃲 𒄿 𒅆 𒆠 𒇻 𒈠 𒉌 𒊏 𒋗 𒌋'),
      g('hieroglyphs', '𓀀 𓁐 𓂀 𓃀 𓄿 𓅓 𓆑 𓇋 𓈖 𓉐 𓊪 𓋴 𓌳 𓍯 𓎛 𓏏'),
    ],
  },
  { id: 'jefferson', groups: [g('symbols', '[ ] = (.) (0.5) ↑ ↓ ° > < : - hh .hh ( ) (( )) _ ¿')] },
];

/** The keys of a group: each character, or a short sequence for Jefferson symbols such as (.). */
export const keysOf = (chars: string): string[] => chars.split(' ').filter(Boolean);

/** A key's code point, such as U+0283, for its accessible name. */
export const codePoints = (key: string): string =>
  [...key].map((c) => `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ');

/** True for a combining mark, which is shown on a dotted circle so it can be seen. */
export const isCombining = (key: string): boolean => {
  if ([...key].length !== 1) return false;
  const code = key.codePointAt(0) ?? 0;
  const ranges = [
    [0x300, 0x36f],
    [0x483, 0x489],
    [0x591, 0x5c7],
    [0x64b, 0x65f],
    [0x670, 0x670],
  ];
  return ranges.some(([lo, hi]) => code >= lo && code <= hi);
};
