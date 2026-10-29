#![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

use std::time::Duration;

use opennote_core::format::points::decode_points;
use opennote_core::model::{stroke::tool, BlockData, Page};
use proptest::prelude::*;

use super::bplist::write::{plist, Value};
use super::bplist::{Obj, Plist};
use super::container::{safe_name, Package, PackageLimits};
use super::ink::{strokes, Curve};
use super::keyed::Keyed;
use super::protobuf::{self, write::bytes_field};
use super::*;
use crate::report::Outcome;
use crate::sink::MemorySink;
use crate::testing::{png_bytes, zip_bytes, TestEnv};

fn import_bytes(name: &str, bytes: &[u8]) -> (MemorySink, Report) {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(name);
    std::fs::write(&file, bytes).unwrap();
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_notes_apps(&file, &world.env(), &mut sink).unwrap();
    (sink, report)
}

fn pages(sink: &MemorySink) -> Vec<&Page> {
    sink.pages.iter().map(|(_, p)| &p.page).collect()
}

fn entries(report: &Report, outcome: Outcome) -> Vec<String> {
    report
        .pages
        .iter()
        .chain(std::iter::once(&report.general))
        .flat_map(|p| p.entries.iter())
        .filter(|e| e.outcome == outcome)
        .map(|e| e.what.clone())
        .collect()
}

fn texts(page: &Page) -> Vec<String> {
    page.blocks
        .iter()
        .filter_map(|b| match &b.data {
            BlockData::Text(t) => Some(t.markdown.to_string()),
            _ => None,
        })
        .collect()
}

fn asset_mimes(page: &Page) -> Vec<String> {
    let mut mimes: Vec<String> = page.assets.values().map(|a| a.mime.clone()).collect();
    mimes.sort();
    mimes
}

// Binary property lists.

#[test]
fn a_written_property_list_reads_back_with_its_values() {
    let bytes = plist(&Value::Dict(vec![
        ("n".into(), Value::Int(-7)),
        ("r".into(), Value::Real(2.5)),
        ("a".into(), Value::Str("plain".into())),
        ("u".into(), Value::Str("Größe".into())),
        ("Maß".into(), Value::Int(4)),
        ("d".into(), Value::Data(vec![1, 2, 3])),
        ("id".into(), Value::Uid(9)),
        ("list".into(), Value::Array(vec![Value::Bool(true), Value::Int(300)])),
    ]));
    let list = Plist::parse(&bytes).unwrap();
    let top = list.top();
    assert_eq!(list.get(list.dict_get(top, "n").unwrap()), Some(&Obj::Int(-7)));
    // A key outside ASCII is written as UTF-16 and found only by its whole text.
    assert_eq!(list.get(list.dict_get(top, "Maß").unwrap()), Some(&Obj::Int(4)));
    assert_eq!(list.dict_get(top, "Ma"), None);
    assert_eq!(list.dict_get(top, "Maße"), None);
    assert_eq!(list.get(list.dict_get(top, "r").unwrap()), Some(&Obj::Real(2.5)));
    assert_eq!(list.string(list.dict_get(top, "a").unwrap()).as_deref(), Some("plain"));
    assert_eq!(list.string(list.dict_get(top, "u").unwrap()).as_deref(), Some("Größe"));
    assert_eq!(list.data(list.dict_get(top, "d").unwrap()), Some(&[1u8, 2, 3][..]));
    assert_eq!(list.get(list.dict_get(top, "id").unwrap()), Some(&Obj::Uid(9)));
    let Some(Obj::Array(items)) = list.get(list.dict_get(top, "list").unwrap()) else {
        panic!("an array");
    };
    assert_eq!(list.get(items[0]), Some(&Obj::Bool(true)));
    assert_eq!(list.get(items[1]), Some(&Obj::Int(300)));
}

#[test]
fn damaged_property_lists_are_refused_without_a_panic() {
    let good = plist(&Value::Array(vec![Value::Str("x".into())]));
    assert!(Plist::parse(b"not a plist at all, but long enough to have a trailer").is_err());
    assert!(Plist::parse(&good[..good.len() - 1]).is_err());
    // An object count far past the file.
    let mut huge = good.clone();
    let at = huge.len() - 24;
    huge[at..at + 8].copy_from_slice(&u64::MAX.to_be_bytes());
    assert!(Plist::parse(&huge).is_err());
    // A reference to an object that does not exist.
    let mut stray = good.clone();
    stray[9..13].copy_from_slice(&99u32.to_be_bytes());
    assert!(Plist::parse(&stray).is_err());
}

#[test]
fn an_array_that_holds_itself_is_read_once_and_a_uid_loop_ends() {
    // Object 0 is an array whose only member is object 0.
    let mut bytes = b"bplist00".to_vec();
    bytes.extend_from_slice(&[0xA1, 0x00]);
    let table = bytes.len() as u64;
    bytes.push(8);
    bytes.extend_from_slice(&[0, 0, 0, 0, 0, 0, 1, 1]);
    bytes.extend_from_slice(&1u64.to_be_bytes());
    bytes.extend_from_slice(&0u64.to_be_bytes());
    bytes.extend_from_slice(&table.to_be_bytes());
    let list = Plist::parse(&bytes).unwrap();
    assert_eq!(list.get(0), Some(&Obj::Array(vec![0])));

    let looped = plist(&Value::Dict(vec![(
        "$objects".into(),
        Value::Array(vec![Value::Uid(1), Value::Uid(0)]),
    )]));
    let list = Plist::parse(&looped).unwrap();
    let archive = Keyed::new(&list).unwrap();
    assert_eq!(archive.resolve(archive.objects()[0]), usize::MAX);
}

#[test]
fn a_search_walks_a_dictionary_the_archive_repeats_only_once() {
    let bytes = fixtures::session_one_dict_many_times(100_000, 100_000);
    let list = Plist::parse(&bytes).unwrap();
    let archive = Keyed::new(&list).unwrap();
    assert_eq!(archive.objects().len(), 100_000);
    assert_eq!(archive.distinct(), &[2]);
    let checks = std::cell::Cell::new(0);
    let count = || {
        checks.set(checks.get() + 1);
        Ok(())
    };
    let started = std::time::Instant::now();
    // Walking every reference would be 100,000 x 100,000 key compares; once each, it is 100,000.
    assert!(archive.dicts_with("curvespoints", &count).unwrap().is_empty());
    assert_eq!(archive.dicts_with("curvespointX", &count).unwrap(), vec![2]);
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "took {:?}",
        started.elapsed()
    );
    assert_eq!(checks.get(), 2);
}

#[test]
fn a_search_stops_when_cancel_is_pressed() {
    let bytes = fixtures::session_one_dict_many_times(10, 10);
    let list = Plist::parse(&bytes).unwrap();
    let archive = Keyed::new(&list).unwrap();
    let canceled = || Err(crate::error::InteropError::Canceled);
    assert!(matches!(
        archive.dicts_with("curvespointX", &canceled),
        Err(crate::error::InteropError::Canceled)
    ));
}

// Protobuf.

#[test]
fn protobuf_text_comes_out_in_order_from_nested_messages() {
    let mut inner = Vec::new();
    bytes_field(&mut inner, 1, b"second");
    let mut outer = Vec::new();
    bytes_field(&mut outer, 1, b"first");
    bytes_field(&mut outer, 2, &inner);
    bytes_field(&mut outer, 3, b"third");
    assert_eq!(protobuf::strings(&outer, 10), ["first", "second", "third"]);
    assert_eq!(protobuf::strings(&outer, 2), ["first", "second"]);
    // A length past the end is not a message.
    assert!(protobuf::fields(b"\x0a\x7fshort").is_none());
    assert!(protobuf::fields(b"\x0b").is_none());
}

// Ink.

#[test]
fn curves_become_strokes_in_page_units_with_pressure_and_highlighters() {
    let world = TestEnv::new();
    let env = world.env();
    let curves = [
        Curve {
            points: vec![(72.0, 144.0), (73.5, 144.0)],
            pressure: Some(vec![0.5, 1.0]),
            width: 3.0,
            color: [10, 20, 30, 255],
        },
        Curve {
            points: vec![(0.0, 0.0)],
            pressure: None,
            width: 12.0,
            color: [255, 255, 0, 100],
        },
        Curve {
            points: vec![(f32::NAN, 1.0), (f32::INFINITY, 2.0)],
            pressure: None,
            width: 1.0,
            color: [0, 0, 0, 255],
        },
    ];
    let block = opennote_core::BlockId::generate(env.clock);
    let (made, stats) = strokes(&curves, block, env.clock.now(), &env);
    assert_eq!((stats.strokes, stats.highlighter, stats.dropped), (2, 1, 1));
    let pen = &made[0];
    // 72 points are 96 page units, which are 6144 sixty-fourths; 1.5 points are 2 units, 128 sixty-fourths.
    let points = decode_points(&pen.points, pen.point_count, pen.channels).unwrap();
    assert_eq!((points[0].x, points[0].y, points[1].x), (6_144, 12_288, 6_272));
    assert_eq!((points[0].pressure, points[1].pressure), (32_768, 65_535));
    assert_eq!(pen.style.tool, tool::PEN);
    assert_eq!(pen.style.color, [10, 20, 30, 255]);
    assert!((pen.style.width - 4.0).abs() < 1e-6);
    assert_eq!(made[1].style.tool, tool::HIGHLIGHTER);
    assert!(made[1].start > pen.start, "strokes keep the app's order");
}

#[test]
fn a_curve_longer_than_a_stroke_may_be_goes_in_joined_pieces() {
    let world = TestEnv::new();
    let env = world.env();
    let long = Curve {
        points: (0..250_000).map(|n| ((n % 500) as f32, (n / 500) as f32)).collect(),
        pressure: None,
        width: 1.0,
        color: [0, 0, 0, 255],
    };
    let block = opennote_core::BlockId::generate(env.clock);
    let (made, stats) = strokes(&[long], block, env.clock.now(), &env);
    assert_eq!(stats.strokes, 2);
    assert_eq!(
        made[0].point_count + made[1].point_count,
        250_001,
        "the pieces share one point"
    );
}

// Notability.

#[test]
fn a_synthetic_notability_note_brings_its_strokes_text_picture_recording_and_pdf() {
    let (sink, report) = import_bytes("Biology.note", &fixtures::notability_note());
    let pages = pages(&sink);
    assert_eq!(pages.len(), 1);
    let page = pages[0];
    assert_eq!(page.title, "Biology");
    assert_eq!(page.ink.len(), 2);
    let mut strokes: Vec<_> = page.ink.strokes().cloned().collect();
    strokes.sort_by_key(|s| s.start);
    assert_eq!(strokes[0].point_count, 3);
    assert_eq!(strokes[0].style.color, [0, 0, 0, 255]);
    assert!((strokes[0].style.width - 8.0 / 3.0).abs() < 1e-5);
    assert_eq!(strokes[1].style.tool, tool::HIGHLIGHTER);
    assert_eq!(strokes[1].style.color, [255, 230, 0, 255]);
    let points = decode_points(&strokes[0].points, 3, strokes[0].channels).unwrap();
    assert_eq!((points[0].x, points[0].y), (6_144, 12_288));
    // A fractional width of 1.2 is pressure 0.6.
    assert_eq!(points[1].pressure, 39_321);
    let layer = page
        .blocks
        .iter()
        .find(|b| matches!(b.data, BlockData::Ink(_)))
        .expect("a handwriting layer");
    assert_eq!(strokes[0].block, layer.id);
    assert_eq!(texts(page), ["Krebs cycle"]);
    assert_eq!(asset_mimes(page), ["application/pdf", "audio/mp4", "image/png"]);
    let came = entries(&report, Outcome::CameOver);
    assert!(came.contains(&"1 pen stroke".to_owned()), "{came:?}");
    assert!(came.contains(&"1 highlighter stroke".to_owned()), "{came:?}");
    let simplified = entries(&report, Outcome::Simplified);
    assert!(simplified.contains(&"1 audio recording".to_owned()), "{simplified:?}");
    assert!(simplified.contains(&"1 PDF background".to_owned()), "{simplified:?}");
}

#[test]
fn a_synthetic_notability_note_without_a_readable_session_still_brings_its_files() {
    let png = png_bytes();
    let bytes = zip_bytes(&[("Lab/Session.plist", b"bplist00 damaged"), ("Lab/Images/a.png", &png)]);
    let (sink, report) = import_bytes("Lab.note", &bytes);
    let pages = pages(&sink);
    assert_eq!(pages.len(), 1);
    assert_eq!(asset_mimes(pages[0]), ["image/png"]);
    assert!(entries(&report, Outcome::Skipped).contains(&"handwriting and typed text".to_owned()));
}

#[test]
fn notability_curve_lists_whose_sizes_disagree_keep_the_curves_that_fit() {
    let session = plist(&Value::Dict(vec![(
        "$objects".into(),
        Value::Array(vec![
            Value::Str("$null".into()),
            Value::Dict(vec![
                (
                    "curvespoints".into(),
                    Value::Data([1f32, 2.0, 3.0, 4.0].iter().flat_map(|v| v.to_le_bytes()).collect()),
                ),
                (
                    "curvesnumpoints".into(),
                    Value::Data([1i32, 5].iter().flat_map(|v| v.to_le_bytes()).collect()),
                ),
            ]),
        ]),
    )]));
    let (sink, report) = import_bytes("Odd.note", &zip_bytes(&[("Odd/Session.plist", &session)]));
    assert_eq!(pages(&sink)[0].ink.len(), 1);
    assert!(entries(&report, Outcome::Skipped).contains(&"1 damaged curve lists".to_owned()));
}

// Goodnotes.

#[test]
fn a_synthetic_goodnotes_document_keeps_its_page_order_and_attachments() {
    let (sink, report) = import_bytes("Physics.goodnotes", &fixtures::goodnotes_document());
    let pages = pages(&sink);
    assert_eq!(
        pages.iter().map(|p| p.title.as_str()).collect::<Vec<_>>(),
        ["Page 1", "Page 2"]
    );
    // The index lists the page that names the picture first, so the picture lands on page 1, with the PDF that
    // no page names.
    assert_eq!(asset_mimes(pages[0]), ["application/pdf", "image/png"]);
    assert!(pages[1].assets.is_empty());
    let skipped = entries(&report, Outcome::Skipped);
    assert_eq!(skipped.iter().filter(|w| *w == "handwriting and typed text").count(), 2);
    assert!(skipped.contains(&"bookmarks and outline".to_owned()));
    let why = report.pages[0]
        .entries
        .iter()
        .find(|e| e.outcome == Outcome::Skipped)
        .unwrap();
    assert!(why
        .why
        .as_deref()
        .unwrap()
        .contains("export the notebook as a PDF in Goodnotes"));
}

#[test]
fn a_package_with_nothing_goodnotes_keeps_is_refused_with_the_pdf_route() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("Empty.goodnotes");
    std::fs::write(&file, zip_bytes(&[("readme.txt", b"hi")])).unwrap();
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_notes_apps(&file, &world.env(), &mut sink).unwrap();
    let why = report.general.entries[0].why.clone().unwrap();
    assert!(why.contains("export the notebook as a PDF"), "{why}");
    assert!(sink.pages.is_empty());
}

// Samsung Notes.

#[test]
fn a_synthetic_samsung_note_keeps_page_order_media_and_xml_text() {
    let (sink, report) = import_bytes("Trip.sdocx", &fixtures::samsung_note());
    let pages = pages(&sink);
    assert_eq!(pages.len(), 2);
    // pageIdInfo.dat lists page2 first; page1 names the photo; the recording no page names goes on page 1.
    assert_eq!(texts(pages[0]), ["Field trip\n\nBring boots"]);
    assert_eq!(asset_mimes(pages[0]), ["audio/mp4"]);
    assert_eq!(asset_mimes(pages[1]), ["image/jpeg"]);
    assert_eq!(
        entries(&report, Outcome::Skipped)
            .iter()
            .filter(|w| *w == "handwriting and shapes")
            .count(),
        2
    );
}

// Hostile packages.

#[test]
fn names_that_leave_the_package_are_refused() {
    assert!(safe_name("notes/a"));
    for bad in ["../a", "a/../../b", "/etc/passwd", "C:/x", "a\\..\\b", "", "a\0b"] {
        assert!(!safe_name(bad), "{bad:?}");
    }
}

#[test]
fn a_zip_bomb_and_an_escaping_name_are_left_out_while_the_rest_imports() {
    let zeros = vec![0u8; 8 << 20];
    let png = png_bytes();
    let bytes = zip_bytes(&[
        ("media/bomb.jpg", &zeros),
        ("../escape.jpg", fixtures::JPEG),
        ("media/ok.png", &png),
    ]);
    let (sink, report) = import_bytes("Bomb.sdocx", &bytes);
    assert_eq!(asset_mimes(pages(&sink)[0]), ["image/png"]);
    let skipped = entries(&report, Outcome::Skipped);
    assert!(skipped.contains(&"media/bomb.jpg".to_owned()), "{skipped:?}");
    assert!(skipped.contains(&"../escape.jpg".to_owned()), "{skipped:?}");
}

#[test]
fn reading_stops_when_the_time_budget_is_spent() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.note");
    std::fs::write(&file, fixtures::notability_note()).unwrap();
    let limits = PackageLimits {
        budget: Duration::ZERO,
        ..PackageLimits::default()
    };
    let mut package = Package::open_with(&file, limits).unwrap();
    std::thread::sleep(Duration::from_millis(2));
    let member = package.members[0].clone();
    assert!(matches!(
        package.read(&member),
        Err(crate::error::InteropError::TooBig(_))
    ));
}

#[test]
fn a_file_that_is_not_a_package_says_what_it_is() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("Plain.note");
    std::fs::write(&file, b"just text").unwrap();
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_notes_apps(&file, &world.env(), &mut sink).unwrap();
    assert!(report.general.entries[0]
        .why
        .as_deref()
        .unwrap()
        .contains("not a ZIP package"));
}

#[test]
fn a_folder_of_notes_files_keeps_its_folders_as_section_names() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("Backup");
    std::fs::create_dir_all(root.join("School")).unwrap();
    std::fs::write(
        root.join("School").join("Physics.goodnotes"),
        fixtures::goodnotes_document(),
    )
    .unwrap();
    std::fs::write(root.join("Biology.note"), fixtures::notability_note()).unwrap();
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    import_notes_apps(&root, &world.env(), &mut sink).unwrap();
    let mut names: Vec<String> = sink.sections.iter().map(|s| s.title.clone()).collect();
    names.sort();
    assert_eq!(names, ["Biology", "School / Physics"]);
    assert_eq!(sink.pages.len(), 3);
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, failure_persistence: None, ..ProptestConfig::default() })]

    #[test]
    fn any_bytes_after_a_plist_header_parse_or_fail_without_a_panic(tail in proptest::collection::vec(any::<u8>(), 0..600)) {
        let mut bytes = b"bplist00".to_vec();
        bytes.extend_from_slice(&tail);
        if let Ok(list) = Plist::parse(&bytes) {
            if let Some(archive) = Keyed::new(&list) {
                for object in archive.distinct() {
                    let _ = archive.string(*object);
                    let _ = archive.array(*object);
                    let _ = archive.class_name(*object);
                }
            }
        }
    }

    #[test]
    fn any_bytes_walk_as_protobuf_without_a_panic(bytes in proptest::collection::vec(any::<u8>(), 0..600)) {
        let _ = protobuf::fields(&bytes);
        let found = protobuf::strings(&bytes, 50);
        prop_assert!(found.len() <= 50);
    }

    #[test]
    fn any_curve_converts_without_a_panic(
        points in proptest::collection::vec((any::<f32>(), any::<f32>()), 0..40),
        width in any::<f32>(),
        alpha in any::<u8>(),
    ) {
        let world = TestEnv::new();
        let env = world.env();
        let curve = Curve { points, pressure: None, width, color: [0, 0, 0, alpha] };
        let block = opennote_core::BlockId::generate(env.clock);
        let (made, stats) = strokes(&[curve], block, env.clock.now(), &env);
        prop_assert_eq!(made.len(), stats.strokes);
        for stroke in made {
            prop_assert!(stroke.style.width.is_finite() && stroke.style.width > 0.0);
        }
    }
}

// Hostile curve lists and page indexes, and what they cost.

#[test]
fn a_flood_of_empty_curves_is_counted_as_left_out_without_keeping_one() {
    let curves = 300_000;
    let (sink, report) = import_bytes("Flood.note", &fixtures::notability_zero_count_flood(curves));
    assert!(pages(&sink)[0].ink.is_empty());
    let skipped = entries(&report, Outcome::Skipped);
    assert!(skipped.contains(&"300000 strokes".to_owned()), "{skipped:?}");
}

#[test]
fn curve_lists_that_share_their_points_stop_at_the_page_limits() {
    // 64 lists each name the same 1,000,000 points, in curves of 1,000. The first two lists fill the page's
    // 2,000,000 points; lists 3 to 16 are read and their 1,000 curves each left out; lists 17 to 64 are not read.
    let note = fixtures::notability_shared_blob(64, 1_000_000, 1_000);
    let (sink, report) = import_bytes("Shared.note", &note);
    assert_eq!(pages(&sink)[0].ink.len(), 2_000);
    let skipped = entries(&report, Outcome::Skipped);
    assert!(skipped.contains(&"14000 strokes".to_owned()), "{skipped:?}");
    assert!(skipped.contains(&"48 extra curve lists".to_owned()), "{skipped:?}");
    assert!(entries(&report, Outcome::CameOver).contains(&"2000 pen strokes".to_owned()));
}

#[test]
fn reading_curves_stops_when_cancel_is_pressed() {
    let (bytes, _) = {
        let note = fixtures::notability_zero_count_flood(10);
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.note");
        std::fs::write(&file, &note).unwrap();
        let mut package = Package::open(&file).unwrap();
        let member = package.members[0].clone();
        (package.read(&member).unwrap().unwrap(), dir)
    };
    let plist = Plist::parse(&bytes).unwrap();
    let archive = Keyed::new(&plist).unwrap();
    let holder = archive.dicts_with("curvespoints", &|| Ok(())).unwrap()[0];
    let mut read = notability::CurveRead::default();
    let canceled = || Err(crate::error::InteropError::Canceled);
    assert!(matches!(
        notability::read_curves(&archive, holder, &mut read, &canceled),
        Err(crate::error::InteropError::Canceled)
    ));
    assert_eq!(read.dropped, 0);
}

#[test]
fn a_pen_a_little_see_through_stays_a_pen_and_keeps_its_alpha() {
    let world = TestEnv::new();
    let env = world.env();
    let curve = |alpha: u8, width: f32| Curve {
        points: vec![(1.0, 1.0)],
        pressure: None,
        width,
        color: [10, 20, 30, alpha],
    };
    let curves = [curve(250, 2.0), curve(230, 12.0), curve(200, 1.0), curve(255, 20.0)];
    let block = opennote_core::BlockId::generate(env.clock);
    let (made, stats) = strokes(&curves, block, env.clock.now(), &env);
    assert_eq!(stats.highlighter, 2);
    let tools: Vec<(u8, u8)> = made.iter().map(|s| (s.style.tool, s.style.color[3])).collect();
    assert_eq!(
        tools,
        [
            (tool::PEN, 250),
            (tool::HIGHLIGHTER, 255),
            (tool::HIGHLIGHTER, 255),
            (tool::PEN, 255)
        ]
    );
}

fn ordered(note: &[u8], env: &crate::sink::ImportEnv<'_>) -> (Vec<String>, PageReport) {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.sdocx");
    std::fs::write(&file, note).unwrap();
    let mut package = Package::open(&file).unwrap();
    let mut pages: Vec<_> = package
        .members
        .iter()
        .filter(|m| m.extension() == "page")
        .cloned()
        .collect();
    let mut report = PageReport::default();
    samsung::order_pages(&mut package, &mut pages, env, &mut report).unwrap();
    let ids = pages
        .iter()
        .map(|p| p.file_name().trim_end_matches(".page").to_owned())
        .collect();
    (ids, report)
}

#[test]
fn many_pages_are_ordered_from_a_large_page_index_in_one_pass() {
    let world = TestEnv::new();
    let note = fixtures::samsung_many_pages(2_000, 3 << 20);
    let started = std::time::Instant::now();
    let (ids, report) = ordered(&note, &world.env());
    let took = started.elapsed();
    assert_eq!(ids, fixtures::samsung_many_page_ids(2_000));
    assert!(report.entries.is_empty());
    assert!(took < Duration::from_secs(5), "took {took:?}");
}

#[test]
fn a_page_index_larger_than_any_note_keeps_leaves_the_package_order() {
    let world = TestEnv::new();
    let note = fixtures::samsung_many_pages(3, 5 << 20);
    let (ids, report) = ordered(&note, &world.env());
    assert_eq!(ids, ["p00000", "p00001", "p00002"]);
    assert_eq!(report.entries[0].what, "page order");
}

#[test]
fn a_page_id_inside_a_longer_one_is_not_taken_for_it() {
    let world = TestEnv::new();
    let info: Vec<u8> = "page10;page1".encode_utf16().flat_map(u16::to_le_bytes).collect();
    let note = zip_bytes(&[
        ("pageIdInfo.dat", &info),
        ("page1.page", b"\x01"),
        ("page10.page", b"\x01"),
    ]);
    let (ids, _) = ordered(&note, &world.env());
    assert_eq!(ids, ["page10", "page1"]);
}

fn why_of(report: &Report, what: &str) -> Vec<String> {
    report
        .pages
        .iter()
        .chain(std::iter::once(&report.general))
        .flat_map(|p| p.entries.iter())
        .filter(|e| e.what == what)
        .map(|e| e.why.clone().unwrap_or_default())
        .collect()
}

#[test]
fn a_notability_session_left_out_by_the_limits_is_named_as_left_out_not_missing() {
    let png = png_bytes();
    // 8 MiB of zeros packs to a few KiB, far past the 200-fold expansion a real entry stays under.
    let zeros = vec![0u8; 8 << 20];
    for (name, reason) in [
        ("Big/Session.plist", "it expands far more"),
        ("../Session.plist", "its name points outside"),
    ] {
        let bytes = zip_bytes(&[(name, &zeros), ("Big/Images/a.png", &png)]);
        let (sink, report) = import_bytes("Big.note", &bytes);
        assert_eq!(asset_mimes(pages(&sink)[0]), ["image/png"]);
        let whys = why_of(&report, "handwriting and typed text");
        assert_eq!(whys.len(), 1, "{whys:?}");
        assert!(
            whys[0].starts_with(&format!(
                "Session.plist, which holds the handwriting and typed text, was left out ({reason}"
            )),
            "{whys:?}"
        );
        assert!(!whys[0].contains("has no Session.plist"), "{whys:?}");
        assert!(whys[0].contains("Share, then PDF"), "{whys:?}");
        // The refusal is said once, on the page, not again as a separate entry for the file.
        assert!(why_of(&report, name).is_empty(), "{:?}", report.general);
    }
}

#[test]
fn a_notability_note_with_no_session_says_it_has_none() {
    let png = png_bytes();
    let (_, report) = import_bytes("Bare.note", &zip_bytes(&[("Bare/Images/a.png", &png)]));
    let whys = why_of(&report, "handwriting and typed text");
    assert_eq!(whys.len(), 1, "{whys:?}");
    assert!(whys[0].starts_with("The note has no Session.plist"), "{whys:?}");
}
