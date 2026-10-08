// Finding a word's base form, as WordNet's "morphy" does for English: a few endings are taken off or changed, and the
// words that do not follow the rules are listed. The dictionary tries the word as typed first, then these in order.

/** [ending, replacement] for each kind of word. */
const SUFFIXES: readonly (readonly [string, string])[] = [
  ['ies', 'y'],
  ['ves', 'f'],
  ['ves', 'fe'],
  ['ses', 's'],
  ['xes', 'x'],
  ['zes', 'z'],
  ['ches', 'ch'],
  ['shes', 'sh'],
  ['men', 'man'],
  ['s', ''],
  ['ied', 'y'],
  ['ed', 'e'],
  ['ed', ''],
  ['ing', 'e'],
  ['ing', ''],
  ['ier', 'y'],
  ['iest', 'y'],
  ['er', 'e'],
  ['er', ''],
  ['est', 'e'],
  ['est', ''],
  ['ly', ''],
];

/** Words whose forms the rules cannot find. */
const IRREGULAR: Readonly<Record<string, readonly string[]>> = {
  was: ['be'],
  were: ['be'],
  been: ['be'],
  is: ['be'],
  are: ['be'],
  am: ['be'],
  went: ['go'],
  gone: ['go'],
  had: ['have'],
  has: ['have'],
  did: ['do'],
  done: ['do'],
  does: ['do'],
  made: ['make'],
  said: ['say'],
  saw: ['see'],
  seen: ['see'],
  took: ['take'],
  taken: ['take'],
  gave: ['give'],
  given: ['give'],
  came: ['come'],
  knew: ['know'],
  known: ['know'],
  thought: ['think'],
  found: ['find'],
  wrote: ['write'],
  written: ['write'],
  ran: ['run'],
  began: ['begin'],
  begun: ['begin'],
  children: ['child'],
  people: ['person'],
  men: ['man'],
  women: ['woman'],
  feet: ['foot'],
  teeth: ['tooth'],
  mice: ['mouse'],
  geese: ['goose'],
  data: ['datum'],
  criteria: ['criterion'],
  phenomena: ['phenomenon'],
  analyses: ['analysis'],
  hypotheses: ['hypothesis'],
  better: ['good', 'well'],
  best: ['good', 'well'],
  worse: ['bad'],
  worst: ['bad'],
};

/** The letters a word ends in twice when it takes -ing or -ed ("running"), as one letter ("run"). */
function undoubled(stem: string): string | null {
  const last = stem.at(-1);
  return stem.length > 2 && last !== undefined && last === stem.at(-2) && !'aeiouls'.includes(last)
    ? stem.slice(0, -1)
    : null;
}

/** Other forms to try for a word, base forms first, and never the word itself. */
export function baseForms(word: string): string[] {
  const found: string[] = [...(IRREGULAR[word] ?? [])];
  for (const [ending, replacement] of SUFFIXES) {
    if (word.length <= ending.length + 1 || !word.endsWith(ending)) continue;
    const stem = `${word.slice(0, -ending.length)}${replacement}`;
    found.push(stem);
    const single = undoubled(word.slice(0, -ending.length));
    if (single && (ending === 'ing' || ending === 'ed' || ending === 'er' || ending === 'est')) {
      found.push(`${single}${replacement}`);
    }
  }
  return [...new Set(found)].filter((one) => one !== word);
}
