//! "Share to OpenNote" (flag `integrations.shareTarget`; docs/help/import-and-export.md). With the sparse package
//! in packaging/msix registered, OpenNote is in the Windows share sheet for text, links, pictures, and files.
//!
//! Windows starts `OpenNote.exe` for each share. That launch reads what was shared ([`activation`]), saves it to
//! the share inbox in the local data folder, tells Windows the share is done, and then starts as usual: either it
//! becomes the app, or it hands its arguments to the running window and exits. Either way the interface takes the
//! inbox with `share_take` and adds each share to the open page, or to a new page in Quick notes when no page is
//! open (app/src/features/integrations/share).
//!
//! What is kept is limited: text up to 2 MB, at most 10 files of up to 15 MB each, and only `http`, `https`, and
//! `mailto` links. Nothing is read from the inbox but the files this module wrote, and a share older than a day is
//! thrown away unread.

#[cfg(windows)]
pub mod activation;

use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    ipc::{IpcError, IpcResult},
    paths::Paths,
    platform_flags,
};

/// The most text a share keeps.
pub const MAX_TEXT: usize = 2 * 1024 * 1024;
/// The most files a share keeps.
pub const MAX_FILES: usize = 10;
/// The largest file a share keeps.
pub const MAX_FILE: u64 = 15 * 1024 * 1024;
/// The most shares waiting in the inbox; more are left for the next take.
pub const MAX_WAITING: usize = 20;
/// A share left this long is thrown away.
pub const STALE: Duration = Duration::from_secs(24 * 60 * 60);

const INBOX: &str = "share-inbox";
const META: &str = "share.json";

/// A file that was shared, or a picture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SharedFile {
    pub name: String,
    pub mime: String,
    #[serde(skip)]
    pub bytes: Vec<u8>,
}

/// What another app shared, as Windows hands it over.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shared {
    pub text: Option<String>,
    pub uri: Option<String>,
    pub files: Vec<SharedFile>,
    /// Files that were too large or too many, by name.
    #[serde(default)]
    pub skipped: Vec<String>,
}

/// A share as the page gets it: a title for a new page, Markdown for a text block, and the files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareBlocks {
    pub title: String,
    /// Plain text, as it was shared.
    pub text: String,
    /// A link that may be kept: `http`, `https`, or `mailto`.
    pub link: Option<String>,
    /// The text and the link as Markdown, for a new page.
    pub markdown: String,
    pub files: Vec<ShareFileOut>,
    pub skipped: Vec<String>,
}

/// A file as the interface gets it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareFileOut {
    pub name: String,
    pub mime: String,
    /// Base64.
    pub data: String,
}

/// A link a page may keep.
pub fn safe_link(uri: &str) -> Option<String> {
    let uri = uri.trim();
    let lower = uri.to_ascii_lowercase();
    let scheme_ok = ["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme));
    (scheme_ok && uri.len() <= 2048 && !uri.chars().any(|c| c.is_control() || c.is_whitespace()))
        .then(|| uri.to_owned())
}

/// Text without control characters other than tabs and line breaks, cut at [`MAX_TEXT`] on a character boundary.
pub fn clean_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len().min(MAX_TEXT));
    for c in text.chars().filter(|c| !c.is_control() || matches!(c, '\n' | '\t')) {
        if out.len() + c.len_utf8() > MAX_TEXT {
            break;
        }
        out.push(c);
    }
    out
}

/// The type of a file from its name, for a share that didn't say.
pub fn mime_for(name: &str) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

/// A type the page's paste can trust: the shared one when it looks like a type, else the name's.
fn clean_mime(mime: &str, name: &str) -> String {
    let mime = mime.trim().to_ascii_lowercase();
    let looks = mime.len() <= 100
        && mime
            .split_once('/')
            .is_some_and(|(kind, sub)| !kind.is_empty() && !sub.is_empty())
        && mime.bytes().all(|b| b.is_ascii_alphanumeric() || b"/.+-".contains(&b));
    if looks {
        mime
    } else {
        mime_for(name).to_owned()
    }
}

/// Maps a share to what goes on a page: the first line of text (or the link, or the first file) is the title of a
/// new page; the link goes first, then the text; files keep safe names and a type.
pub fn to_blocks(shared: Shared) -> ShareBlocks {
    let text = shared.text.as_deref().map(clean_text).unwrap_or_default();
    let link = shared.uri.as_deref().and_then(safe_link);
    let files: Vec<ShareFileOut> = shared
        .files
        .into_iter()
        .take(MAX_FILES)
        .map(|file| {
            let name = opennote_api::routes::file_name(&file.name);
            ShareFileOut {
                mime: clean_mime(&file.mime, &name),
                name,
                data: STANDARD.encode(&file.bytes),
            }
        })
        .collect();
    let first_line = text.lines().map(str::trim).find(|line| !line.is_empty());
    let title_source = first_line
        .map(str::to_owned)
        .or_else(|| link.as_deref().map(link_title))
        .or_else(|| files.first().map(|file| file.name.clone()))
        .unwrap_or_else(|| "Shared item".to_owned());
    let title: String = title_source.chars().take(80).collect();
    let mut markdown = String::new();
    if let Some(link) = &link {
        markdown.push('<');
        markdown.push_str(link);
        markdown.push('>');
    }
    if !text.trim().is_empty() && Some(text.trim()) != link.as_deref() {
        if !markdown.is_empty() {
            markdown.push_str("\n\n");
        }
        markdown.push_str(text.trim());
    }
    ShareBlocks {
        title,
        text,
        link,
        markdown,
        files,
        skipped: shared.skipped,
    }
}

/// A short title for a link: its host and path, without the scheme.
fn link_title(link: &str) -> String {
    let rest = link.split_once("://").map_or(link, |(_, rest)| rest);
    let rest = rest.strip_prefix("mailto:").unwrap_or(rest);
    rest.trim_end_matches('/').to_owned()
}

/// The inbox folder in the local data folder.
pub fn inbox(paths: &Paths) -> PathBuf {
    paths.local.join(INBOX)
}

fn new_id() -> String {
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    format!("{millis:013}-{}", opennote_api::grants::random_hex(4))
}

/// Saves a share to the inbox. Files go beside `share.json` as `0.bin`, `1.bin`, and so on, never by their own name.
pub fn save(inbox: &Path, mut shared: Shared) -> io::Result<String> {
    let id = new_id();
    let folder = inbox.join(&id);
    fs::create_dir_all(&folder)?;
    let mut kept = Vec::new();
    for file in shared.files.drain(..) {
        if kept.len() == MAX_FILES || file.bytes.len() as u64 > MAX_FILE {
            shared.skipped.push(file.name);
            continue;
        }
        fs::write(folder.join(format!("{}.bin", kept.len())), &file.bytes)?;
        kept.push(SharedFile {
            bytes: Vec::new(),
            ..file
        });
    }
    shared.files = kept;
    shared.text = shared.text.as_deref().map(clean_text);
    let json = serde_json::to_vec(&shared).map_err(io::Error::other)?;
    // Written last, so a half-saved share is never taken.
    fs::write(folder.join(META), json)?;
    Ok(id)
}

/// Takes every complete share from the inbox, oldest first, and removes them. Stale or broken ones are removed
/// unread.
pub fn take_all(inbox: &Path, now: SystemTime) -> Vec<ShareBlocks> {
    let Ok(entries) = fs::read_dir(inbox) else {
        return Vec::new();
    };
    let mut folders: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect();
    folders.sort();
    let mut out = Vec::new();
    for folder in folders {
        if out.len() == MAX_WAITING {
            break;
        }
        let meta = folder.join(META);
        let modified = fs::metadata(&meta).and_then(|meta| meta.modified());
        let Ok(modified) = modified else {
            // Still being written, unless it has sat there a day.
            let old = fs::metadata(&folder)
                .and_then(|meta| meta.modified())
                .is_ok_and(|time| now.duration_since(time).unwrap_or_default() > STALE);
            if old {
                let _ = fs::remove_dir_all(&folder);
            }
            continue;
        };
        let fresh = now.duration_since(modified).unwrap_or_default() <= STALE;
        if fresh {
            if let Some(blocks) = read_share_blocks(&folder) {
                out.push(blocks);
            }
        }
        if let Err(error) = fs::remove_dir_all(&folder) {
            log::warn!("Couldn't clear a share from the inbox: {error}");
        }
    }
    out
}

fn read_share(folder: &Path) -> Option<Shared> {
    let mut shared: Shared = serde_json::from_slice(&fs::read(folder.join(META)).ok()?).ok()?;
    let mut files = Vec::with_capacity(shared.files.len());
    for (index, file) in shared.files.drain(..).take(MAX_FILES).enumerate() {
        let path = folder.join(format!("{index}.bin"));
        if fs::metadata(&path).is_ok_and(|meta| meta.len() <= MAX_FILE) {
            if let Ok(bytes) = fs::read(&path) {
                files.push(SharedFile { bytes, ..file });
            }
        }
    }
    shared.files = files;
    Some(shared)
}

fn read_share_blocks(folder: &Path) -> Option<ShareBlocks> {
    read_share(folder).map(to_blocks)
}

/// Saves a share this launch was started for, before the instance lock hands the launch to a running window. It runs
/// before the settings load, so it follows the channel's default and `OPENNOTE_FLAGS`; `share_take` then applies
/// the settings too. Best effort: a failure is logged, and the app starts anyway.
pub fn receive_launch(paths: &Paths) {
    if !platform_flags::is_on_now(platform_flags::SHARE_TARGET, &std::collections::BTreeMap::new()) {
        return;
    }
    #[cfg(windows)]
    if let Some(shared) = activation::read() {
        match save(&inbox(paths), shared) {
            Ok(_) => log::info!("Saved a share for the window to add."),
            Err(error) => log::warn!("Couldn't save what was shared: {error}"),
        }
    }
    #[cfg(not(windows))]
    let _ = paths;
}

/// The paths the share commands need.
pub struct ShareState {
    pub inbox: PathBuf,
}

/// Takes the shares waiting in the inbox. Refused when the flag is off.
#[tauri::command]
pub fn share_take(app: AppHandle, state: State<'_, ShareState>) -> IpcResult<Vec<ShareBlocks>> {
    if !platform_flags::is_on_for(&app, platform_flags::SHARE_TARGET) {
        return Err(IpcError::new("off", "Share to OpenNote is off."));
    }
    Ok(take_all(&state.inbox, SystemTime::now()))
}

#[cfg(test)]
mod tests;
