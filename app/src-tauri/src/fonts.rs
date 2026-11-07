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
    /// `fsType` bit 8 is clear: an export may embed just the glyphs it uses.
    pub subsettable: bool,
    /// `fsType` bit 9 is set: only bitmap strikes may be embedded, not outlines.
    pub bitmap_only: bool,
    /// The face comes from a variable font (it has an `fvar` table).
    pub variable: bool,
    /// The named instance of a variable font, such as `Bold`; none for a static font.
    pub instance: Option<String>,
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

const FVAR: Tag = Tag::from_bytes(b"fvar");

/// A big-endian `u16` at `at`.
fn be16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

/// The OS/2 fields read straight from the table bytes: `fsType` at 8, `usWinAscent` at 74, `usWinDescent` at 76.
/// `usWinDescent` is unsigned, so a value above 32767 is kept as it is.
fn os2_fields(face: &Font) -> Option<(u16, u16, u16)> {
    let table = face.raw_face().table(OS2)?;
    Some((be16(table, 8)?, be16(table, 74)?, be16(table, 76)?))
}

/// The `usWidthClass` (1 to 9) nearest to a `wdth` axis value, which is a percent of normal width.
fn width_class(percent: f32) -> u8 {
    const CLASSES: [f32; 9] = [50.0, 62.5, 75.0, 87.5, 100.0, 112.5, 125.0, 150.0, 200.0];
    let mut best = 5;
    let mut gap = f32::MAX;
    for (i, c) in CLASSES.iter().enumerate() {
        if (c - percent).abs() < gap {
            gap = (c - percent).abs();
            best = i as u8 + 1;
        }
    }
    best
}

struct Instance {
    name_id: u16,
    ps_name_id: Option<u16>,
    weight: Option<u16>,
    stretch: Option<u8>,
}

/// The named instances of an `fvar` table (OpenType 1.9, "fvar"): the weight and width of each.
fn named_instances(face: &Font) -> Vec<Instance> {
    let Some(t) = face.raw_face().table(FVAR) else {
        return Vec::new();
    };
    let read = || -> Option<Vec<Instance>> {
        let axes_at = usize::from(be16(t, 4)?);
        let (axis_count, axis_size) = (usize::from(be16(t, 8)?), usize::from(be16(t, 10)?));
        let (count, size) = (usize::from(be16(t, 12)?), usize::from(be16(t, 14)?));
        let tags: Vec<[u8; 4]> = (0..axis_count)
            .map(|i| t.get(axes_at + i * axis_size..)?.get(..4)?.try_into().ok())
            .collect::<Option<_>>()?;
        let first = axes_at + axis_count * axis_size;
        let mut out = Vec::new();
        for n in 0..count {
            let at = first + n * size;
            let coord = |axis: usize| -> Option<f32> {
                let b = t.get(at + 4 + axis * 4..at + 8 + axis * 4)?;
                Some(i32::from_be_bytes(b.try_into().ok()?) as f32 / 65536.0)
            };
            let find = |tag: &[u8; 4]| tags.iter().position(|t| t == tag).and_then(coord);
            let ps = if size >= 6 + axis_count * 4 {
                be16(t, at + 4 + axis_count * 4).filter(|id| *id != 0xFFFF)
            } else {
                None
            };
            out.push(Instance {
                name_id: be16(t, at)?,
                ps_name_id: ps,
                weight: find(b"wght").map(|w| w.round().clamp(1.0, 1000.0) as u16),
                stretch: find(b"wdth").map(width_class),
            });
        }
        Some(out)
    };
    read().unwrap_or_default()
}

fn name_of(face: &Font, id: u16) -> Option<String> {
    face.names()
        .into_iter()
        .find(|n| n.name_id == id && n.is_unicode())
        .and_then(|n| n.to_string())
}

/// Reads one face's metrics, one entry per named instance for a variable font. A face `ttf-parser` can't read
/// is left out.
fn read_face(info: &fontdb::FaceInfo, data: &[u8]) -> Option<(Vec<FontFace>, &'static str)> {
    let face = Font::parse(data, info.index).ok()?;
    let os2_bytes = os2_fields(&face);
    let (win_ascent, win_descent) = match os2_bytes {
        Some((_, ascent, descent)) => (ascent, descent),
        None => (
            face.ascender().max(0) as u16,
            face.descender().saturating_neg().max(0) as u16,
        ),
    };
    let typo_line_gap = face
        .tables()
        .os2
        .map_or_else(|| face.line_gap(), |os2| os2.typographic_line_gap());
    let fs_type = os2_bytes.map(|(fs, _, _)| fs);
    let generic = class_and_panose(&face).map_or("unknown", |(class, panose)| generic_class(class, panose));
    let base = FontFace {
        post_script_name: info.post_script_name.clone(),
        style: style_name(info.style),
        weight: info.weight.0,
        stretch: info.stretch.to_number() as u8,
        monospace: info.monospaced,
        embedding: embedding(&face),
        subsettable: fs_type.is_none_or(|fs| fs & 0x0100 == 0),
        bitmap_only: fs_type.is_some_and(|fs| fs & 0x0200 != 0),
        variable: face.is_variable(),
        instance: None,
        units_per_em: face.units_per_em(),
        win_ascent,
        win_descent,
        typo_line_gap,
        x_height: face.x_height(),
        cap_height: face.capital_height(),
    };
    let instances = if base.variable {
        named_instances(&face)
    } else {
        Vec::new()
    };
    if instances.is_empty() {
        return Some((vec![base], generic));
    }
    let prefix = base.post_script_name.split('-').next().unwrap_or_default().to_owned();
    let faces = instances
        .iter()
        .map(|i| {
            let name = name_of(&face, i.name_id);
            let post_script_name = i
                .ps_name_id
                .and_then(|id| name_of(&face, id))
                .unwrap_or_else(|| format!("{prefix}-{}", name.as_deref().unwrap_or("Instance").replace(' ', "")));
            FontFace {
                post_script_name,
                weight: i.weight.unwrap_or(base.weight),
                stretch: i.stretch.unwrap_or(base.stretch),
                instance: name,
                ..base.clone()
            }
        })
        .collect();
    Some((faces, generic))
}

type Read = Option<(Vec<FontFace>, &'static str)>;

/// Reads every face of the database on several threads, keeping the database's order.
fn read_all(db: &Database) -> Vec<(&fontdb::FaceInfo, Read)> {
    let infos: Vec<&fontdb::FaceInfo> = db.faces().collect();
    let threads = std::thread::available_parallelism().map_or(1, usize::from).clamp(1, 8);
    let chunk = infos.len().div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        let jobs: Vec<_> = infos
            .chunks(chunk)
            .map(|part| {
                scope.spawn(move || {
                    part.iter()
                        .map(|info| {
                            (
                                *info,
                                db.with_face_data(info.id, |data, _| read_face(info, data)).flatten(),
                            )
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        jobs.into_iter()
            .flat_map(|job| job.join().unwrap_or_default())
            .collect()
    })
}

/// The families of a database, sorted by name, with their faces sorted by weight and then style.
pub(crate) fn scan(db: &Database) -> Vec<FontFamily> {
    let mut families: Vec<FontFamily> = Vec::new();
    let mut by_name = HashMap::<String, usize>::new();
    for (info, read) in read_all(db) {
        let Some(name) = info.families.first().map(|(name, _)| name.clone()) else {
            continue;
        };
        let Some((read, generic)) = read else {
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
        for face in read {
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

/// Starts the first scan in the background, so the first `fonts_list` call finds the list ready or waits only for
/// what is left of the scan.
pub fn warm() {
    std::thread::spawn(|| {
        let _ = cached(false, scan_system);
    });
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
        win_descent: u16,
        /// Named instances of a variable font: name, `wght`, `wdth`.
        instances: Vec<(&'static str, f32, f32)>,
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
                win_descent: 300,
                instances: Vec::new(),
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
        u16s(&mut os2, &[800, (-200_i16) as u16, 90, 1100, spec.win_descent]);
        os2.resize(86, 0);
        // sxHeight, sCapHeight.
        u16s(&mut os2, &[500, 700]);
        os2.resize(96, 0);
        let mut post = vec![0, 3, 0, 0];
        post.resize(12, 0);
        post.extend_from_slice(&u32::from(spec.mono).to_be_bytes());
        post.resize(32, 0);
        let postscript = format!("{}-{}", spec.family.replace(' ', ""), spec.style.replace(' ', ""));
        let mut names = vec![
            (1_u16, spec.family.clone()),
            (2, spec.style.to_owned()),
            (6, postscript),
        ];
        for (i, (instance, _, _)) in spec.instances.iter().enumerate() {
            names.push((256 + i as u16, (*instance).to_owned()));
        }
        let mut name = Vec::new();
        u16s(&mut name, &[0, names.len() as u16, 6 + 12 * names.len() as u16]);
        let mut strings = Vec::new();
        for (id, text) in &names {
            let bytes = utf16(text);
            u16s(&mut name, &[3, 1, 0x409, *id, bytes.len() as u16, strings.len() as u16]);
            strings.extend(bytes);
        }
        name.extend(strings);
        // fvar: header, then the wght and wdth axes, then each instance (name id, flags, two coordinates).
        let fixed = |v: f32| ((v * 65536.0) as i32).to_be_bytes();
        let mut fvar = Vec::new();
        u16s(&mut fvar, &[1, 0, 16, 2, 2, 20, spec.instances.len() as u16, 12]);
        for tag in [b"wght", b"wdth"] {
            fvar.extend_from_slice(tag);
            fvar.extend_from_slice(&fixed(1.0));
            fvar.extend_from_slice(&fixed(1.0));
            fvar.extend_from_slice(&fixed(1000.0));
            u16s(&mut fvar, &[0, 2]);
        }
        for (i, (_, wght, wdth)) in spec.instances.iter().enumerate() {
            u16s(&mut fvar, &[256 + i as u16, 0]);
            fvar.extend_from_slice(&fixed(*wght));
            fvar.extend_from_slice(&fixed(*wdth));
        }
        let mut tables = vec![
            (*b"OS/2", os2),
            (*b"head", head),
            (*b"hhea", hhea),
            (*b"maxp", maxp),
            (*b"name", name),
            (*b"post", post),
        ];
        if !spec.instances.is_empty() {
            tables.push((*b"fvar", fvar));
        }
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

    /// What the first call does: read 1,000 font files from a folder, then scan them. The nightly job sets the
    /// variable and gates on the 150 ms budget of ADR 0080; any other run reports the time and checks only that
    /// it isn't absurd. The app starts this scan at launch, so a person waits only for what is left of it.
    #[test]
    fn a_thousand_font_files_load_and_list_quickly() {
        let specs: Vec<Spec> = (0..1000)
            .map(|i| Spec::new(&format!("Family {i:04}"), "Regular", 400))
            .collect();
        let dir = folder(&specs);
        let start = Instant::now();
        let mut db = Database::new();
        db.load_fonts_dir(dir.path());
        let loaded = start.elapsed();
        let list = scan(&db);
        let took = start.elapsed();
        assert_eq!(list.len(), 1000);
        eprintln!("fonts: 1000 files loaded in {loaded:?}, loaded and listed in {took:?}");
        let limit = if std::env::var_os("OPENNOTE_BENCH_GATE").is_some() {
            150
        } else {
            5000
        };
        assert!(took.as_millis() < limit, "{took:?} is over {limit} ms");
    }

    #[test]
    fn a_win_descent_above_32767_is_read_as_unsigned() {
        for descent in [32767_u16, 32768, 40000, 65535] {
            let spec = Spec {
                win_descent: descent,
                ..Spec::new("Deep", "Regular", 400)
            };
            let list = scan_dir(folder(&[spec]).path());
            assert_eq!(list[0].faces[0].win_descent, descent);
        }
    }

    #[test]
    fn fs_type_bits_for_subsetting_and_bitmaps_are_reported() {
        let cases = [
            (0_u16, true, false),
            (0x0100, false, false),
            (0x0200, true, true),
            (0x0300, false, true),
        ];
        for (fs_type, subsettable, bitmap_only) in cases {
            let spec = Spec {
                fs_type,
                ..Spec::new("Bits", "Regular", 400)
            };
            let list = scan_dir(folder(&[spec]).path());
            let face = &list[0].faces[0];
            assert_eq!(
                (face.subsettable, face.bitmap_only),
                (subsettable, bitmap_only),
                "fsType {fs_type:#x}"
            );
        }
    }

    #[test]
    fn a_variable_font_lists_one_face_per_named_instance() {
        let spec = Spec {
            instances: vec![
                ("Light", 300.0, 100.0),
                ("Regular", 400.0, 100.0),
                ("Bold", 700.0, 100.0),
                ("Bold Condensed", 700.0, 75.0),
            ],
            ..Spec::new("Flex", "Regular", 400)
        };
        let list = scan_dir(folder(&[spec]).path());
        let faces = &list[0].faces;
        let got: Vec<(u16, u8, Option<&str>)> = faces
            .iter()
            .map(|f| (f.weight, f.stretch, f.instance.as_deref()))
            .collect();
        assert_eq!(
            got,
            [
                (300, 5, Some("Light")),
                (400, 5, Some("Regular")),
                (700, 3, Some("Bold Condensed")),
                (700, 5, Some("Bold")),
            ]
        );
        assert!(faces.iter().all(|f| f.variable));
        assert_eq!(faces[3].post_script_name, "Flex-Bold");
    }

    #[test]
    fn a_static_font_is_not_variable() {
        let list = scan_dir(folder(&[Spec::new("Fixed", "Regular", 400)]).path());
        let face = &list[0].faces[0];
        assert!(!face.variable && face.instance.is_none());
    }

    #[test]
    fn no_font_name_reaches_a_diagnostics_bundle() {
        use opennote_crashreport::Scrubber;
        use opennote_diagnostics::{Bundle, BundleInputs, BundleOptions, SystemFacts};

        /// Keeps every log record, so the test can look for the font name in them.
        struct Capture(Mutex<Vec<String>>);
        impl log::Log for Capture {
            fn enabled(&self, _: &log::Metadata) -> bool {
                true
            }
            fn log(&self, record: &log::Record) {
                self.0
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push(record.args().to_string());
            }
            fn flush(&self) {}
        }
        static CAPTURE: Capture = Capture(Mutex::new(Vec::new()));
        log::set_logger(&CAPTURE).expect("no other test sets a logger");
        log::set_max_level(log::LevelFilter::Trace);

        let name = "Zzyzx Quillfeather";
        let dir = folder(&[Spec::new(name, "Regular", 400)]);
        // The cached list takes the same path as a `fonts_list` call, with the folder in place of the device.
        let list = cached(true, || scan_dir(dir.path()));
        assert_eq!(list[0].name, name, "the scan did find the font");
        let records = CAPTURE.0.lock().unwrap_or_else(PoisonError::into_inner).join(
            "
",
        );
        assert!(!records.contains("Quillfeather"), "a log record names a font");
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
