//! The `opennote-asset` scheme (Phase 4 ARCHITECTURE.md section 12.3): `<page>/<asset>` serves an asset of an open
//! page through the core's `PageHandle::asset_bytes`, so the WebView never opens an asset file itself. On Windows,
//! WebView2 reaches it as `http://opennote-asset.localhost/<page>/<asset>`. Assets never change once written, so
//! the answers may be cached for good.

use std::ops::Range;

use opennote_core::AssetId;
use tauri::{
    http::{header, Request, Response, StatusCode},
    AppHandle, Builder, Runtime, UriSchemeContext, Wry,
};

pub const SCHEME: &str = "opennote-asset";

/// The page and asset a request path names: `/<page>/<asset>`.
fn parse_path(path: &str) -> Option<(String, AssetId)> {
    let mut parts = path.trim_start_matches('/').split('/');
    let page = parts.next().filter(|page| !page.is_empty())?;
    let asset = AssetId::parse(parts.next()?).ok()?;
    parts.next().is_none().then(|| (page.to_owned(), asset))
}

/// A `Range: bytes=a-b` header as a byte range, when it names one range the asset has.
fn parse_range(value: &str) -> Option<(u64, Option<u64>)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let start: u64 = start.trim().parse().ok()?;
    let end = match end.trim() {
        "" => None,
        end => Some(end.parse::<u64>().ok()?),
    };
    Some((start, end))
}

fn plain(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(Vec::new())
        .unwrap_or_default()
}

/// The answer to one request, on a blocking thread: the core reads the file.
fn answer(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some((page, asset)) = parse_path(request.uri().path()) else {
        return plain(StatusCode::NOT_FOUND);
    };
    let Ok(handle) = super::import::open_page(app, &page) else {
        return plain(StatusCode::NOT_FOUND);
    };
    let requested = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_range);
    let range = requested.map(|(start, end)| Range {
        start,
        end: end.map_or(u64::MAX, |end| end.saturating_add(1)),
    });
    let bytes = match handle.asset_bytes(asset, range) {
        Ok(bytes) => bytes,
        Err(opennote_core::CoreError::NotFound(_)) => return plain(StatusCode::NOT_FOUND),
        Err(error) => {
            log::warn!("Couldn't read an asset for the page: {error}");
            return plain(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, bytes.mime.as_str())
        .header(header::CACHE_CONTROL, "private, max-age=31536000, immutable")
        .header(header::ACCEPT_RANGES, "bytes")
        .header("X-Content-Type-Options", "nosniff")
        // The page reads an image's pixels for text recognition (Phase 12), which is a cross-origin fetch.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        );
    builder = match &bytes.range {
        Some(range) => builder.status(StatusCode::PARTIAL_CONTENT).header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", range.start, range.end.saturating_sub(1), bytes.total),
        ),
        None => builder.status(StatusCode::OK),
    };
    builder
        .body(bytes.bytes)
        .unwrap_or_else(|_| plain(StatusCode::INTERNAL_SERVER_ERROR))
}

pub fn register(builder: Builder<Wry>) -> Builder<Wry> {
    builder.register_asynchronous_uri_scheme_protocol(SCHEME, |context, request, responder| {
        let app = app_of(&context);
        tauri::async_runtime::spawn_blocking(move || responder.respond(answer(&app, &request)));
    })
}

fn app_of<R: Runtime>(context: &UriSchemeContext<'_, R>) -> AppHandle<R> {
    context.app_handle().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_name_a_page_and_an_asset() {
        let asset = "01m3sabc31y0rfa24eeh6j4ky4";
        assert_eq!(
            parse_path(&format!("/page-1/{asset}")).map(|(page, id)| (page, id.to_string())),
            Some(("page-1".to_owned(), asset.to_owned()))
        );
        assert!(parse_path("/page-1").is_none());
        assert!(parse_path(&format!("/page-1/{asset}/more")).is_none());
        assert!(parse_path("/page-1/..%2f..%2fwin.ini").is_none());
    }

    #[test]
    fn ranges_parse() {
        assert_eq!(parse_range("bytes=0-99"), Some((0, Some(99))));
        assert_eq!(parse_range("bytes=100-"), Some((100, None)));
        assert_eq!(parse_range("bytes=0-1,4-5"), None);
        assert_eq!(parse_range("items=0-1"), None);
    }
}
