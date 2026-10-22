//! Building the on-device index from the two downloaded files: Open English WordNet (LMF XML, gzip) for meanings and
//! Moby Thesaurus II (one line for each root word) for related words. The index is one gzip file for each first
//! letter, in the same shape the interface reads from the bundled starter set (see app/src/features/tools/dictionary).

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File},
    io::{self, BufRead, BufReader, Write},
    path::Path,
};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

/// The most senses kept for a part of speech, and the most synonyms kept for a sense.
const MAX_SENSES: usize = 8;
const MAX_SYNONYMS: usize = 12;
/// The most related words kept for a root word.
const MAX_RELATED: usize = 150;

/// Why an index could not be built.
#[derive(Debug)]
pub enum BuildError {
    Disk,
    /// A file is not what it should be: not gzip, not XML, or with no words in it.
    Unreadable,
}

impl From<io::Error> for BuildError {
    fn from(_: io::Error) -> Self {
        BuildError::Disk
    }
}

/// What a build made.
#[derive(Debug, PartialEq, Eq)]
pub struct Built {
    pub words: usize,
    pub related: usize,
}

/// The chunk a word lives in: its first letter without accents, or an underscore. The interface uses the same rule.
pub fn chunk_key(word: &str) -> char {
    match word.nfd().next() {
        Some(first) if first.is_ascii_lowercase() => first,
        _ => '_',
    }
}

fn unescape(text: &str) -> String {
    if !text.contains('&') {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let Some(end) = rest.find(';').filter(|end| *end <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let name = &rest[1..end];
        let decoded = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => name
                .strip_prefix("#x")
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| name.strip_prefix('#').and_then(|dec| dec.parse().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => out.push(c),
            None => out.push_str(&rest[..=end]),
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

fn attribute(tag: &BytesStart<'_>, key: &str) -> Option<String> {
    tag.attributes()
        .flatten()
        .find(|attr| attr.key.as_ref() == key)
        .map(|attr| unescape(&attr.value))
}

fn pos_code(code: &str) -> Option<&'static str> {
    match code {
        "n" => Some("n"),
        "v" => Some("v"),
        "a" | "s" => Some("a"),
        "r" => Some("r"),
        _ => None,
    }
}

struct Synset {
    pos: &'static str,
    definition: String,
    example: Option<String>,
    members: Vec<String>,
}

/// One lexical entry: its written form, its part of speech, and its senses' synsets in order.
struct Entry {
    written: String,
    pos: &'static str,
    synsets: Vec<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum Reading {
    Definition,
    Example,
}

fn lemma(tag: &BytesStart<'_>) -> Option<Entry> {
    let written = attribute(tag, "writtenForm").filter(|written| !written.is_empty())?;
    let pos = attribute(tag, "partOfSpeech").and_then(|code| pos_code(&code))?;
    Some(Entry {
        written,
        pos,
        synsets: Vec::new(),
    })
}

/// What has been read of the word list so far, and where in an entry or synset the reader is.
#[derive(Default)]
struct Wordnet {
    entries: Vec<Entry>,
    synsets: HashMap<String, Synset>,
    entry: Option<Entry>,
    synset: Option<(String, Synset)>,
    reading: Option<Reading>,
    text: String,
    /// Entry id to written form, and synset id to its members' entry ids.
    ids: HashMap<String, String>,
    entry_id: String,
    members_of: HashMap<String, Vec<String>>,
}

impl Wordnet {
    fn open(&mut self, tag: &BytesStart<'_>, empty: bool) {
        match tag.name().as_ref() {
            "LexicalEntry" => self.entry_id = attribute(tag, "id").unwrap_or_default(),
            "Synset" if !empty => self.open_synset(tag),
            "Definition" | "Example" if !empty => {
                self.reading = Some(if tag.name().as_ref() == "Definition" {
                    Reading::Definition
                } else {
                    Reading::Example
                });
                self.text.clear();
            }
            "Lemma" => {
                if let Some(found) = lemma(tag) {
                    self.ids.insert(self.entry_id.clone(), found.written.clone());
                    self.entry = Some(found);
                }
            }
            "Sense" => {
                if let (Some(current), Some(target)) = (self.entry.as_mut(), attribute(tag, "synset")) {
                    current.synsets.push(target);
                }
            }
            _ => {}
        }
    }

    fn open_synset(&mut self, tag: &BytesStart<'_>) {
        let id = attribute(tag, "id").unwrap_or_default();
        let members = attribute(tag, "members").unwrap_or_default();
        let Some(pos) = attribute(tag, "partOfSpeech").and_then(|code| pos_code(&code)) else {
            return;
        };
        self.members_of
            .insert(id.clone(), members.split_whitespace().map(str::to_owned).collect());
        let blank = Synset {
            pos,
            definition: String::new(),
            example: None,
            members: Vec::new(),
        };
        self.synset = Some((id, blank));
    }

    fn close(&mut self, name: &str) {
        match name {
            "Definition" | "Example" => {
                if let (Some((_, current)), Some(reading)) = (self.synset.as_mut(), self.reading) {
                    let clean = self.text.split_whitespace().collect::<Vec<_>>().join(" ");
                    if reading == Reading::Definition {
                        current.definition = clean;
                    } else if current.example.is_none() && !clean.is_empty() {
                        current.example = Some(clean);
                    }
                }
                self.reading = None;
            }
            "Synset" => {
                if let Some((id, done)) = self.synset.take() {
                    self.synsets.insert(id, done);
                }
            }
            "LexicalEntry" => self.entries.extend(self.entry.take()),
            _ => {}
        }
    }

    /// A synset lists its members by entry id; their written forms make its synonyms.
    fn finish(mut self) -> Result<(Vec<Entry>, HashMap<String, Synset>), BuildError> {
        for (id, synset) in &mut self.synsets {
            synset.members = self
                .members_of
                .get(id)
                .into_iter()
                .flatten()
                .filter_map(|member| self.ids.get(member).cloned())
                .collect();
        }
        if self.entries.is_empty() || self.synsets.is_empty() {
            return Err(BuildError::Unreadable);
        }
        Ok((self.entries, self.synsets))
    }
}

fn read_wordnet(path: &Path) -> Result<(Vec<Entry>, HashMap<String, Synset>), BuildError> {
    let file = File::open(path)?;
    let mut reader = Reader::from_reader(BufReader::new(GzDecoder::new(file)));
    let mut buffer = Vec::new();
    let mut wordnet = Wordnet::default();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(tag)) => wordnet.open(&tag, false),
            Ok(Event::Empty(tag)) => wordnet.open(&tag, true),
            Ok(Event::Text(chunk)) if wordnet.reading.is_some() => wordnet.text.push_str(&chunk.xml10_content()),
            Ok(Event::GeneralRef(reference)) if wordnet.reading.is_some() => {
                wordnet
                    .text
                    .push_str(&unescape(&format!("&{};", reference.xml10_content())));
            }
            Ok(Event::End(tag)) => wordnet.close(tag.name().as_ref()),
            Ok(Event::Eof) => break,
            Err(_) => return Err(BuildError::Unreadable),
            Ok(_) => {}
        }
        buffer.clear();
    }
    wordnet.finish()
}

type Senses = Vec<(&'static str, Vec<Value>)>;

fn meanings(entries: &[Entry], synsets: &HashMap<String, Synset>) -> BTreeMap<String, Senses> {
    // Entries already in lowercase come first, so "turkey" the bird leads "Turkey" the country.
    let mut order: Vec<&Entry> = entries.iter().collect();
    order.sort_by_key(|entry| entry.written != entry.written.to_lowercase());
    let mut words: BTreeMap<String, Senses> = BTreeMap::new();
    for entry in order {
        let word = entry.written.to_lowercase();
        let list = words.entry(word.clone()).or_default();
        let at = match list.iter().position(|(pos, _)| *pos == entry.pos) {
            Some(at) => at,
            None => {
                list.push((entry.pos, Vec::new()));
                list.len() - 1
            }
        };
        for id in &entry.synsets {
            let Some(synset) = synsets.get(id) else { continue };
            if synset.pos != entry.pos {
                continue;
            }
            if list[at].1.len() >= MAX_SENSES || synset.definition.is_empty() {
                continue;
            }
            let mut seen = HashSet::from([word.clone()]);
            let synonyms: Vec<&str> = synset
                .members
                .iter()
                .filter(|member| seen.insert(member.to_lowercase()))
                .map(String::as_str)
                .take(MAX_SYNONYMS)
                .collect();
            let mut sense = vec![json!(synset.definition), json!(synonyms)];
            if let Some(example) = &synset.example {
                sense.push(json!(example));
            }
            list[at].1.push(Value::Array(sense));
        }
    }
    words
        .values_mut()
        .for_each(|list| list.retain(|(_, senses)| !senses.is_empty()));
    words.retain(|_, list| !list.is_empty());
    words
}

fn read_moby(path: &Path) -> Result<BTreeMap<String, Vec<String>>, BuildError> {
    let mut reader = BufReader::new(File::open(path)?);
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut raw = Vec::new();
    while reader.read_until(b'\n', &mut raw)? > 0 {
        let line = String::from_utf8_lossy(&raw).trim().to_owned();
        raw.clear();
        let mut parts = line.split(',').map(str::trim).filter(|part| !part.is_empty());
        let Some(root) = parts.next() else { continue };
        let root = root.to_lowercase();
        let related: Vec<String> = parts
            .filter(|part| part.to_lowercase() != root)
            .take(MAX_RELATED)
            .map(str::to_owned)
            .collect();
        if !related.is_empty() {
            out.entry(root).or_default().extend(related);
        }
    }
    if out.is_empty() {
        return Err(BuildError::Unreadable);
    }
    Ok(out)
}

fn write_chunks(dir: &Path, chunks: BTreeMap<char, serde_json::Map<String, Value>>) -> Result<(), BuildError> {
    fs::create_dir_all(dir)?;
    for (key, chunk) in chunks {
        let mut file = GzEncoder::new(
            File::create(dir.join(format!("{key}.json.gz")))?,
            Compression::default(),
        );
        file.write_all(Value::Object(chunk).to_string().as_bytes())?;
        file.finish()?.sync_all()?;
    }
    Ok(())
}

/// Reads the two downloaded files and writes the index into `out` (a folder that is empty or does not exist yet):
/// `en/<letter>.json.gz` for meanings and `thesaurus/<letter>.json.gz` for related words.
pub fn build(wordnet: &Path, moby: &Path, out: &Path) -> Result<Built, BuildError> {
    let (entries, synsets) = read_wordnet(wordnet)?;
    let words = meanings(&entries, &synsets);
    drop((entries, synsets));
    let related = read_moby(moby)?;
    let counts = Built {
        words: words.len(),
        related: related.len(),
    };
    let mut chunks: BTreeMap<char, serde_json::Map<String, Value>> = BTreeMap::new();
    for (word, list) in words {
        let key = chunk_key(&word);
        let entry: Vec<Value> = list.into_iter().map(|(pos, senses)| json!([pos, senses])).collect();
        chunks.entry(key).or_default().insert(word, Value::Array(entry));
    }
    write_chunks(&out.join("en"), chunks)?;
    let mut chunks: BTreeMap<char, serde_json::Map<String, Value>> = BTreeMap::new();
    for (word, list) in related {
        chunks.entry(chunk_key(&word)).or_default().insert(word, json!(list));
    }
    write_chunks(&out.join("thesaurus"), chunks)?;
    Ok(counts)
}

/// Reads one chunk of the built index: its JSON text, or none when the letter has no words.
pub fn read_chunk(dir: &Path, set: &str, key: char) -> io::Result<Option<String>> {
    let path = dir.join(set).join(format!("{key}.json.gz"));
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut text = String::new();
    io::Read::read_to_string(&mut GzDecoder::new(file), &mut text)?;
    Ok(Some(text))
}
