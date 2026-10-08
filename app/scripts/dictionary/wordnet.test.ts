// The WordNet converter on a small sample written in WordNet's own file layout.
import { describe, expect, it } from 'vitest';
import { MAX_SENSES, buildChunks, parseData, parseIndex, wordOf } from './wordnet';

const LICENSE_HEADER =
  '  1 This software and database is being provided to you, the LICENSEE, by Princeton University...\n';

const DATA_NOUN =
  LICENSE_HEADER +
  '02084071 05 n 03 dog 0 domestic_dog 0 Canis_familiaris 0 002 @ 02083346 n 0000 ~ 01317541 n 0000 | a member of the genus Canis (probably descended from the common wolf) that has been domesticated by man; "the dog barked all night"\n' +
  '10114209 18 n 02 dog 1 frump 0 001 @ 09624168 n 0000 | a dull unattractive unpleasant girl or woman; "she got a reputation as a frump"; "she\'s a real dog"\n';
const INDEX_NOUN = LICENSE_HEADER + 'dog n 2 2 @ ~ 2 1 02084071 10114209  \n';

const DATA_VERB =
  LICENSE_HEADER +
  '01990806 38 v 02 run 0 go 5 001 @ 01839234 v 0000 | move fast by using one\'s feet; "he runs fast"\n';
const INDEX_VERB = LICENSE_HEADER + 'run v 1 1 @ 1 1 01990806  \n';

const DATA_ADJ =
  LICENSE_HEADER + '01123148 00 a 02 good 0 well(p) 0 001 ! 01123711 a 0101 | having desirable or positive qualities\n';
const INDEX_ADJ = LICENSE_HEADER + 'good a 1 1 ! 1 1 01123148  \nwell a 1 1 ! 1 0 01123148  \n';

const empty = { index: '', data: '' };

describe('reading WordNet files', () => {
  it('reads a synset: its words, its meaning, and its first example', () => {
    const synsets = parseData(DATA_NOUN, 'n');
    expect(synsets.size).toBe(2);
    expect(synsets.get('02084071')).toEqual({
      pos: 'n',
      words: ['dog', 'domestic dog', 'Canis familiaris'],
      definition:
        'a member of the genus Canis (probably descended from the common wolf) that has been domesticated by man',
      example: 'the dog barked all night',
    });
    expect(synsets.get('10114209')?.example).toBe('she got a reputation as a frump');
  });

  it('turns underscores into spaces and drops an adjective marker', () => {
    expect(wordOf('domestic_dog')).toBe('domestic dog');
    expect(wordOf('well(p)')).toBe('well');
  });

  it('reads the synsets of a word in the order WordNet lists them', () => {
    expect(parseIndex(INDEX_NOUN).get('dog')).toEqual(['02084071', '10114209']);
    expect(parseIndex(INDEX_ADJ).get('well')).toEqual(['01123148']);
  });
});

describe('making chunks', () => {
  const chunks = buildChunks({
    n: { index: INDEX_NOUN, data: DATA_NOUN },
    v: { index: INDEX_VERB, data: DATA_VERB },
    a: { index: INDEX_ADJ, data: DATA_ADJ },
    r: empty,
  });

  it('files each word under its first letter, with the most common sense first', () => {
    expect(Object.keys(chunks).sort()).toEqual(['d', 'g', 'r', 'w']);
    const dog = chunks.d.dog;
    expect(dog).toHaveLength(1);
    expect(dog[0][0]).toBe('n');
    expect(dog[0][1][0][1]).toEqual(['domestic dog', 'Canis familiaris']);
    expect(dog[0][1][0][2]).toBe('the dog barked all night');
    expect(dog[0][1][1][1]).toEqual(['frump']);
  });

  it('leaves out the word itself from its synonyms, and keeps senses without an example short', () => {
    expect(chunks.r.run[0][1][0]).toEqual(["move fast by using one's feet", ['go'], 'he runs fast']);
    expect(chunks.g.good[0][1][0]).toEqual(['having desirable or positive qualities', ['well']]);
  });

  it('keeps no more senses than the limit', () => {
    const many = Array.from({ length: MAX_SENSES + 3 }, (_, at) => String(at).padStart(8, '0'));
    const data = many.map((offset) => `${offset} 00 n 01 thing 0 000 | sense ${offset}`).join('\n');
    const made = buildChunks({
      n: { index: `thing n ${many.length} 0 ${many.length} 0 ${many.join(' ')}  \n`, data },
      v: empty,
      a: empty,
      r: empty,
    });
    expect(made.t.thing[0][1]).toHaveLength(MAX_SENSES);
  });
});
