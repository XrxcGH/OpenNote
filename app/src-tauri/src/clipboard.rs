//! Clipboard facts for paste (Phase 4 ARCHITECTURE.md section 15.2): the clipboard sequence number, a hash of its
//! text, CF_HTML's source address, whether OneNote put its formats there, and file tokens for the temporary images
//! Word and OneNote leave in `%TEMP%\msohtmlclip*`. The browser's paste event can't see any of these. The page uses
//! the facts only when the text hash matches its own paste, so they provably belong to it, and it never names a
//! path: a token stands for one file whose path was resolved and checked here.

use std::{
    collections::{hash_map::RandomState, HashMap},
    hash::{BuildHasher, Hasher},
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
    time::{Duration, Instant},
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::ipc::{IpcError, IpcResult};

/// How long a file token stays valid.
const TOKEN_LIFE: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFacts {
    pub sequence: u32,
    pub text_sha256: Option<String>,
    pub source_url: Option<String>,
    pub has_one_note: bool,
    pub word_images: Vec<ClipImage>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ClipImage {
    pub src: String,
    pub token: String,
}

/// Tokens that name files the shell found, so the interface never sends a path back.
pub struct ClipTokens {
    tokens: Mutex<HashMap<String, (PathBuf, Instant)>>,
    random: RandomState,
    counter: Mutex<u64>,
}

impl Default for ClipTokens {
    fn default() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
            random: RandomState::new(),
            counter: Mutex::new(0),
        }
    }
}

impl ClipTokens {
    /// 128 bits from the process's random hash keys and a counter, so a token can't be guessed from another.
    fn fresh(&self) -> String {
        let mut counter = self.counter.lock().unwrap_or_else(PoisonError::into_inner);
        *counter += 1;
        let half = |salt: u64| {
            let mut hasher = self.random.build_hasher();
            hasher.write_u64(*counter);
            hasher.write_u64(salt);
            hasher.finish()
        };
        format!("clip-{:016x}{:016x}", half(0x6f70_656e), half(0x6e6f_7465))
    }

    pub fn issue(&self, path: PathBuf) -> String {
        let token = self.fresh();
        let mut tokens = self.tokens.lock().unwrap_or_else(PoisonError::into_inner);
        tokens.retain(|_, (_, at)| at.elapsed() < TOKEN_LIFE);
        tokens.insert(token.clone(), (path, Instant::now()));
        token
    }

    pub fn resolve(&self, token: &str) -> Option<PathBuf> {
        let tokens = self.tokens.lock().unwrap_or_else(PoisonError::into_inner);
        let (path, at) = tokens.get(token)?;
        (at.elapsed() < TOKEN_LIFE).then(|| path.clone())
    }

    #[cfg(test)]
    fn age(&self, token: &str, by: Duration) {
        let mut tokens = self.tokens.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((_, at)) = tokens.get_mut(token) {
            *at = at.checked_sub(by).unwrap_or(*at);
        }
    }
}

/// What one read of the clipboard found, before the checks.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub sequence: u32,
    pub text: Option<String>,
    /// The `HTML Format` item: a CF_HTML header, then UTF-8 HTML.
    pub html: Option<Vec<u8>>,
    pub has_one_note: bool,
    /// A `CF_DIB` item: a bitmap header and pixels, without the file header.
    pub dib: Option<Vec<u8>>,
}

/// SHA-256 of the text with CRLF turned into LF, as lowercase hexadecimal, which the page computes the same way.
pub fn text_hash(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n");
    let digest = Sha256::digest(normalized.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The HTML of a CF_HTML item, from `StartHTML` to `EndHTML`, and its `SourceURL` when it is http or https.
pub fn cf_html(raw: &[u8]) -> (String, Option<String>) {
    let header_end = raw.iter().position(|byte| *byte == b'<').unwrap_or(raw.len());
    let header = String::from_utf8_lossy(&raw[..header_end]);
    let field = |name: &str| {
        header.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key.trim().eq_ignore_ascii_case(name)).then(|| value.trim().to_owned())
        })
    };
    let offset = |name: &str| field(name).and_then(|value| value.parse::<usize>().ok());
    let (start, end) = match (offset("StartHTML"), offset("EndHTML")) {
        (Some(start), Some(end)) if start <= end && end <= raw.len() => (start, end),
        _ => (header_end, raw.len()),
    };
    let html = String::from_utf8_lossy(&raw[start..end])
        .trim_end_matches('\0')
        .to_owned();
    let source = field("SourceURL").filter(|url| {
        let lower = url.to_ascii_lowercase();
        (lower.starts_with("https://") || lower.starts_with("http://")) && !url.chars().any(char::is_whitespace)
    });
    (html, source)
}

/// Every distinct `file:` image source in the HTML, as written: Word's `<img src>` and `<v:imagedata src>`.
pub fn file_image_sources(html: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let lower = html.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find("src=") {
        let start = from + at + 4;
        from = start;
        let Some(quote) = html[start..].chars().next().filter(|c| *c == '"' || *c == '\'') else {
            continue;
        };
        let Some(close) = html[start + 1..].find(quote) else {
            break;
        };
        let value = html_unescape(&html[start + 1..start + 1 + close]);
        if value.to_ascii_lowercase().starts_with("file:") && !found.contains(&value) {
            found.push(value);
        }
        from = start + 1 + close;
    }
    found
}

fn html_unescape(text: &str) -> String {
    text.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'")
}

/// The path a `file:` URL names, on Windows' terms.
pub fn file_url_path(src: &str) -> Option<PathBuf> {
    let rest = src.get(5..)?.trim_start_matches('/');
    if rest.is_empty() {
        return None;
    }
    let decoded = crate::images::import::percent_decode(rest);
    Some(PathBuf::from(decoded.replace('/', "\\")))
}

const CLIP_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "heic"];

/// The file, with links resolved, when it is an image inside a `msohtmlclip` folder of the temp folder.
pub fn checked_clip_path(path: &Path, temp: &Path) -> Option<PathBuf> {
    let resolved = std::fs::canonicalize(path).ok()?;
    let temp = std::fs::canonicalize(temp).ok()?;
    let inside = resolved.strip_prefix(&temp).ok()?;
    let in_clip_folder = inside.parent().into_iter().flat_map(Path::components).any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .to_ascii_lowercase()
            .starts_with("msohtmlclip")
    });
    let extension = resolved.extension()?.to_string_lossy().to_ascii_lowercase();
    (in_clip_folder && CLIP_IMAGE_EXTENSIONS.contains(&extension.as_str()) && resolved.is_file()).then_some(resolved)
}

/// A BMP file from a `CF_DIB` item: the 14-byte file header, then the item.
pub fn dib_to_bmp(dib: &[u8]) -> Option<Vec<u8>> {
    let le32 = |at: usize| Some(u32::from_le_bytes(dib.get(at..at + 4)?.try_into().ok()?));
    let le16 = |at: usize| Some(u16::from_le_bytes(dib.get(at..at + 2)?.try_into().ok()?));
    let header = le32(0)?;
    if header < 12 || header as usize > dib.len() {
        return None;
    }
    let (bits, compression, used) = if header == 12 {
        (le16(10)?, 0, 0)
    } else {
        (le16(14)?, le32(16)?, le32(32)?)
    };
    let masks = if header == 40 && (compression == 3 || compression == 6) {
        if compression == 6 {
            16
        } else {
            12
        }
    } else {
        0
    };
    let entry = if header == 12 { 3 } else { 4 };
    let colors = if bits <= 8 {
        if used == 0 {
            1u32 << bits
        } else {
            used
        }
    } else {
        used
    };
    let offset = 14 + header as usize + masks + colors as usize * entry;
    let total = 14 + dib.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&u32::try_from(total).ok()?.to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&u32::try_from(offset).ok()?.to_le_bytes());
    out.extend_from_slice(dib);
    Some(out)
}

/// The facts of a snapshot, with a token issued for each Word image that passes the path checks.
pub fn facts_of(snapshot: &Snapshot, tokens: &ClipTokens, temp: &Path) -> ClipboardFacts {
    let (html, source_url) = snapshot.html.as_deref().map(cf_html).unwrap_or_default();
    let word_images = file_image_sources(&html)
        .into_iter()
        .filter_map(|src| {
            let path = checked_clip_path(&file_url_path(&src)?, temp)?;
            Some(ClipImage {
                token: tokens.issue(path),
                src,
            })
        })
        .collect();
    ClipboardFacts {
        sequence: snapshot.sequence,
        text_sha256: snapshot.text.as_deref().map(text_hash),
        source_url,
        has_one_note: snapshot.has_one_note,
        word_images,
    }
}

#[cfg(windows)]
mod win {
    use windows::{
        core::w,
        Win32::{
            Foundation::{HANDLE, HGLOBAL},
            System::{
                DataExchange::{
                    CloseClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardFormatNameW,
                    GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW,
                },
                Memory::{GlobalLock, GlobalSize, GlobalUnlock},
                Ole::{CF_DIB, CF_UNICODETEXT},
            },
        },
    };

    use super::Snapshot;

    /// Copies a clipboard item's memory.
    ///
    /// # Safety
    /// The clipboard must be open, and `handle` one of its items.
    unsafe fn bytes_of(handle: HANDLE) -> Option<Vec<u8>> {
        let memory = HGLOBAL(handle.0);
        let size = GlobalSize(memory);
        let start = GlobalLock(memory) as *const u8;
        if start.is_null() {
            return None;
        }
        let out = std::slice::from_raw_parts(start, size).to_vec();
        let _ = GlobalUnlock(memory);
        Some(out)
    }

    fn open() -> bool {
        for attempt in 0..10 {
            // SAFETY: no window owns the clipboard while it is open here, and it is closed by the caller.
            if unsafe { OpenClipboard(None) }.is_ok() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(5 + attempt * 5));
        }
        false
    }

    fn read_open(content: bool) -> Snapshot {
        let mut snapshot = Snapshot::default();
        // SAFETY: the clipboard is open for the whole read, and each item is copied before it closes.
        unsafe {
            snapshot.sequence = GetClipboardSequenceNumber();
            let html_format = RegisterClipboardFormatW(w!("HTML Format"));
            if let Ok(handle) = GetClipboardData(u32::from(CF_UNICODETEXT.0)) {
                snapshot.text = bytes_of(handle).map(|bytes| {
                    let units: Vec<u16> = bytes
                        .as_chunks::<2>()
                        .0
                        .iter()
                        .map(|pair| u16::from_le_bytes(*pair))
                        .collect();
                    let end = units.iter().position(|unit| *unit == 0).unwrap_or(units.len());
                    String::from_utf16_lossy(&units[..end])
                });
            }
            if let Ok(handle) = GetClipboardData(html_format) {
                snapshot.html = bytes_of(handle);
            }
            let mut format = EnumClipboardFormats(0);
            while format != 0 {
                let mut name = [0u16; 128];
                let length = GetClipboardFormatNameW(format, &mut name);
                if length > 0 {
                    let name = String::from_utf16_lossy(&name[..length as usize]).to_ascii_lowercase();
                    if name.contains("onenote") {
                        snapshot.has_one_note = true;
                    }
                }
                format = EnumClipboardFormats(format);
            }
            if content {
                if let Ok(handle) = GetClipboardData(u32::from(CF_DIB.0)) {
                    snapshot.dib = bytes_of(handle);
                }
            }
        }
        snapshot
    }

    /// One consistent read: the sequence number before and after must agree, or the read runs once more.
    pub fn read(content: bool) -> Option<Snapshot> {
        let mut last = None;
        for _ in 0..2 {
            if !open() {
                return None;
            }
            let snapshot = read_open(content);
            // SAFETY: opened above.
            let _ = unsafe { CloseClipboard() };
            // SAFETY: a plain query.
            let after = unsafe { GetClipboardSequenceNumber() };
            let stable = after == snapshot.sequence;
            last = Some(snapshot);
            if stable {
                break;
            }
        }
        last
    }
}

#[cfg(windows)]
fn read_snapshot(content: bool) -> IpcResult<Snapshot> {
    win::read(content).ok_or_else(|| IpcError::new("busy", "Another app is using the clipboard. Try again."))
}

#[cfg(not(windows))]
fn read_snapshot(_content: bool) -> IpcResult<Snapshot> {
    Err(IpcError::not_implemented("clipboard_facts"))
}

async fn snapshot_on_blocking(content: bool) -> IpcResult<Snapshot> {
    tauri::async_runtime::spawn_blocking(move || read_snapshot(content))
        .await
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))?
}

#[tauri::command]
pub async fn clipboard_facts(tokens: State<'_, ClipTokens>) -> IpcResult<ClipboardFacts> {
    let snapshot = snapshot_on_blocking(false).await?;
    Ok(facts_of(&snapshot, &tokens, &std::env::temp_dir()))
}

/// The JSON of `clipboard_read`: the facts, the CF_HTML's HTML, and the text.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentJson {
    #[serde(flatten)]
    facts: ClipboardFacts,
    html: Option<String>,
    text: Option<String>,
}

/// The JSON length as 4 bytes, the JSON (facts, html, text), then BMP bytes if the clipboard holds an image.
pub fn encode_content(snapshot: &Snapshot, facts: ClipboardFacts) -> Vec<u8> {
    let html = snapshot.html.as_deref().map(|raw| cf_html(raw).0);
    let json = serde_json::to_vec(&ContentJson {
        facts,
        html,
        text: snapshot.text.as_ref().map(|text| text.replace("\r\n", "\n")),
    })
    .unwrap_or_else(|_| b"{}".to_vec());
    let mut out = Vec::with_capacity(4 + json.len());
    out.extend_from_slice(&u32::try_from(json.len()).unwrap_or(0).to_le_bytes());
    out.extend_from_slice(&json);
    if let Some(bmp) = snapshot.dib.as_deref().and_then(dib_to_bmp) {
        out.extend_from_slice(&bmp);
    }
    out
}

#[tauri::command]
pub async fn clipboard_read(tokens: State<'_, ClipTokens>) -> IpcResult<tauri::ipc::Response> {
    let snapshot = snapshot_on_blocking(true).await?;
    let facts = facts_of(&snapshot, &tokens, &std::env::temp_dir());
    Ok(tauri::ipc::Response::new(encode_content(&snapshot, facts)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_name_their_files_and_expire() {
        let tokens = ClipTokens::default();
        let token = tokens.issue(PathBuf::from("a.png"));
        assert_eq!(tokens.resolve(&token), Some(PathBuf::from("a.png")));
        assert_eq!(tokens.resolve("clip-999"), None);
        let other = tokens.issue(PathBuf::from("b.png"));
        assert_ne!(other, token);
        assert_eq!(token.len(), "clip-".len() + 32);
        tokens.age(&token, TOKEN_LIFE + Duration::from_secs(1));
        assert_eq!(tokens.resolve(&token), None);
        assert_eq!(tokens.resolve(&other), Some(PathBuf::from("b.png")));
    }

    #[test]
    fn text_hashes_ignore_crlf() {
        assert_eq!(text_hash("a\r\nb"), text_hash("a\nb"));
        assert_eq!(
            text_hash(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    fn cf_html_item(html: &str, source: &str) -> Vec<u8> {
        let head = |start: usize, end: usize| {
            format!("Version:0.9\r\nStartHTML:{start:010}\r\nEndHTML:{end:010}\r\nSourceURL:{source}\r\n")
        };
        let length = head(0, 0).len();
        let mut out = head(length, length + html.len()).into_bytes();
        out.extend_from_slice(html.as_bytes());
        out.push(0);
        out
    }

    #[test]
    fn cf_html_gives_its_html_and_a_web_source() {
        let html = "<html><body><!--StartFragment--><p>Hi</p><!--EndFragment--></body></html>";
        let (found, source) = cf_html(&cf_html_item(html, "https://en.wikipedia.org/wiki/Tea"));
        assert_eq!(found, html);
        assert_eq!(source.as_deref(), Some("https://en.wikipedia.org/wiki/Tea"));
        assert_eq!(cf_html(&cf_html_item(html, "file:///C:/a.html")).1, None);
        assert_eq!(cf_html(&cf_html_item(html, "javascript:alert(1)")).1, None);
        assert_eq!(cf_html(b"<p>no header</p>").0, "<p>no header</p>");
    }

    #[test]
    fn word_images_are_found_by_their_file_sources() {
        let html = r#"<img src="file:///C:/Users/a/AppData/Local/Temp/msohtmlclip1/01/clip_image002.png" alt=x>
            <v:imagedata src='file:///C:/Users/a/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png'/>
            <img src="https://example.com/a.png">
            <img SRC="file:///C:/Users/a/AppData/Local/Temp/msohtmlclip1/01/clip_image002.png">"#;
        assert_eq!(
            file_image_sources(html),
            [
                "file:///C:/Users/a/AppData/Local/Temp/msohtmlclip1/01/clip_image002.png",
                "file:///C:/Users/a/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png",
            ]
        );
        assert_eq!(
            file_url_path("file:///C:/Temp/msohtmlclip1/01/clip%20image.png"),
            Some(PathBuf::from(r"C:\Temp\msohtmlclip1\01\clip image.png"))
        );
    }

    #[test]
    fn only_images_in_msohtmlclip_folders_of_the_temp_folder_pass() {
        let temp = tempfile::tempdir().unwrap();
        let clip = temp.path().join("msohtmlclip1").join("01");
        std::fs::create_dir_all(&clip).unwrap();
        let image = clip.join("clip_image001.png");
        std::fs::write(&image, b"png").unwrap();
        let list = clip.join("clip_filelist.xml");
        std::fs::write(&list, b"<xml/>").unwrap();
        let outside = temp.path().join("other.png");
        std::fs::write(&outside, b"png").unwrap();
        assert!(checked_clip_path(&image, temp.path()).is_some());
        assert!(checked_clip_path(&list, temp.path()).is_none());
        assert!(checked_clip_path(&outside, temp.path()).is_none());
        assert!(checked_clip_path(&clip.join("..").join("..").join("other.png"), temp.path()).is_none());
        assert!(checked_clip_path(&clip.join("missing.png"), temp.path()).is_none());
        let elsewhere = tempfile::tempdir().unwrap();
        assert!(checked_clip_path(&image, elsewhere.path()).is_none());

        let tokens = ClipTokens::default();
        let src = format!("file:///{}", image.display().to_string().replace('\\', "/"));
        let html = format!("<img src=\"{src}\"><img src=\"file:///{}\">", outside.display());
        let snapshot = Snapshot {
            sequence: 7,
            text: Some("a\r\nb".into()),
            html: Some(cf_html_item(&html, "")),
            ..Snapshot::default()
        };
        let facts = facts_of(&snapshot, &tokens, temp.path());
        assert_eq!(facts.sequence, 7);
        assert_eq!(facts.text_sha256, Some(text_hash("a\nb")));
        assert_eq!(facts.word_images.len(), 1);
        assert_eq!(facts.word_images[0].src, src);
        let resolved = tokens.resolve(&facts.word_images[0].token).unwrap();
        assert_eq!(resolved, std::fs::canonicalize(&image).unwrap());
    }

    #[test]
    fn a_dib_becomes_a_bmp_file() {
        // A 2 by 1 picture, 24 bits per pixel, its row padded to 8 bytes.
        let mut dib = Vec::new();
        for value in [40u32, 2, 1] {
            dib.extend_from_slice(&value.to_le_bytes());
        }
        dib.extend_from_slice(&1u16.to_le_bytes());
        dib.extend_from_slice(&24u16.to_le_bytes());
        dib.extend_from_slice(&[0; 24]);
        dib.extend_from_slice(&[255, 0, 0, 0, 255, 0, 0, 0]);
        let bmp = dib_to_bmp(&dib).unwrap();
        assert_eq!(&bmp[..2], b"BM");
        assert_eq!(u32::from_le_bytes(bmp[10..14].try_into().unwrap()), 54);
        let probed = crate::images::probe(&bmp).unwrap();
        assert_eq!((probed.width, probed.height), (2, 1));
    }

    #[test]
    fn content_is_its_json_length_then_json_then_the_bmp() {
        let snapshot = Snapshot {
            sequence: 1,
            text: Some("x\r\ny".into()),
            ..Snapshot::default()
        };
        let facts = facts_of(&snapshot, &ClipTokens::default(), Path::new("."));
        let out = encode_content(&snapshot, facts);
        let length = u32::from_le_bytes(out[..4].try_into().unwrap()) as usize;
        let json: serde_json::Value = serde_json::from_slice(&out[4..4 + length]).unwrap();
        assert_eq!(json["text"], "x\ny");
        assert_eq!(json["sequence"], 1);
        assert_eq!(json["hasOneNote"], false);
        assert_eq!(out.len(), 4 + length);
    }

    /// The real clipboard, through the clipset tool. It replaces what the clipboard holds, so it runs only when
    /// OPENNOTE_CLIPBOARD_TESTS is set: `OPENNOTE_CLIPBOARD_TESTS=1 cargo test -p opennote clipboard`.
    #[cfg(windows)]
    #[test]
    fn facts_from_the_real_clipboard() {
        if std::env::var_os("OPENNOTE_CLIPBOARD_TESTS").is_none() {
            return;
        }
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests");
        let case = format!("{root}/fixtures/clipboard/web/wikipedia-table");
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(format!("{root}/e2e/tools/clipset/clipset.ps1"))
            .arg(&case)
            .status()
            .unwrap();
        assert!(status.success());
        let snapshot = read_snapshot(true).unwrap();
        let facts = facts_of(&snapshot, &ClipTokens::default(), &std::env::temp_dir());
        let text = std::fs::read_to_string(format!("{case}/text.txt")).unwrap();
        assert_eq!(facts.text_sha256, Some(text_hash(&text)));
        assert!(facts
            .source_url
            .is_some_and(|url| url.starts_with("https://en.wikipedia.org/")));
        assert!(!facts.has_one_note);
    }
}
