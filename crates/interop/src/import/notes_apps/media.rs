//! Telling pictures, PDF files, and recordings apart by their first bytes, since Goodnotes keeps its attachments
//! without extensions. The signatures are the published magic numbers of each format.

/// What a file is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Media {
    /// A picture, with its MIME type and an extension for its name.
    Image(&'static str, &'static str),
    /// A PDF document.
    Pdf,
    /// A sound recording, with its MIME type and an extension.
    Audio(&'static str, &'static str),
    /// Anything else.
    Other,
}

/// What the bytes are, from their signature, or else from the extension.
pub fn sniff(bytes: &[u8], extension: &str) -> Media {
    let at = |offset: usize, magic: &[u8]| bytes.get(offset..offset + magic.len()) == Some(magic);
    if at(0, b"\x89PNG\r\n\x1a\n") {
        return Media::Image("image/png", "png");
    }
    if at(0, b"\xff\xd8\xff") {
        return Media::Image("image/jpeg", "jpg");
    }
    if at(0, b"GIF87a") || at(0, b"GIF89a") {
        return Media::Image("image/gif", "gif");
    }
    if at(0, b"RIFF") && at(8, b"WEBP") {
        return Media::Image("image/webp", "webp");
    }
    if at(4, b"ftypheic") || at(4, b"ftypheix") || at(4, b"ftypmif1") {
        return Media::Image("image/heic", "heic");
    }
    if at(0, b"%PDF-") {
        return Media::Pdf;
    }
    if at(0, b"RIFF") && at(8, b"WAVE") {
        return Media::Audio("audio/wav", "wav");
    }
    if at(4, b"ftypM4A") || at(4, b"ftypmp42") || at(4, b"ftypisom") || at(4, b"ftyp3gp") {
        return Media::Audio("audio/mp4", "m4a");
    }
    if at(0, b"caff") {
        return Media::Audio("audio/x-caf", "caf");
    }
    if at(0, b"ID3") || at(0, b"\xff\xfb") || at(0, b"\xff\xf3") {
        return Media::Audio("audio/mpeg", "mp3");
    }
    if at(0, b"\xff\xf1") || at(0, b"\xff\xf9") {
        return Media::Audio("audio/aac", "aac");
    }
    if at(0, b"#!AMR") {
        return Media::Audio("audio/amr", "amr");
    }
    match extension {
        "m4a" | "mp4" | "3gp" => Media::Audio("audio/mp4", "m4a"),
        "aac" => Media::Audio("audio/aac", "aac"),
        "wav" => Media::Audio("audio/wav", "wav"),
        _ => Media::Other,
    }
}

/// A name for an attachment: its own name when that has an extension, or else one made from the kind.
pub fn file_name(name: &str, extension: &str) -> String {
    if name.contains('.') {
        name.to_owned()
    } else {
        format!("{name}.{extension}")
    }
}
