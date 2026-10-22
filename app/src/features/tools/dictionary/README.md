# Dictionary and thesaurus

The data and the look-up behind the Dictionary tool window (`ui/DictionaryTool.tsx`). A word is looked up in chunks kept
on this device. The only network use is the optional full-dictionary download described below, which the person starts.

## How the data is kept

One JSON file for each first letter in `data/en/` (and `_.json` for words that start with anything else). A file maps a
word to its parts of speech, and each part of speech to its senses, the most common first:

```json
{
  "cause": [
    ["n", [["a person or thing that makes something happen", ["reason", "source"], "Poor drainage was the cause."]]]
  ]
}
```

A sense is `[definition, synonyms, example?]`. The chunk for a letter loads when a word starts with it (`data.ts`), so
the app does not read the whole dictionary to look up one word. The file `morphy.ts` finds the base form of an inflected word
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

## The optional full dictionary

`full.ts` and `ui/FullDictionary.tsx` are the interface side of `app/src-tauri/src/dictionary/`. The first time the window
opens it asks (size, sources, licenses) whether to download Open English WordNet 2025 (CC BY 4.0, GitHub release asset)
for meanings and Moby Thesaurus II (public domain, Project Gutenberg ebook 3202) for related words. Nothing downloads
before the person says so, and never while Work offline or safe mode is on.

- The shell pins each file's URL, size, and SHA-256 (`dictionary/mod.rs`), opens only those addresses, resumes a partial
  file, cuts off a server that sends more than the pinned size, and keeps a file only when the checksum matches.
- It then builds an index of gzip chunks, one per first letter, in the same shape as the bundled chunks
  (`en/<letter>.json.gz`, plus `thesaurus/<letter>.json.gz` for related words), and deletes the downloads. Look-ups read a
  chunk through the `dictionary_call` command (`chunk`), so the app never loads the whole dictionary.
- Installed words are layered over the 100-word starter list (`layered`), so the starter words work without it, and
  Remove dictionary data returns to it.
- Tests use a local mock server (`dictionary/tests.rs`). `OPENNOTE_DICT_REAL=<folder> cargo test -p opennote --lib
real_data -- --ignored` builds the index from the real files.
- The pinned values were taken on 2026-10-21. OEWN's digest is the one GitHub publishes for the release asset. Project
  Gutenberg publishes none, so the Moby digest was computed once from the file as served.
