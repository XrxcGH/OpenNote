//! A Word file for a selection (Phase 6, "Export a selection"). The interface draws the selection as a picture, with
//! everything it holds: text, tables, ink, and the cropped part of an annotated image. This command puts that picture
//! in a `.docx` through the interop crate's writer, with the selection's text as the picture's description, so a
//! screen reader and Word's alt text both have it.
//!
//! The picture comes as the request body and its facts as a percent-encoded JSON header, as `export_write` does, so the
//! bytes never become base64 text. The file's bytes go back the same way. The interface saves them through the Save
//! dialog and `export_write`, so this command never names a path.

use std::collections::HashMap;

use opennote_core::Timestamp;
use opennote_interop::{
    doc::{Block, Inline},
    docx::{self, Media, Part, WordInput},
};
use serde::Deserialize;
use tauri::ipc::{InvokeBody, Response};

use crate::{
    images::import::percent_decode,
    ipc::{IpcError, IpcResult},
};

/// The largest picture the command takes: a PNG over 100 MB would not open in Word comfortably anyway.
const MAX_PICTURE: usize = 100 * 1024 * 1024;
/// The sides of the picture, in pixels, that Word is asked to hold.
const MAX_SIDE: u32 = 20_000;
const MAX_TEXT: usize = 20_000;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// What the interface says about the picture.
#[derive(Debug, Deserialize)]
struct Facts {
    title: String,
    /// The text of the selection, for the picture's description.
    alt: String,
    width: u32,
    height: u32,
}

/// The document for a PNG and its facts: a title line, then the picture alone.
fn build_document(png: &[u8], facts: &Facts, when: Timestamp) -> IpcResult<Vec<u8>> {
    if png.len() > MAX_PICTURE || !png.starts_with(&PNG_SIGNATURE) {
        return Err(IpcError::invalid("body", "The picture isn't a PNG."));
    }
    let sides = 1..=MAX_SIDE;
    if !sides.contains(&facts.width) || !sides.contains(&facts.height) {
        return Err(IpcError::invalid("size", "The picture's size is out of range."));
    }
    let clip = |text: &str| text.chars().take(MAX_TEXT).collect::<String>();
    let picture = Inline::Image {
        dest: "selection".to_owned(),
        alt: clip(&facts.alt),
    };
    let mut media = HashMap::new();
    media.insert(
        "selection".to_owned(),
        Media {
            bytes: png.to_vec(),
            ext: "png".to_owned(),
            width: facts.width,
            height: facts.height,
        },
    );
    let input = WordInput {
        title: clip(&facts.title),
        created: when,
        modified: when,
        parts: vec![Part::Blocks(vec![Block::Paragraph(vec![picture])])],
        media,
    };
    docx::build(&input).map_err(|error| IpcError::new("export", error.to_string()))
}

/// Makes a `.docx` that holds the selection's picture. The body is the PNG, and the `x-opennote-docx` header (percent-
/// encoded JSON) holds the title, the description, and the picture's size in pixels.
#[tauri::command]
pub async fn export_selection_docx(request: tauri::ipc::Request<'_>) -> IpcResult<Response> {
    let header = request
        .headers()
        .get("x-opennote-docx")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| IpcError::invalid("x-opennote-docx", "The Word header is missing."))?;
    let facts: Facts = serde_json::from_str(&percent_decode(header))
        .map_err(|_| IpcError::invalid("x-opennote-docx", "The Word header isn't valid JSON."))?;
    let png = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err(IpcError::invalid("body", "The picture must come as raw bytes.")),
    };
    let when = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| Timestamp::from_unix_ms(i64::try_from(elapsed.as_millis()).unwrap_or(0)))
        .unwrap_or_default();
    let bytes = tauri::async_runtime::spawn_blocking(move || build_document(&png, &facts, when))
        .await
        .map_err(|error| IpcError::new("internal", error.to_string()))??;
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use opennote_interop::archive::{ArchiveLimits, ZipArchive};

    /// The smallest PNG signature plus junk: enough for the signature check, since the writer stores the bytes as given.
    fn png() -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(b"not really an image");
        bytes
    }

    fn facts(width: u32, height: u32) -> Facts {
        Facts {
            title: "Notes".to_owned(),
            alt: "A sketch of a <graph> & axes".to_owned(),
            width,
            height,
        }
    }

    #[test]
    fn the_document_holds_the_picture_with_its_description() {
        let bytes = build_document(&png(), &facts(640, 480), Timestamp::from_unix_ms(1_000)).unwrap();
        let mut zip = ZipArchive::new(std::io::Cursor::new(bytes), ArchiveLimits::default()).unwrap();
        let names: Vec<String> = zip.entries().iter().map(|entry| entry.name.clone()).collect();
        assert!(names.iter().any(|name| name == "word/document.xml"), "{names:?}");
        assert!(names.iter().any(|name| name.starts_with("word/media/")), "{names:?}");
        let xml = String::from_utf8_lossy(&zip.read_named("word/document.xml").unwrap()).into_owned();
        assert!(xml.contains("&lt;graph&gt; &amp; axes"), "{xml}");
        assert!(xml.contains("<wp:extent"));
    }

    #[test]
    fn a_picture_that_is_not_a_png_is_refused() {
        assert!(build_document(b"GIF89a", &facts(10, 10), Timestamp::default()).is_err());
        assert!(build_document(&[], &facts(10, 10), Timestamp::default()).is_err());
    }

    #[test]
    fn a_size_out_of_range_is_refused() {
        for (w, h) in [(0, 10), (10, 0), (MAX_SIDE + 1, 10)] {
            assert!(
                build_document(&png(), &facts(w, h), Timestamp::default()).is_err(),
                "{w}x{h}"
            );
        }
    }
}
