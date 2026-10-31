// The history, places, languages, and texts kit's start-up words: its window title and its palette commands. The rest of kitHumanities.ts
// joins this object when the kit's code loads (features/tools/humanities/text.ts), so it stays out of start-up.
import type { kitHumanities as all } from './kitHumanities';

const START = {
  title: 'History, places, languages, and texts',
  open: 'Open the history, places, languages, and texts kit',
  keywords: 'humanities history geography languages linguistics literature calendar map timeline frames',
  frames: {
    open: 'Insert a note frame',
    keywords: 'note frame outline template structure case brief memo essay planner lab report field notes',
  },
  coordinates: {
    open: 'Open coordinates and navigation',
    keywords:
      'coordinates latitude longitude UTM MGRS state plane geodesic distance azimuth bearing navigation compass',
  },
  keys: {
    open: 'Open identification keys',
    keywords:
      'identification key dichotomous couplet multi-access character matrix taxon specimen mineral artifact instrument catalog',
  },
  timeline: {
    open: 'Open the timeline builder',
    keywords: 'timeline chronology events periods dynasty reign era BCE CE deep time geologic years before present',
  },
  calendars: {
    open: 'Open the calendar and era converter',
    keywords:
      'calendar convert Julian Gregorian Hebrew Islamic Hijri Persian Chinese lunar new year Easter Maya Coptic Ethiopian era weekday',
  },
  textlab: {
    open: 'Open text analysis and verse',
    keywords:
      'readability Flesch word count frequency concordance KWIC collocation keyness compare versions variants MLU scansion meter hexameter rhyme',
  },
  linguistics: {
    open: 'Open linguistic structures',
    keywords:
      'syntax tree bracket dependency interlinear gloss Leipzig distinctive features natural class phonological rule derivation sound change syllable sonority vowel formant Lobanov Bark',
  },
  scripts: {
    open: 'Open scripts, keyboards, and romanization',
    keywords:
      'IPA keyboard Greek Cyrillic Arabic Hebrew Devanagari Armenian Georgian runes romanization transliteration ALA-LC BGN Hangul Revised Romanization McCune Reischauer kana Hepburn pinyin tone sandhi Thai Vietnamese Telex',
  },
  maps: {
    open: 'Open the map maker',
    keywords:
      'map projection Mercator Robinson Mollweide Equal Earth Winkel conic azimuthal choropleth Jenks GeoJSON great circle route geodesic distance area Tissot scale bar',
  },
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitHumanities.ts. */
export const kitHumanities = START as unknown as typeof all;
export const kitHumanitiesStart = START;
