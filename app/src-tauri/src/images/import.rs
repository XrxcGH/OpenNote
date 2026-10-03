//! Importing image bytes and Word's clipboard images into a page (Phase 4 ARCHITECTURE.md section 12.2). Each image
//! is probed from its header, checked against its declared type and against what WebView2 can show, and written into
//! the page's assets by the core, which returns only after the file is durable. The WebView never names a path.

use std::path::Path;

use opennote_core::{
    session::page::PageHandle,
    store::assets::{AssetSource, ImageSize},
    CoreError,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{ipc::InvokeBody, AppHandle, Manager, State};

use super::{
    convert,
    probe::{probe, ImageFormat, ProbeError},
};
use crate::{
    clipboard::ClipTokens,
    core_bridge,
    ipc::{codes, IpcError, IpcResult},
};

/// Files over 50 MB are refused (ARCHITECTURE.md section 12.2).
pub const MAX_IMAGE_BYTES: usize = 50 * 1024 * 1024;

/// The error codes the interface turns into messages.
pub mod errors {
    pub const UNSUPPORTED_TYPE: &str = "unsupportedType";
    pub const TOO_LARGE: &str = "tooLarge";
    pub const NOT_FOUND: &str = "notFound";
    pub const DOWNLOAD_FAILED: &str = "downloadFailed";
    pub const STALE_TOKEN: &str = "staleToken";
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportedAsset {
    pub id: String,
    pub asset: serde_json::Value,
}

/// The `x-opennote-image` header. The name is percent-encoded, because a header holds ASCII only.
#[derive(Debug, Deserialize)]
struct ImportHeader {
    page: String,
    name: String,
    #[serde(default)]
    mime: String,
}

/// An image that passed the checks, ready for the core.
#[derive(Debug, PartialEq, Eq)]
pub struct Checked {
    pub name: String,
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}

pub fn unsupported() -> IpcError {
    IpcError::new(
        errors::UNSUPPORTED_TYPE,
        "The file isn't an image type a page can show, or it doesn't match its declared type.",
    )
}

pub fn too_large() -> IpcError {
    IpcError::new(errors::TOO_LARGE, "Images over 50 MB can't be added.")
}

/// Probes the bytes and checks them: at most 50 MB, a format WebView2 shows, and the declared type when one is
/// given. HEIC and TIFF are converted to PNG or JPEG when `convert` is on and Windows has a codec for them.
pub fn check(bytes: Vec<u8>, name: &str, declared: &str, convert: bool) -> Result<Checked, IpcError> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(too_large());
    }
    let probed = probe(&bytes).map_err(|error| match error {
        ProbeError::Unsupported | ProbeError::Malformed(_) => unsupported(),
    })?;
    let declared = declared.trim();
    let generic = declared.is_empty() || declared.eq_ignore_ascii_case("application/octet-stream");
    if !generic && ImageFormat::from_mime(declared) != Some(probed.format) {
        return Err(unsupported());
    }
    if probed.format.displayable() {
        return Ok(Checked {
            name: name_for(name, probed.format),
            mime: probed.format.mime(),
            width: probed.width,
            height: probed.height,
            bytes,
        });
    }
    if !convert || !matches!(probed.format, ImageFormat::Heic | ImageFormat::Tiff) {
        return Err(unsupported());
    }
    let converted = convert::to_web_format(&bytes, probed.orientation).ok_or_else(unsupported)?;
    Ok(Checked {
        name: name_for(name, converted.format),
        mime: converted.format.mime(),
        width: converted.width,
        height: converted.height,
        bytes: converted.bytes,
    })
}

/// The file name with the extension of the format it holds, or a plain name when none was given.
fn name_for(name: &str, format: ImageFormat) -> String {
    let base = Path::new(name.trim())
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_owned();
    let stem = match base.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem.to_owned(),
        _ if base.is_empty() => "image".to_owned(),
        _ => base.clone(),
    };
    let extension = format.extension();
    let same = |found: &str| match format {
        ImageFormat::Jpeg => ["jpg", "jpeg", "jfif"].contains(&found),
        ImageFormat::Tiff => ["tif", "tiff"].contains(&found),
        _ => found == extension,
    };
    match name.trim().rsplit_once('.') {
        Some((_, found)) if same(&found.to_ascii_lowercase()) => base,
        _ => format!("{stem}.{extension}"),
    }
}

/// The asset table entry as `page.json` holds it, which the page keeps until its next open.
pub fn asset_json(asset: &opennote_core::model::asset::Asset) -> Value {
    let mut value = json!({
        "file": asset.file,
        "mime": asset.mime,
        "bytes": asset.bytes,
        "sha256": asset.sha256_hex(),
        "name": asset.name,
        "created": asset.created,
    });
    if let (Some(width), Some(height)) = (asset.width, asset.height) {
        value["width"] = json!(width);
        value["height"] = json!(height);
    }
    value
}

/// The open page an interface page ID names, or `notFound`.
pub fn open_page(app: &AppHandle, page: &str) -> Result<PageHandle, IpcError> {
    core_bridge::core_page_id(app, page)
        .and_then(|id| core_bridge::page_handle(app, id))
        .ok_or_else(|| IpcError::new(errors::NOT_FOUND, "The page isn't open."))
}

fn core_error(error: CoreError) -> IpcError {
    match error {
        CoreError::NotFound(what) => IpcError::new(errors::NOT_FOUND, what),
        CoreError::Edit(edit) => IpcError::new(edit.code(), edit.to_string()),
        CoreError::ReadOnly(reason) => IpcError::new("readOnly", format!("{reason:?}")),
        other => IpcError::new(codes::IO, other.to_string()),
    }
}

/// Stores a checked image in the page through the core, with its probed size, and answers with the table entry.
pub fn store(handle: &PageHandle, checked: Checked) -> Result<ImportedAsset, IpcError> {
    let (width, height) = (checked.width, checked.height);
    let asset = handle
        .import_asset(AssetSource::Bytes {
            name: checked.name,
            mime: checked.mime.to_owned(),
            bytes: checked.bytes,
            image: Some(ImageSize { width, height }),
        })
        .map_err(core_error)?;
    let mut json = asset_json(&asset);
    // The core reads PNG, GIF, JPEG, and BMP sizes from their headers itself, without the EXIF orientation. The
    // page lays an image out at its displayed size, so it gets the probed, oriented one.
    json["width"] = json!(width);
    json["height"] = json!(height);
    Ok(ImportedAsset {
        id: asset.id.to_string(),
        asset: json,
    })
}

/// Whether HEIC and TIFF are converted at import: `page.heicImport`, off by default, which development and nightly
/// builds can turn on in `settings.experimental.flags`, as the interface's flags do.
pub fn convert_enabled(app: &AppHandle) -> bool {
    let channel = crate::boot::channel_for(&app.package_info().version.to_string(), cfg!(debug_assertions));
    let allowed = matches!(channel, crate::boot::Channel::Dev | crate::boot::Channel::Nightly);
    allowed
        && app.try_state::<crate::settings::SettingsStore>().is_some_and(|store| {
            store
                .get()
                .experimental
                .flags
                .get("page.heicImport")
                .copied()
                .unwrap_or(false)
        })
}

/// Runs an import on a blocking thread, so the WebView's command thread never waits on a disk write.
pub async fn on_blocking<T: Send + 'static>(work: impl FnOnce() -> IpcResult<T> + Send + 'static) -> IpcResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
}

pub(crate) fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes.get(i + 1..i + 3).and_then(|pair| std::str::from_utf8(pair).ok());
        match (bytes[i], hex.and_then(|pair| u8::from_str_radix(pair, 16).ok())) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A raw body with the header `x-opennote-image: {"page","name","mime"}`.
#[tauri::command]
pub async fn image_import(app: AppHandle, request: tauri::ipc::Request<'_>) -> IpcResult<ImportedAsset> {
    let header = request
        .headers()
        .get("x-opennote-image")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| IpcError::invalid("x-opennote-image", "The image header is missing."))?;
    let header: ImportHeader = serde_json::from_str(header)
        .map_err(|_| IpcError::invalid("x-opennote-image", "The image header isn't valid JSON."))?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err(IpcError::invalid("body", "The image must come as raw bytes.")),
    };
    let convert = convert_enabled(&app);
    on_blocking(move || {
        let handle = open_page(&app, &header.page)?;
        let checked = check(bytes, &percent_decode(&header.name), &header.mime, convert)?;
        store(&handle, checked)
    })
    .await
}

#[tauri::command]
pub async fn image_import_clip(
    app: AppHandle,
    tokens: State<'_, ClipTokens>,
    page: String,
    token: String,
) -> IpcResult<ImportedAsset> {
    let path = tokens.resolve(&token).ok_or_else(|| {
        IpcError::new(
            errors::STALE_TOKEN,
            "The copied image is no longer on the clipboard. Copy it again.",
        )
    })?;
    let convert = convert_enabled(&app);
    on_blocking(move || {
        let handle = open_page(&app, &page)?;
        let bytes = read_capped(&path)?;
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("image").to_owned();
        let checked = check(bytes, &name, "", convert)?;
        store(&handle, checked)
    })
    .await
}

/// A file's bytes, refused when it is over the size limit.
fn read_capped(path: &Path) -> Result<Vec<u8>, IpcError> {
    let length = std::fs::metadata(path)
        .map_err(|_| IpcError::new(errors::STALE_TOKEN, "The copied image is gone. Copy it again."))?
        .len();
    if length > MAX_IMAGE_BYTES as u64 {
        return Err(too_large());
    }
    std::fs::read(path).map_err(|_| IpcError::new(errors::STALE_TOKEN, "The copied image is gone. Copy it again."))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/images/fixtures");

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(format!("{FIXTURES}/{name}")).unwrap()
    }

    #[test]
    fn a_matching_image_passes_with_its_oriented_size() {
        let checked = check(fixture("jpeg-o6.jpg"), "Photo.JPEG", "image/jpeg", false).unwrap();
        assert_eq!((checked.mime, checked.width, checked.height), ("image/jpeg", 4, 6));
        assert_eq!(checked.name, "Photo.JPEG");
        let checked = check(fixture("png.png"), "", "", false).unwrap();
        assert_eq!((checked.name.as_str(), checked.mime), ("image.png", "image/png"));
        let checked = check(
            fixture("webp-lossy.webp"),
            "pasted.png",
            "application/octet-stream",
            false,
        )
        .unwrap();
        assert_eq!((checked.name.as_str(), checked.mime), ("pasted.webp", "image/webp"));
    }

    #[test]
    fn a_type_mismatch_is_refused() {
        let error = check(fixture("png.png"), "a.jpg", "image/jpeg", false).unwrap_err();
        assert_eq!(error.code, errors::UNSUPPORTED_TYPE);
        let error = check(b"<html>not an image</html>".to_vec(), "a.png", "image/png", false).unwrap_err();
        assert_eq!(error.code, errors::UNSUPPORTED_TYPE);
    }

    #[test]
    fn heic_and_tiff_are_refused_without_conversion() {
        for name in ["heic-header.heic", "tiff-o6.tif"] {
            let error = check(fixture(name), name, "", false).unwrap_err();
            assert_eq!(error.code, errors::UNSUPPORTED_TYPE, "{name}");
        }
    }

    #[test]
    fn files_over_50_mb_are_refused() {
        let error = check(vec![0; MAX_IMAGE_BYTES + 1], "big.png", "image/png", false).unwrap_err();
        assert_eq!(error.code, errors::TOO_LARGE);
    }

    #[test]
    fn names_are_percent_decoded() {
        assert_eq!(percent_decode("Fot%C3%B3%20%25.png"), "Fotó %.png");
        assert_eq!(percent_decode("100%"), "100%");
    }
}
