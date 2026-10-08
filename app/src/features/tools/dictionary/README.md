# Dictionary and thesaurus

The data and the look-up behind the Dictionary tool window (`ui/DictionaryTool.tsx`). Nothing here uses the network: a word
is looked up in chunks kept in the app, and a dictionary for another language is a file the person chooses.

## How the data is kept

One JSON file for each first letter in `data/en/` (and `_.json` for words that start with anything else). A file maps a
word to its parts of speech, and each part of speech to its senses, the most common first:

```json
{ "cause": [["n", [["a person or thing that makes something happen", ["reason", "source"], "Poor drainage was the cause."]]]] }
```

A sense is `[definition, synonyms, example?]`. The chunk for a letter loads when a word starts with it (`data.ts`), so
the app does not read the whole dictionary to look up one word. `morphy.ts` finds the base form of an inflected word
("running" finds "run") the way WordNet's morphy does, and `lookup.ts` puts the answer together.

## What is bundled now

A starter set of about a hundred common study words, written for the app in the same shape as the full data. The full
English data is made from Princeton WordNet 3.1 with the converter:

```
node app/scripts/dictionary/wordnet.ts <path to WordNet's dict folder>
```

It reads `index.*` and `data.*` for nouns, verbs, adjectives, and adverbs, keeps up to 8 senses and 12 synonyms for a
word, and writes the chunks over the starter set. WordNet's data was not downloaded while this was built, so the full
set is a build step still to run. When it is bundled, WordNet's license notice must ship with the app (the About page
and the credits file), because the license asks for it:

> WordNet Release 3.1. This software and database is being provided to you, the LICENSEE, by Princeton University
> under the following license. By obtaining, using and/or copying this software and database, you agree that you have
> read, understood, and will comply with these terms and conditions. See https://wordnet.princeton.edu/license-and-commercial-use

## Other languages

A dictionary file is JSON: `{ "format": "opennote-dictionary", "name": "Español", "language": "es", "entries": { ... } }`,
with `entries` in the same shape as a chunk. `packs.ts` reads and checks it, and keeps it in the browser's own
storage (IndexedDB) on this device. There is no download: the person chooses the file, so nothing is sent anywhere.
