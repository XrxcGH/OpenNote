//! Synthetic files in the documented layouts of Goodnotes, Notability, and Samsung Notes, for the tests and the
//! fuzz seeds. None was made by the apps: each is built here from the structure ADR 0053 describes, so a real
//! export may differ, which is why the importers report what they cannot read instead of failing.

use super::bplist::write::{plist, Value};
use super::protobuf::write::{bytes_field, varint_field};
use crate::testing::{png_bytes, zip_bytes};

/// A JPEG's first bytes, enough for the signature.
pub const JPEG: &[u8] = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00synthetic";
/// An M4A recording's first bytes.
pub const M4A: &[u8] = b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00synthetic audio";
/// A PDF's first bytes.
pub const PDF: &[u8] = b"%PDF-1.4\n% synthetic\n%%EOF\n";

fn le_f32(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn le_i32(values: &[i32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn class(name: &str) -> Value {
    Value::Dict(vec![
        ("$classname".into(), Value::Str(name.into())),
        (
            "$classes".into(),
            Value::Array(vec![Value::Str(name.into()), Value::Str("NSObject".into())]),
        ),
    ])
}

/// A `Session.plist` with two curves and one text box:
///
/// - a black pen curve of 3 points, (72, 144), (90, 150), (108, 160), 2 points wide, with fractional widths
///   1.0, 1.2, 1.4;
/// - a yellow see-through highlighter curve of 2 points, (10, 20) and (200, 20), 12 points wide;
/// - the text "Krebs cycle".
pub fn session_plist() -> Vec<u8> {
    let objects = vec![
        Value::Str("$null".into()),
        // 1: the curves.
        Value::Dict(vec![
            (
                "curvespoints".into(),
                Value::Data(le_f32(&[
                    72.0, 144.0, 90.0, 150.0, 108.0, 160.0, 10.0, 20.0, 200.0, 20.0,
                ])),
            ),
            ("curvesnumpoints".into(), Value::Data(le_i32(&[3, 2]))),
            ("curveswidth".into(), Value::Data(le_f32(&[2.0, 12.0]))),
            ("curvescolors".into(), Value::Data(vec![0, 0, 0, 255, 255, 230, 0, 128])),
            (
                "curvesfractionalwidths".into(),
                Value::Data(le_f32(&[1.0, 1.2, 1.4, 1.0, 1.0])),
            ),
            ("$class".into(), Value::Uid(4)),
        ]),
        // 2: an attributed string, whose text is object 3.
        Value::Dict(vec![
            ("NS.string".into(), Value::Uid(3)),
            ("$class".into(), Value::Uid(5)),
        ]),
        Value::Str("Krebs cycle".into()),
        class("NBCurvesModel"),
        class("NSMutableAttributedString"),
        // 6: the root.
        Value::Dict(vec![
            ("curves".into(), Value::Uid(1)),
            ("richText".into(), Value::Uid(2)),
        ]),
    ];
    plist(&Value::Dict(vec![
        ("$archiver".into(), Value::Str("NSKeyedArchiver".into())),
        ("$version".into(), Value::Int(100_000)),
        ("$top".into(), Value::Dict(vec![("root".into(), Value::Uid(6))])),
        ("$objects".into(), Value::Array(objects)),
    ]))
}

/// A Notability note named "Biology": its session, a picture, a recording, an imported PDF, and a preview that is
/// not content.
pub fn notability_note() -> Vec<u8> {
    let session = session_plist();
    let png = png_bytes();
    zip_bytes(&[
        ("Biology/Session.plist", &session),
        ("Biology/Images/Image1.png", &png),
        ("Biology/Recordings/Recording1.m4a", M4A),
        ("Biology/PDFs/Handout.pdf", PDF),
        ("Biology/thumb.png", &png),
    ])
}

/// The page IDs of the Goodnotes fixture, in their index order.
pub const GOODNOTES_PAGES: [&str; 2] = [
    "B2C3D4E5-0000-4000-8000-000000000002",
    "A1B2C3D4-0000-4000-8000-000000000001",
];
/// The ID of the Goodnotes fixture's picture, which the second page in archive order names.
pub const GOODNOTES_PICTURE: &str = "IMG00001-0000-4000-8000-0000000000AA";

/// A Goodnotes document: two pages whose index lists them in the opposite of archive order, a picture the first
/// page of the index names, and a PDF no page names.
pub fn goodnotes_document() -> Vec<u8> {
    let mut index = Vec::new();
    for id in GOODNOTES_PAGES {
        let mut entry = Vec::new();
        bytes_field(&mut entry, 1, id.as_bytes());
        varint_field(&mut entry, 2, 1);
        bytes_field(&mut index, 1, &entry);
    }
    let mut first = Vec::new();
    bytes_field(&mut first, 3, GOODNOTES_PICTURE.as_bytes());
    let second = b"\x08\x01\x12\x04\xde\xad\xbe\xef".to_vec();
    let png = png_bytes();
    let first_name = format!("notes/{}", GOODNOTES_PAGES[0]);
    let second_name = format!("notes/{}", GOODNOTES_PAGES[1]);
    let picture = format!("attachments/{GOODNOTES_PICTURE}");
    zip_bytes(&[
        ("index.notes.pb", &index),
        ("index.attachments.pb", b"\x0a\x00"),
        ("index.bookmarks.pb", b"\x0a\x00"),
        (&second_name, &second),
        (&first_name, &first),
        (&picture, &png),
        ("attachments/PDF00001-0000-4000-8000-0000000000BB", PDF),
        ("thumbnails/thumb.jpg", JPEG),
    ])
}

/// A Samsung Notes note with two pages, listed in `pageIdInfo.dat` (UTF-16) as `page2` then `page1`, where
/// `page1` names `photo.jpg`, a recording no page names, and text kept as XML.
pub fn samsung_note() -> Vec<u8> {
    let info: Vec<u8> = "page2;page1".encode_utf16().flat_map(u16::to_le_bytes).collect();
    zip_bytes(&[
        ("pageIdInfo.dat", &info),
        ("page1.page", b"\x01\x02media/photo.jpg\x00\x03"),
        ("page2.page", b"\x01\x02\x00\x00"),
        ("media/photo.jpg", JPEG),
        ("media/voice.m4a", M4A),
        (
            "note.xml",
            b"<note><title>Field trip</title><body><p>Bring boots</p></body></note>",
        ),
        ("end_tag.bin", b"\x00"),
    ])
}

/// Bytes that do not compress, so that a fixture's large but harmless parts stay within the expansion a package
/// may have. A fixed linear congruential sequence, the same on every run.
pub fn noise(len: usize) -> Vec<u8> {
    let mut state: u32 = 0x1234_5678;
    (0..len)
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            state.to_le_bytes()[3]
        })
        .collect()
}

fn note_with_curves(holders: Vec<Value>, padding: usize) -> Vec<u8> {
    let mut objects = vec![Value::Str("$null".into())];
    objects.extend(holders);
    objects.push(Value::Data(noise(padding)));
    let session = plist(&Value::Dict(vec![
        ("$archiver".into(), Value::Str("NSKeyedArchiver".into())),
        ("$version".into(), Value::Int(100_000)),
        ("$top".into(), Value::Dict(vec![("root".into(), Value::Uid(1))])),
        ("$objects".into(), Value::Array(objects)),
    ]));
    zip_bytes(&[("Flood/Session.plist", &session)])
}

/// A hostile note whose one curve list holds `curves` curves of no points, with no point data at all.
pub fn notability_zero_count_flood(curves: usize) -> Vec<u8> {
    let holder = Value::Dict(vec![
        ("curvespoints".into(), Value::Data(Vec::new())),
        ("curvesnumpoints".into(), Value::Data(vec![0; curves * 4])),
    ]);
    note_with_curves(vec![holder], curves / 50)
}

/// A hostile note with `holders` curve lists that all point at the same point data: `points` points at (1, 2),
/// in curves of `per_curve` points each.
pub fn notability_shared_blob(holders: usize, points: usize, per_curve: usize) -> Vec<u8> {
    let count = i32::try_from(per_curve).unwrap_or(i32::MAX);
    let data = u64::try_from(holders).unwrap_or(u64::MAX) + 1;
    let mut objects: Vec<Value> = (0..holders)
        .map(|_| {
            Value::Dict(vec![
                ("curvespoints".into(), Value::Uid(data)),
                ("curvesnumpoints".into(), Value::Uid(data + 1)),
            ])
        })
        .collect();
    objects.push(Value::Data(le_f32(&[1.0, 2.0]).repeat(points)));
    objects.push(Value::Data(le_i32(&[count]).repeat(points / per_curve)));
    note_with_curves(objects, points / 20)
}
