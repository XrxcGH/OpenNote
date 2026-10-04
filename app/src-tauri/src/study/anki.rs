//! Anki packages (.apkg): reading the notes and pictures of one, and writing a deck as one. The collection
//! inside is a SQLite database in the older "legacy" layout, which every Anki version can import. A package
//! made by a newer Anki without that layout (a zstd-compressed collection) is refused with a message that says why.

use std::collections::BTreeMap;

use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::zip;

/// Most one picture may weigh, and most the pictures of one package may weigh together.
const MAX_PICTURE: usize = 2 * 1024 * 1024;
const MAX_PICTURES_TOTAL: usize = 40 * 1024 * 1024;
const FIELD_SEPARATOR: char = '\u{1f}';

#[derive(Debug, Serialize, PartialEq)]
pub struct Note {
    pub fields: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct Read {
    pub name: String,
    pub notes: Vec<Note>,
    pub media: BTreeMap<String, String>,
}

fn picture_type(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// Reads a package. The error text is for logs; "newer" means the collection is in a format this can't read.
pub fn read(bytes: &[u8]) -> Result<Read, String> {
    let entries = zip::read(bytes)?;
    let find = |name: &str| entries.iter().find(|entry| entry.name == name);
    let newer = find("collection.anki21b").is_some();
    let collection = find("collection.anki21").or_else(|| if newer { None } else { find("collection.anki2") });
    let Some(collection) = collection else {
        return Err(if newer { "newer".to_owned() } else { "empty".to_owned() });
    };
    let dir = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path = dir.path().join("collection.sqlite");
    std::fs::write(&path, &collection.data).map_err(|error| error.to_string())?;
    let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|error| error.to_string())?;
    let mut statement = db
        .prepare("SELECT flds FROM notes ORDER BY id")
        .map_err(|error| error.to_string())?;
    let notes = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|flds| Note {
            fields: flds.split(FIELD_SEPARATOR).map(str::to_owned).collect(),
        })
        .collect();
    let name = deck_name(&db).unwrap_or_default();
    let media = pictures(&entries);
    Ok(Read { name, notes, media })
}

/// The name of the deck the notes are in: the first one that is not the empty Default deck.
fn deck_name(db: &Connection) -> Option<String> {
    let decks: String = db.query_row("SELECT decks FROM col", [], |row| row.get(0)).ok()?;
    let decks: Value = serde_json::from_str(&decks).ok()?;
    let names: Vec<&str> = decks
        .as_object()?
        .values()
        .filter_map(|deck| deck["name"].as_str())
        .collect();
    names
        .iter()
        .find(|name| **name != "Default")
        .or(names.first())
        .map(|name| (*name).to_owned())
}

/// The pictures of the package as data addresses, by the file name the notes use.
fn pictures(entries: &[zip::Entry]) -> BTreeMap<String, String> {
    let mut found = BTreeMap::new();
    let Some(map) = entries.iter().find(|entry| entry.name == "media") else {
        return found;
    };
    let Ok(Value::Object(names)) = serde_json::from_slice::<Value>(&map.data) else {
        return found;
    };
    let mut total = 0;
    for (index, name) in names {
        let (Some(name), Some(file)) = (name.as_str(), entries.iter().find(|entry| entry.name == index)) else {
            continue;
        };
        let Some(kind) = picture_type(name) else { continue };
        if file.data.len() > MAX_PICTURE || total + file.data.len() > MAX_PICTURES_TOTAL {
            continue;
        }
        total += file.data.len();
        found.insert(
            name.to_owned(),
            format!("data:{kind};base64,{}", STANDARD.encode(&file.data)),
        );
    }
    found
}

#[derive(Debug, Deserialize)]
pub struct NoteIn {
    pub id: String,
    pub cloze: bool,
    pub front: String,
    pub back: String,
}

#[derive(Debug, Deserialize)]
pub struct MediaIn {
    pub name: String,
    /// A data address: `data:image/png;base64,...`.
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct DeckIn {
    pub name: String,
    pub notes: Vec<NoteIn>,
    pub media: Vec<MediaIn>,
}

const BASIC: i64 = 1_700_000_000_001;
const CLOZE: i64 = 1_700_000_000_002;
const DECK: i64 = 1_700_000_000_003;
const CSS: &str =
    ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }";
const LATEX_PRE: &str = "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";

fn field(name: &str, ord: usize) -> Value {
    json!({"name": name, "ord": ord, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": []})
}

fn template(name: &str, question: &str, answer: &str) -> Value {
    json!({"name": name, "ord": 0, "qfmt": question, "afmt": answer, "bqfmt": "", "bafmt": "", "did": null,
           "bfont": "", "bsize": 0})
}

fn model(id: i64, name: &str, kind: u8, fields: [&str; 2], card: Value, now: i64) -> Value {
    json!({"id": id, "name": name, "type": kind, "mod": now, "usn": -1, "sortf": 0, "did": 1,
           "tmpls": [card], "flds": [field(fields[0], 0), field(fields[1], 1)], "css": CSS,
           "latexPre": LATEX_PRE, "latexPost": "\\end{document}", "latexsvg": false,
           "req": [[0, if kind == 1 { "all" } else { "any" }, [0]]], "tags": [], "vers": []})
}

fn deck(id: i64, name: &str, now: i64) -> Value {
    json!({"id": id, "name": name, "mod": now, "usn": -1, "lrnToday": [0, 0], "revToday": [0, 0],
           "newToday": [0, 0], "timeToday": [0, 0], "collapsed": false, "browserCollapsed": false,
           "desc": "", "dyn": 0, "conf": 1, "extendNew": 10, "extendRev": 50})
}

/// The cloze numbers a note's text uses, such as 1 and 2 for `{{c1::a}} {{c2::b}}`.
fn cloze_numbers(text: &str) -> Vec<u32> {
    let mut numbers = Vec::new();
    for part in text.split("{{c").skip(1) {
        let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
        if part[digits.len()..].starts_with("::") {
            if let Ok(number) = digits.parse::<u32>() {
                if number > 0 && !numbers.contains(&number) {
                    numbers.push(number);
                }
            }
        }
    }
    numbers.sort_unstable();
    numbers
}

fn checksum(text: &str) -> i64 {
    let hash = Sha256::digest(text.as_bytes());
    i64::from(u32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]))
}

const SCHEMA: &str = "
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null,
  odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
";

/// Writes the collection database for the deck and returns its file's bytes.
fn collection(deck_in: &DeckIn, now_ms: i64) -> Result<Vec<u8>, String> {
    let dir = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path = dir.path().join("collection.anki2");
    let secs = now_ms / 1000;
    let db = Connection::open(&path).map_err(|error| error.to_string())?;
    db.execute_batch(SCHEMA).map_err(|error| error.to_string())?;
    let basic = model(
        BASIC,
        "Basic",
        0,
        ["Front", "Back"],
        template("Card 1", "{{Front}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}"),
        secs,
    );
    let cloze = model(
        CLOZE,
        "Cloze",
        1,
        ["Text", "Extra"],
        template("Cloze", "{{cloze:Text}}", "{{cloze:Text}}<br>\n{{Extra}}"),
        secs,
    );
    let decks = json!({"1": deck(1, "Default", secs), DECK.to_string(): deck(DECK, &deck_in.name, secs)});
    let models = json!({BASIC.to_string(): basic, CLOZE.to_string(): cloze});
    let conf = json!({"activeDecks": [DECK], "curDeck": DECK, "newSpread": 0, "collapseTime": 1200, "timeLim": 0,
                      "estTimes": true, "dueCounts": true, "curModel": BASIC.to_string(), "nextPos": 1,
                      "sortType": "noteFld", "sortBackwards": false, "addToCur": true});
    let dconf = json!({"1": {"id": 1, "mod": 0, "name": "Default", "usn": 0, "maxTaken": 60, "autoplay": true,
        "timer": 0, "replayq": true,
        "new": {"bury": false, "delays": [1, 10], "initialFactor": 2500, "ints": [1, 4, 7], "order": 1, "perDay": 20},
        "rev": {"bury": false, "ease4": 1.3, "ivlFct": 1, "maxIvl": 36500, "perDay": 200, "hardFactor": 1.2},
        "lapse": {"delays": [10], "leechAction": 1, "leechFails": 8, "minInt": 1, "mult": 0}, "dyn": false}});
    db.execute(
        "INSERT INTO col VALUES (1, ?1, ?2, ?2, 11, 0, 0, 0, ?3, ?4, ?5, ?6, '{}')",
        params![
            secs,
            now_ms,
            conf.to_string(),
            models.to_string(),
            decks.to_string(),
            dconf.to_string()
        ],
    )
    .map_err(|error| error.to_string())?;
    let mut next = now_ms;
    let mut due = 0;
    for note in &deck_in.notes {
        next += 1;
        let model = if note.cloze { CLOZE } else { BASIC };
        let fields = format!("{}{FIELD_SEPARATOR}{}", note.front, note.back);
        let guid: String = Sha256::digest(note.id.as_bytes())
            .iter()
            .take(5)
            .map(|byte| format!("{byte:02x}"))
            .collect();
        db.execute(
            "INSERT INTO notes VALUES (?1, ?2, ?3, ?4, -1, '', ?5, ?6, ?7, 0, '')",
            params![next, guid, model, secs, fields, note.front, checksum(&note.front)],
        )
        .map_err(|error| error.to_string())?;
        let numbers = if note.cloze {
            cloze_numbers(&note.front)
        } else {
            Vec::new()
        };
        let ords = if numbers.is_empty() { vec![1] } else { numbers };
        for ord in ords {
            due += 1;
            db.execute(
                "INSERT INTO cards VALUES (?1, ?2, ?3, ?4, ?5, -1, 0, 0, ?6, 0, 0, 0, 0, 0, 0, 0, 0, '')",
                params![next * 100 + i64::from(ord), next, DECK, ord - 1, secs, due],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    db.close().map_err(|(_, error)| error.to_string())?;
    std::fs::read(&path).map_err(|error| error.to_string())
}

/// Writes the deck as a package. `now_ms` is the time to stamp it with, in milliseconds.
pub fn write(deck_in: &DeckIn, now_ms: i64) -> Result<Vec<u8>, String> {
    let mut files = vec![("collection.anki2".to_owned(), collection(deck_in, now_ms)?)];
    let mut names = serde_json::Map::new();
    let mut count = 0;
    for media in &deck_in.media {
        let encoded = media.data.split_once(',').map_or("", |(_, rest)| rest);
        let Ok(data) = STANDARD.decode(encoded) else { continue };
        let safe: String = media
            .name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || "-_.".contains(c) {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        names.insert(count.to_string(), Value::String(safe));
        files.push((count.to_string(), data));
        count += 1;
    }
    files.push(("media".to_owned(), Value::Object(names).to_string().into_bytes()));
    Ok(zip::write(&files))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deck_with_notes() -> DeckIn {
        DeckIn {
            name: "Biology".to_owned(),
            notes: vec![
                NoteIn {
                    id: "a".into(),
                    cloze: false,
                    front: "Powerhouse?".into(),
                    back: "Mitochondria".into(),
                },
                NoteIn {
                    id: "b".into(),
                    cloze: true,
                    front: "The {{c1::nucleus}} and {{c2::ribosome}}".into(),
                    back: String::new(),
                },
            ],
            media: vec![MediaIn {
                name: "pic one.png".into(),
                data: "data:image/png;base64,AQID".into(),
            }],
        }
    }

    #[test]
    fn writes_a_package_it_can_read_back() {
        let bytes = write(&deck_with_notes(), 1_750_000_000_000).unwrap();
        let read = read(&bytes).unwrap();
        assert_eq!(read.name, "Biology");
        assert_eq!(read.notes.len(), 2);
        assert_eq!(
            read.notes[0],
            Note {
                fields: vec!["Powerhouse?".into(), "Mitochondria".into()]
            }
        );
        assert!(read.notes[1].fields[0].contains("{{c2::ribosome}}"));
        assert_eq!(
            read.media.get("pic_one.png").map(String::as_str),
            Some("data:image/png;base64,AQID")
        );
    }

    #[test]
    fn makes_one_card_per_cloze_number() {
        assert_eq!(cloze_numbers("{{c1::a}} {{c3::b}} {{c1::c}} {{cx::d}}"), vec![1, 3]);
    }

    #[test]
    fn refuses_a_collection_in_the_newer_format() {
        let files = vec![
            ("collection.anki21b".to_owned(), vec![1, 2, 3]),
            ("meta".to_owned(), vec![8]),
        ];
        assert_eq!(read(&zip::write(&files)).unwrap_err(), "newer");
    }
}
