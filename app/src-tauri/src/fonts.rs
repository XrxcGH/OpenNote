//! The device's fonts (ADR 0080). `fonts_list` lists the font families on this device with `fontdb` and reads
//! each face's metrics with `ttf-parser`. The list is cached for the session, and `refresh` scans again.
//!
//! The list never leaves the device. This module writes no log line and no event, and no font name goes into a
//! diagnostics bundle or a crash report.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, PoisonError},
};

use fontdb::{Database, Style};
use serde::Serialize;
use ttf_parser::{Face as Font, Permissions, Tag};

use crate::ipc::{codes, IpcError, IpcResult};

/// One face of a family: a weight and a style, with the metrics line spacing and exports need.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFace {
    /// The PostScript name, such as `Name-BoldItalic`.
    pub post_script_name: String,
    /// `normal`, `italic`, or `oblique`.
    pub style: &'static str,
    /// 100 to 900.
    pub weight: u16,
    /// 1 (ultra condensed) to 9 (ultra expanded); 5 is normal.
    pub stretch: u8,
    /// Every glyph has the same advance (the `post` table's fixed-pitch flag).
    pub monospace: bool,
    /// What `OS/2` `fsType` allows: `installable`, `editable`, `preview-print`, `restricted`, or `unknown`.
    pub embedding: &'static str,
    /// Font units per em.
    pub units_per_em: u16,
    /// `usWinAscent` (the hhea ascender when the font has no `OS/2` table).
    pub win_ascent: u16,
    /// `usWinDescent`, positive (the negated hhea descender when the font has no `OS/2` table).
    pub win_descent: u16,
    /// `sTypoLineGap` (the hhea line gap when the font has no `OS/2` table).
    pub typo_line_gap: i16,
    /// `sxHeight`, in font units, when the font gives it.
    pub x_height: Option<i16>,
    /// `sCapHeight`, in font units, when the font gives it.
    pub cap_height: Option<i16>,
}

/// A family: its faces, and what kind of type it is.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    /// The family name, such as `Name`.
    pub name: String,
    /// `serif`, `sans-serif`, `cursive`, `fantasy`, `symbol`, or `unknown`, from `OS/2` `sFamilyClass`, then PANOSE.
    pub generic: &'static str,
    /// Whether the family's regular face is monospace.
    pub monospace: bool,
    /// One face per weight and style, lightest first.
    pub faces: Vec<FontFace>,
}

const OS2: Tag = Tag::from_bytes(b"OS/2");

/// The `OS/2` class and PANOSE bytes, if the table is long enough to hold them (`sFamilyClass` is at byte 30
/// and PANOSE at 32, in every version of the table).
fn class_and_panose(face: &Font) -> Option<(i16, [u8; 10])> {
    let table = face.raw_face().table(OS2)?;
    let class = i16::from_be_bytes(table.get(30..32)?.try_into().ok()?);
    let panose: [u8; 10] = table.get(32..42)?.try_into().ok()?;
    Some((class, panose))
}

/// The generic class: the high byte of `sFamilyClass` first, and PANOSE when the class says nothing.
pub(crate) fn generic_class(class: i16, panose: [u8; 10]) -> &'static str {
    match class >> 8 {
        1..=5 | 7 => return "serif",
        8 => return "sans-serif",
        9 => return "fantasy",
        10 => return "cursive",
        12 => return "symbol",
        _ => {}
    }
    match (panose[0], panose[1]) {
        // Latin text: serif styles 2 to 10 have serifs, and 11 to 15 don't.
        (2, 2..=10) => "serif",
        (2, 11..=15) => "sans-serif",
        (3, _) => "cursive",
        (4, _) => "fantasy",
        (5, _) => "symbol",
        _ => "unknown",
    }
}

fn embedding(face: &Font) -> &'static str {
    match face.permissions() {
        Some(Permissions::Installable) => "installable",
        Some(Permissions::Editable) => "editable",
        Some(Permissions::PreviewAndPrint) => "preview-print",
        Some(Permissions::Restricted) => "restricted",
        None => "unknown",
    }
}

fn style_name(style: Style) -> &'static str {
    match style {
        Style::Normal => "normal",
        Style::Italic => "italic",
        Style::Oblique => "oblique",
    }
}

fn style_rank(style: &str) -> u8 {
    match style {
        "normal" => 0,
        "italic" => 1,
        _ => 2,
    }
}

/// Reads one face's metrics. A face `ttf-parser` can't read is left out.
fn read_face(info: &fontdb::FaceInfo, data: &[u8]) -> Option<(FontFace, &'static str)> {
    let face = Font::parse(data, info.index).ok()?;
    let (win_ascent, win_descent, typo_line_gap) = match face.tables().os2 {
        Some(os2) => (
            os2.windows_ascender() as u16,
            os2.windows_descender().unsigned_abs(),
            os2.typographic_line_gap(),
        ),
        None => (
            face.ascender().max(0) as u16,
            face.descender().saturating_neg().max(0) as u16,
            face.line_gap(),
        ),
    };
    let generic = class_and_panose(&face).map_or("unknown", |(class, panose)| generic_class(class, panose));
    let out = FontFace {
        post_script_name: info.post_script_name.clone(),
        style: style_name(info.style),
        weight: info.weight.0,
        stretch: info.stretch.to_number() as u8,
        monospace: info.monospaced,
        embedding: embedding(&face),
        units_per_em: face.units_per_em(),
        win_ascent,
        win_descent,
        typo_line_gap,
        x_height: face.x_height(),
        cap_height: face.capital_height(),
    };
    Some((out, generic))
}

/// The families of a database, sorted by name, with their faces sorted by weight and then style.
pub(crate) fn scan(db: &Database) -> Vec<FontFamily> {
    let mut families: Vec<FontFamily> = Vec::new();
    let mut by_name = HashMap::<String, usize>::new();
    for info in db.faces() {
        let Some(name) = info.families.first().map(|(name, _)| name.clone()) else {
            continue;
        };
        let Some((face, generic)) = db.with_face_data(info.id, |data, _| read_face(info, data)).flatten() else {
            continue;
        };
        let slot = *by_name.entry(name.to_lowercase()).or_insert_with(|| {
            families.push(FontFamily {
                name,
                generic: "unknown",
                monospace: false,
                faces: Vec::new(),
            });
            families.len() - 1
        });
        let family = &mut families[slot];
        // The same face twice, as when a font is installed for the user and for the machine, counts once.
        let same = |f: &FontFace| f.weight == face.weight && f.style == face.style && f.stretch == face.stretch;
        if family.faces.iter().any(same) {
            continue;
        }
        if (face.weight == 400 && face.style == "normal") || family.faces.is_empty() {
            family.generic = generic;
            family.monospace = face.monospace;
        }
        family.faces.push(face);
    }
    for family in &mut families {
        family.faces.sort_by_key(|f| (f.weight, style_rank(f.style), f.stretch));
    }
    families.sort_by_key(|f| (f.name.to_lowercase(), f.name.clone()));
    families
}

/// The families installed on this device.
fn scan_system() -> Vec<FontFamily> {
    let mut db = Database::new();
    db.load_system_fonts();
    scan(&db)
}

static CACHE: Mutex<Option<Arc<Vec<FontFamily>>>> = Mutex::new(None);

/// The cached list, scanning first when there is none or when `refresh` asks.
fn cached(refresh: bool, scan: impl FnOnce() -> Vec<FontFamily>) -> Arc<Vec<FontFamily>> {
    let mut cache = CACHE.lock().unwrap_or_else(PoisonError::into_inner);
    if refresh || cache.is_none() {
        *cache = Some(Arc::new(scan()));
    }
    cache.clone().unwrap_or_default()
}

/// The font families on this device, with their faces and metrics. `refresh` scans again, as when the person
/// installs a font while the app runs.
#[tauri::command]
pub async fn fonts_list(refresh: Option<bool>) -> IpcResult<Vec<FontFamily>> {
    let refresh = refresh.unwrap_or(false);
    let list = tauri::async_runtime::spawn_blocking(move || cached(refresh, scan_system))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
    Ok(list.as_ref().clone())
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;

    /// What a synthetic font says about itself. The values are chosen here and read back by the scan, so each
    /// expectation below is worked by hand from the table layouts of the OpenType specification.
    #[derive(Clone)]
    struct Spec {
        family: String,
        style: &'static str,
        weight: u16,
        italic: bool,
        fs_type: u16,
        class: i16,
        panose: [u8; 10],
        mono: bool,
    }

    impl Spec {
        fn new(family: &str, style: &'static str, weight: u16) -> Spec {
            Spec {
                family: family.to_owned(),
                style,
                weight,
                italic: false,
                fs_type: 0,
                class: 0,
                panose: [0; 10],
                mono: false,
            }
        }
    }

    fn u16s(out: &mut Vec<u8>, values: &[u16]) {
        for v in values {
            out.extend_from_slice(&v.to_be_bytes());
        }
    }

    fn utf16(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(u16::to_be_bytes).collect()
    }

    /// A TrueType font with the tables a scan reads and no outlines (OpenType 1.9, "Font file organization").
    fn build(spec: &Spec) -> Vec<u8> {
        let mut head = vec![0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x5F, 0x0F, 0x3C, 0xF5];
        u16s(&mut head, &[0, 1000]);
        head.resize(54, 0);
        let mut hhea = vec![0, 1, 0, 0];
        u16s(&mut hhea, &[900, (-300_i16) as u16, 50]);
        hhea.resize(36, 0);
        let maxp = vec![0, 0, 0x50, 0, 0, 1];
        let mut os2 = Vec::new();
        u16s(&mut os2, &[2, 500, spec.weight, 5, spec.fs_type]);
        os2.resize(30, 0);
        u16s(&mut os2, &[spec.class as u16]);
        os2.extend_from_slice(&spec.panose);
        os2.resize(62, 0);
        u16s(&mut os2, &[if spec.italic { 1 } else { 0x40 }, 32, 126]);
        // sTypoAscender, sTypoDescender, sTypoLineGap, usWinAscent, usWinDescent.
        u16s(&mut os2, &[800, (-200_i16) as u16, 90, 1100, 300]);
        os2.resize(86, 0);
        // sxHeight, sCapHeight.
        u16s(&mut os2, &[500, 700]);
        os2.resize(96, 0);
        let mut post = vec![0, 3, 0, 0];
        post.resize(12, 0);
        post.extend_from_slice(&u32::from(spec.mono).to_be_bytes());
        post.resize(32, 0);
        let postscript = format!("{}-{}", spec.family.replace(' ', ""), spec.style.replace(' ', ""));
        let names = [
            (1_u16, spec.family.clone()),
            (2, spec.style.to_owned()),
            (6, postscript),
        ];
        let mut name = Vec::new();
        u16s(&mut name, &[0, names.len() as u16, 6 + 12 * names.len() as u16]);
        let mut strings = Vec::new();
        for (id, text) in &names {
            let bytes = utf16(text);
            u16s(&mut name, &[3, 1, 0x409, *id, bytes.len() as u16, strings.len() as u16]);
            strings.extend(bytes);
        }
        name.extend(strings);
        let mut tables = [
            (*b"OS/2", os2),
            (*b"head", head),
            (*b"hhea", hhea),
            (*b"maxp", maxp),
            (*b"name", name),
            (*b"post", post),
        ];
        tables.sort_by_key(|(tag, _)| *tag);
        let mut out = vec![0, 1, 0, 0];
        u16s(&mut out, &[tables.len() as u16, 64, 2, 32]);
        let mut offset = 12 + 16 * tables.len();
        let mut body = Vec::new();
        for (tag, data) in &tables {
            out.extend_from_slice(tag);
            out.extend_from_slice(&[0, 0, 0, 0]);
            out.extend_from_slice(&(offset as u32).to_be_bytes());
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            body.extend_from_slice(data);
            while body.len() % 4 != 0 {
                body.push(0);
            }
            offset = 12 + 16 * tables.len() + body.len();
        }
        out.extend(body);
        out
    }

    fn folder(specs: &[Spec]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("a temp folder");
        for (i, spec) in specs.iter().enumerate() {
            std::fs::write(dir.path().join(format!("face{i}.ttf")), build(spec)).expect("a font file");
        }
        dir
    }

    fn scan_dir(dir: &std::path::Path) -> Vec<FontFamily> {
        let mut db = Database::new();
        db.load_fonts_dir(dir);
        scan(&db)
    }

    fn three_families() -> Vec<Spec> {
        let sans = |style, weight, italic| Spec {
            class: 8 << 8,
            italic,
            ..Spec::new("Test Sans", style, weight)
        };
        vec![
            sans("Regular", 400, false),
            sans("Bold", 700, false),
            sans("Italic", 400, true),
            Spec {
                class: 2 << 8,
                ..Spec::new("Test Serif", "Regular", 400)
            },
            Spec {
                panose: [2, 11, 0, 9, 0, 0, 0, 0, 0, 0],
                mono: true,
                ..Spec::new("Test Mono", "Regular", 400)
            },
        ]
    }

    #[test]
    fn a_folder_of_fonts_lists_each_family_once_with_the_metrics_the_tables_hold() {
        let dir = folder(&three_families());
        let list = scan_dir(dir.path());
        let names: Vec<&str> = list.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["Test Mono", "Test Sans", "Test Serif"]);
        let monos: Vec<bool> = list.iter().map(|f| f.monospace).collect();
        assert_eq!(monos, [true, false, false], "only the mono font is monospace");
        let generics: Vec<&str> = list.iter().map(|f| f.generic).collect();
        assert_eq!(generics, ["sans-serif", "sans-serif", "serif"]);
        let sans = &list[1];
        let faces: Vec<(u16, &str)> = sans.faces.iter().map(|f| (f.weight, f.style)).collect();
        assert_eq!(faces, [(400, "normal"), (400, "italic"), (700, "normal")]);
        let face = &sans.faces[0];
        assert_eq!(face.post_script_name, "TestSans-Regular");
        assert_eq!(
            (face.units_per_em, face.win_ascent, face.win_descent),
            (1000, 1100, 300)
        );
        assert_eq!(
            (face.typo_line_gap, face.x_height, face.cap_height),
            (90, Some(500), Some(700))
        );
        assert_eq!(
            (face.stretch, face.monospace, face.embedding),
            (5, false, "installable")
        );
    }

    #[test]
    fn the_same_face_found_twice_counts_once() {
        let spec = Spec::new("Twin", "Regular", 400);
        let dir = folder(&[spec.clone(), spec]);
        let list = scan_dir(dir.path());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].faces.len(), 1);
    }

    #[test]
    fn fs_type_says_what_embedding_the_font_allows() {
        let cases = [
            (0, "installable"),
            (2, "restricted"),
            (4, "preview-print"),
            (8, "editable"),
        ];
        for (fs_type, expected) in cases {
            let spec = Spec {
                fs_type,
                ..Spec::new("Embed", "Regular", 400)
            };
            let list = scan_dir(folder(&[spec]).path());
            assert_eq!(list[0].faces[0].embedding, expected, "fsType {fs_type}");
        }
    }

    #[test]
    fn the_generic_class_follows_sfamilyclass_and_then_panose() {
        let none = [0; 10];
        assert_eq!(generic_class(1 << 8, none), "serif");
        assert_eq!(generic_class(5 << 8, none), "serif");
        assert_eq!(generic_class(8 << 8, none), "sans-serif");
        assert_eq!(generic_class(9 << 8, none), "fantasy");
        assert_eq!(generic_class(10 << 8, none), "cursive");
        assert_eq!(generic_class(12 << 8, none), "symbol");
        assert_eq!(generic_class(0, [2, 2, 0, 0, 0, 0, 0, 0, 0, 0]), "serif");
        assert_eq!(generic_class(0, [2, 11, 0, 0, 0, 0, 0, 0, 0, 0]), "sans-serif");
        assert_eq!(generic_class(0, [3, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "cursive");
        assert_eq!(generic_class(0, [4, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "fantasy");
        assert_eq!(generic_class(0, [5, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "symbol");
        assert_eq!(generic_class(0, none), "unknown");
        assert_eq!(
            generic_class(8 << 8, [2, 2, 0, 0, 0, 0, 0, 0, 0, 0]),
            "sans-serif",
            "the class wins"
        );
    }

    #[test]
    fn the_list_is_cached_until_a_refresh_asks_for_another_scan() {
        let one = || vec![];
        let first = cached(true, one);
        let again = cached(false, || panic!("a cached list isn't scanned again"));
        assert!(Arc::ptr_eq(&first, &again));
        let fresh = cached(true, one);
        assert!(!Arc::ptr_eq(&first, &fresh));
    }

    /// 1,000 synthetic families listed under 150 ms on the reference laptop. The nightly job sets the variable
    /// and gates on it; any other run reports the time and checks only that it isn't absurd.
    #[test]
    fn a_thousand_families_list_quickly() {
        let mut db = Database::new();
        for i in 0..1000 {
            db.load_font_data(build(&Spec::new(&format!("Family {i:04}"), "Regular", 400)));
        }
        let start = Instant::now();
        let list = scan(&db);
        let took = start.elapsed();
        assert_eq!(list.len(), 1000);
        eprintln!("fonts: 1000 families listed in {took:?}");
        let limit = if std::env::var_os("OPENNOTE_BENCH_GATE").is_some() {
            150
        } else {
            5000
        };
        assert!(took.as_millis() < limit, "{took:?} is over {limit} ms");
    }

    #[test]
    fn no_font_name_reaches_a_diagnostics_bundle() {
        use opennote_crashreport::Scrubber;
        use opennote_diagnostics::{Bundle, BundleInputs, BundleOptions, SystemFacts};

        let name = "Zzyzx Quillfeather";
        let dir = folder(&[Spec::new(name, "Regular", 400)]);
        let list = scan_dir(dir.path());
        assert_eq!(list[0].name, name, "the scan did find the font");
        let logs = tempfile::tempdir().expect("a logs folder");
        let options = BundleOptions::default();
        let bundle = Bundle::build(&BundleInputs {
            facts: &SystemFacts::default(),
            self_check: None,
            logs_dir: Some(logs.path()),
            crash_store: None,
            scrubber: &Scrubber::detect(),
            now_unix: 1_790_000_000,
            options: &options,
        });
        let text = bundle.review().text().to_owned();
        assert!(
            !text.contains(name) && !text.contains("Quillfeather"),
            "the bundle names a font"
        );
        // The module itself never logs: no log macro and no print outside its tests.
        let source = include_str!("fonts.rs");
        let code = source.split("#[cfg(test)]").next().expect("the code part");
        for banned in ["log::", "println!", "eprintln!", "tracing::", ".emit("] {
            assert!(!code.contains(banned), "fonts.rs uses {banned}");
        }
    }
}
