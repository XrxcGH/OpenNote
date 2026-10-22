// Spelling variants for the dictionary. The bundled words are American. When the chosen dialect is not American
// (en-GB, en-AU, en-NZ, en-IE, en-IN, en-ZA, en-CA), words are shown in that dialect's spelling first, with the
// American one named as a variant, and a word typed the dialect's way still finds its American entry.

/** [American stem, dialect stem] pairs. Each takes the endings below. */
const STEMS: readonly (readonly [string, string])[] = [
  ['color', 'colour'],
  ['favor', 'favour'],
  ['honor', 'honour'],
  ['labor', 'labour'],
  ['neighbor', 'neighbour'],
  ['behavior', 'behaviour'],
  ['flavor', 'flavour'],
  ['humor', 'humour'],
  ['rumor', 'rumour'],
  ['vapor', 'vapour'],
  ['harbor', 'harbour'],
  ['savior', 'saviour'],
  ['endeavor', 'endeavour'],
  ['odor', 'odour'],
  ['rigor', 'rigour'],
  ['vigor', 'vigour'],
  ['valor', 'valour'],
  ['tumor', 'tumour'],
  ['splendor', 'splendour'],
  ['armor', 'armour'],
  ['parlor', 'parlour'],
  ['clamor', 'clamour'],
  ['candor', 'candour'],
  ['demeanor', 'demeanour'],
  ['glamor', 'glamour'],
  ['center', 'centre'],
  ['meter', 'metre'],
  ['theater', 'theatre'],
  ['fiber', 'fibre'],
  ['liter', 'litre'],
  ['caliber', 'calibre'],
  ['luster', 'lustre'],
  ['somber', 'sombre'],
  ['specter', 'spectre'],
  ['saber', 'sabre'],
  ['defense', 'defence'],
  ['offense', 'offence'],
  ['pretense', 'pretence'],
  ['gray', 'grey'],
  ['jewelry', 'jewellery'],
  ['aluminum', 'aluminium'],
  ['plow', 'plough'],
  ['skeptic', 'sceptic'],
  ['pajamas', 'pyjamas'],
  ['mold', 'mould'],
  ['smolder', 'smoulder'],
  ['sulfur', 'sulphur'],
  ['cozy', 'cosy'],
  ['aging', 'ageing'],
  ['catalog', 'catalogue'],
  ['dialog', 'dialogue'],
  ['analog', 'analogue'],
  ['esthetic', 'aesthetic'],
  ['pediatric', 'paediatric'],
  ['anemia', 'anaemia'],
  ['anesthetic', 'anaesthetic'],
  ['maneuver', 'manoeuvre'],
  ['traveler', 'traveller'],
  ['traveling', 'travelling'],
  ['traveled', 'travelled'],
  ['canceled', 'cancelled'],
  ['canceling', 'cancelling'],
  ['modeling', 'modelling'],
  ['modeled', 'modelled'],
  ['labeled', 'labelled'],
  ['labeling', 'labelling'],
  ['counselor', 'counsellor'],
  ['fueled', 'fuelled'],
  ['fueling', 'fuelling'],
  ['program', 'programme'],
];

const ENDINGS = ['', 's', 'ed', 'ing', 'ful', 'less', 'able', 'ably', 'er', 'ers', 'ite', 'ites', 'ly', 'y'];

const toDialect = new Map<string, string>();
const toAmerican = new Map<string, string>();
for (const [us, gb] of STEMS) {
  for (const end of ENDINGS) {
    // A stem that ends in e or y does not take every ending ("colory"); the map just never meets those words.
    toDialect.set(us + end, gb + end);
    toAmerican.set(gb + end, us + end);
  }
}

// Words that end in -ize but are spelled the same everywhere.
const SAME_IZE = /^(?:(?:re|over|under|down|up|out|cap)?siz(?:e|es|ed|ing)|seiz(?:e|es|ed|ing)|priz(?:e|es|ed|ing))$/;
const IZE = /^(.{3,}?)iz(e|es|ed|ing|er|ers|ation|ations)$/;
const ISE = /^(.{3,}?)is(e|es|ed|ing|er|ers|ation|ations)$/;
// -ise words that are -ise everywhere, which the reverse rule must leave alone.
const SAME_ISE = new RegExp(
  `^(?:${[
    'advertis',
    'advis',
    'compris',
    'devis',
    'disguis',
    'exercis',
    'premis',
    'promis',
    'revis',
    'supervis',
    'surpris',
    'televis',
    'wis',
    'rais',
    'prais',
    'ris',
    'aris',
    'otherwis',
    'likewis',
    'clockwis',
    'expertis',
    'franchis',
    'merchandis',
    'treatis',
    'paradis',
    'demis',
    'improvis',
    'apprais',
    'enterpris',
    'compromis',
    'despis',
    'excis',
    'incis',
    'concis',
    'precis',
    'nois',
    'pois',
    'cruis',
    'bruis',
  ].join('|')})`,
);
/^(?:advertis|advis|compris|devis|disguis|exercis|premis|promis|revis|supervis|surpris|televis|wis|rais|prais|rise|arise|otherwis|likewis|clockwis|promis|expertis|franchis|merchandis|treatis|paradis|demis|improvis|apprais|enterpris|compromis|despis|excis|incis|concis|precis|precise|noise|poise|cruise|bruise|raise|praise|raisin|wise|rise)/;

/** The dialect's spelling of an American word, or the word itself when it is spelled the same. */
export function toDialectSpelling(word: string): string {
  const lower = word.toLowerCase();
  const mapped = toDialect.get(lower);
  if (mapped !== undefined) return mapped;
  if (!SAME_IZE.test(lower)) {
    const match = IZE.exec(lower);
    if (match) return `${match[1]}is${match[2]}`;
  }
  return word;
}

/** The American spelling of a word typed the dialect's way, or the word itself. */
export function toAmericanSpelling(word: string): string {
  const lower = word.toLowerCase();
  const mapped = toAmerican.get(lower);
  if (mapped !== undefined) return mapped;
  if (!SAME_ISE.test(lower)) {
    const match = ISE.exec(lower);
    if (match) return `${match[1]}iz${match[2]}`;
  }
  return word;
}
