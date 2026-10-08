//! The extra host calls of the account features (connectors, meeting notes, sharing, sending, syncing). One command,
//! `accounts_call`, carries each by name with JSON arguments, so the command list and the capability file stay short
//! (like `shellqol_call`).
//!
//! - `state.*`: small JSON files in `accounts/state` of this device's folder, for what a sync remembers (a cursor,
//!   a delta link, the ID of the copy at a service). They hold no token.
//! - `client.set`: saves a client ID typed on a card, in the connectors file.
//! - `temp.*`: files in `accounts/tmp`, where an export is written before it goes to a service and an import is
//!   read after it comes back. The calls take names inside that folder, never other paths.
//! - `transfer.*`: a file down from a service or up to it, with the connection's token added by the connector. The
//!   bytes stay in Rust, so a large file never crosses into the interface.

use std::{
    fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{async_runtime::spawn_blocking, State};

use super::{
    commands::{ApiRequest, ApiResponse},
    files,
    http::{Body, HttpRequest},
    service::Connectors,
};
use crate::{
    ipc::{codes, IpcError, IpcResult},
    paths::Paths,
    settings::file::{write_atomic, write_json},
};

/// The largest file a transfer moves in memory.
const MAX_TRANSFER: usize = 256 * 1024 * 1024;

/// The folder of this module inside the device's folder.
const FOLDER: &str = "accounts";

fn invalid(field: &str, message: &str) -> IpcError {
    IpcError::invalid(field, message)
}

fn io_error(error: &std::io::Error) -> IpcError {
    IpcError::new(codes::IO, error.to_string())
}

fn arg<T: serde::de::DeserializeOwned>(args: &Value, name: &str) -> IpcResult<T> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null)).map_err(|error| invalid(name, &error.to_string()))
}

/// A name that is one file name: letters, digits, dot, dash, underscore, and space, and not starting with a dot.
fn safe_segment(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 128
        && !text.starts_with('.')
        && !text.ends_with(' ')
        && text
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ' | '(' | ')'))
}

/// A state name: lowercase letters, digits, dot, and dash.
fn safe_state_name(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 64
        && text
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-'))
        && !text.starts_with('.')
}

/// Where a file named by the interface is: a relative name made of safe segments inside the temp folder, or an
/// absolute path that already lies inside it (an export reports the path it wrote).
pub(super) fn resolve_temp(root: &Path, text: &str) -> Result<PathBuf, IpcError> {
    let tmp = root.join("tmp");
    let candidate = Path::new(text);
    if candidate.is_absolute() {
        let (Ok(inside), Ok(base)) = (candidate.canonicalize(), tmp.canonicalize()) else {
            return Err(invalid("file", "That file isn't in the transfer folder."));
        };
        return if inside.starts_with(&base) {
            Ok(inside)
        } else {
            Err(invalid("file", "That file isn't in the transfer folder."))
        };
    }
    let segments: Vec<&str> = text.split('/').collect();
    if segments.is_empty() || !segments.iter().all(|segment| safe_segment(segment)) {
        return Err(invalid("file", "That isn't a file name."));
    }
    Ok(segments.iter().fold(tmp, |path, segment| path.join(segment)))
}

fn state_file(root: &Path, name: &str) -> Result<PathBuf, IpcError> {
    if !safe_state_name(name) {
        return Err(invalid("name", "That isn't a state name."));
    }
    Ok(root.join("state").join(format!("{name}.json")))
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Part {
    Text {
        text: String,
    },
    Base64 {
        base64: String,
    },
    File {
        file: String,
        #[serde(default)]
        offset: Option<u64>,
        #[serde(default)]
        length: Option<u64>,
    },
}

fn read_part(root: &Path, part: &Part) -> IpcResult<Vec<u8>> {
    match part {
        Part::Text { text } => Ok(text.clone().into_bytes()),
        Part::Base64 { base64 } => STANDARD.decode(base64).map_err(|_| invalid("parts", "The bytes aren't base64.")),
        Part::File { file, offset, length } => {
            let path = resolve_temp(root, file)?;
            let bytes = fs::read(&path).map_err(|error| io_error(&error))?;
            let start = usize::try_from(offset.unwrap_or(0)).unwrap_or(usize::MAX).min(bytes.len());
            let end = length
                .map_or(bytes.len(), |count| {
                    start.saturating_add(usize::try_from(count).unwrap_or(usize::MAX))
                })
                .min(bytes.len());
            Ok(bytes[start..end].to_vec())
        }
    }
}

fn join_parts(root: &Path, parts: &[Part]) -> IpcResult<Vec<u8>> {
    let mut body = Vec::new();
    for part in parts {
        body.extend(read_part(root, part)?);
        if body.len() > MAX_TRANSFER {
            return Err(invalid("parts", "That is too much to send at once."));
        }
    }
    Ok(body)
}

fn response_json(response: super::http::HttpResponse) -> Value {
    json!(ApiResponse {
        status: response.status,
        content_type: response.content_type,
        body: String::from_utf8_lossy(&response.body).into_owned(),
        location: response.location,
    })
}

/// Runs one named call. `root` is `accounts` in the device's folder.
pub(super) fn call(connectors: &Connectors, root: &Path, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "state.get" => {
            let path = state_file(root, &arg::<String>(args, "name")?)?;
            Ok(fs::read_to_string(path)
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .unwrap_or(Value::Null))
        }
        "state.set" => {
            let path = state_file(root, &arg::<String>(args, "name")?)?;
            write_json(&path, args.get("value").unwrap_or(&Value::Null)).map_err(|error| io_error(&error))?;
            Ok(json!({ "ok": true }))
        }
        "state.delete" => {
            let path = state_file(root, &arg::<String>(args, "name")?)?;
            let _ = fs::remove_file(path);
            Ok(json!({ "ok": true }))
        }
        "client.set" => {
            let connector: String = arg(args, "connector")?;
            let id: String = arg(args, "clientId")?;
            let secret: Option<String> = arg(args, "clientSecret")?;
            // Only a connector that signs in on a page has a client.
            let def = connectors.def(&connector).map_err(IpcError::from)?;
            if !matches!(def.auth, super::registry::Auth::OAuth(_)) {
                return Err(invalid("connector", "That connector has no client ID."));
            }
            files::save_client(&connectors.0.config_file, &connector, &id, secret.as_deref())
                .map_err(|_| invalid("clientId", "That client ID can't be used."))?;
            serde_json::to_value(connectors.view(&connector).map_err(IpcError::from)?)
                .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))
        }
        "temp.dir" => {
            let tmp = root.join("tmp");
            fs::create_dir_all(&tmp).map_err(|error| io_error(&error))?;
            Ok(json!({ "path": tmp.to_string_lossy() }))
        }
        "temp.write" => {
            let path = resolve_temp(root, &arg::<String>(args, "file")?)?;
            let part: Part = arg(args, "part")?;
            let bytes = read_part(root, &part)?;
            write_atomic(&path, &bytes).map_err(|error| io_error(&error))?;
            Ok(json!({ "path": path.to_string_lossy(), "bytes": bytes.len() }))
        }
        "temp.read" => {
            let path = resolve_temp(root, &arg::<String>(args, "file")?)?;
            let bytes = fs::read(path).map_err(|error| io_error(&error))?;
            if bytes.len() > MAX_TRANSFER {
                return Err(invalid("file", "That file is too large to read."));
            }
            Ok(json!({ "base64": STANDARD.encode(&bytes), "bytes": bytes.len() }))
        }
        "temp.remove" => {
            let path = resolve_temp(root, &arg::<String>(args, "file")?)?;
            let _ = if path.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
            Ok(json!({ "ok": true }))
        }
        "temp.clear" => {
            let _ = fs::remove_dir_all(root.join("tmp"));
            Ok(json!({ "ok": true }))
        }
        "transfer.download" => transfer_down(connectors, root, args),
        "transfer.upload" => transfer_up(connectors, root, args),
        "transfer.public" => transfer_public(connectors, root, args),
        _ => Err(invalid("name", &format!("{name} isn't an accounts call."))),
    }
}

fn access_of(args: &Value) -> IpcResult<Vec<String>> {
    arg(args, "access")
}

fn transfer_down(connectors: &Connectors, root: &Path, args: &Value) -> IpcResult<Value> {
    let id: String = arg(args, "connector")?;
    let access = access_of(args)?;
    let request: ApiRequest = arg(args, "request")?;
    let target = resolve_temp(root, &arg::<String>(args, "file")?)?;
    let wanted: Vec<&str> = access.iter().map(String::as_str).collect();
    let request = request.into_http(&id).map_err(IpcError::from)?;
    let response = connectors
        .request(&id, &wanted, request, MAX_TRANSFER)
        .map_err(IpcError::from)?;
    let bytes = response.body.len();
    if response.ok() {
        write_atomic(&target, &response.body).map_err(|error| io_error(&error))?;
    }
    Ok(json!({
        "status": response.status,
        "contentType": response.content_type,
        "bytes": bytes,
        "path": target.to_string_lossy(),
        "body": if response.ok() { String::new() } else { String::from_utf8_lossy(&response.body).into_owned() },
    }))
}

fn transfer_up(connectors: &Connectors, root: &Path, args: &Value) -> IpcResult<Value> {
    let id: String = arg(args, "connector")?;
    let access = access_of(args)?;
    let request: ApiRequest = arg(args, "request")?;
    let parts: Vec<Part> = arg(args, "parts")?;
    let content_type: String = arg(args, "contentType")?;
    let body = join_parts(root, &parts)?;
    let wanted: Vec<&str> = access.iter().map(String::as_str).collect();
    let mut http: HttpRequest = request.into_http(&id).map_err(IpcError::from)?;
    http.body = Some(Body::Bytes {
        content_type,
        data: body,
    });
    let response = connectors
        .request(&id, &wanted, http, super::session::DEFAULT_MAX_BYTES)
        .map_err(IpcError::from)?;
    Ok(response_json(response))
}

/// Whether the address is a plain https address on a name, which is where a service's own answer may send an upload
/// (Canvas hands out the address of its file storage). Numbers, this computer, local names, ports, and sign-in
/// details in the address are all refused.
pub(super) fn public_upload_host(text: &str) -> Option<String> {
    let url = url::Url::parse(text).ok()?;
    if url.scheme() != "https" || url.port().is_some() || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = match url.host()? {
        url::Host::Domain(name) => name.to_ascii_lowercase(),
        _ => return None,
    };
    let local = host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal");
    (host.contains('.') && !local).then_some(host)
}

/// A POST with no token to the upload address a service gave in an answer. The connector must be connected, so only
/// a feature the person has set up can send, and the bytes are whatever the feature joined.
fn transfer_public(connectors: &Connectors, root: &Path, args: &Value) -> IpcResult<Value> {
    let id: String = arg(args, "connector")?;
    let address: String = arg(args, "url")?;
    let parts: Vec<Part> = arg(args, "parts")?;
    let content_type: String = arg(args, "contentType")?;
    let connected = matches!(
        connectors.view(&id).map_err(IpcError::from)?.state,
        super::view::StateView::Connected { .. }
    );
    if !connected {
        return Err(invalid("connector", "That account isn't connected."));
    }
    if connectors.offline() {
        return Err(invalid("url", "OpenNote is working offline."));
    }
    let host = public_upload_host(&address).ok_or_else(|| invalid("url", "That upload address can't be used."))?;
    let mut http = HttpRequest::new(super::registry::Method::Post, address);
    http.body = Some(Body::Bytes {
        content_type,
        data: join_parts(root, &parts)?,
    });
    let policy = super::http::HostPolicy::new([host]);
    let response = connectors
        .0
        .http
        .send(&policy, &http, super::session::DEFAULT_MAX_BYTES)
        .map_err(|_| invalid("url", "The upload didn't go through."))?;
    Ok(response_json(response))
}

#[tauri::command]
pub async fn accounts_call(
    connectors: State<'_, Connectors>,
    paths: State<'_, Paths>,
    name: String,
    args: Value,
) -> IpcResult<Value> {
    let connectors = connectors.inner().clone();
    let root = paths.local.join(FOLDER);
    match spawn_blocking(move || call(&connectors, &root, &name, &args)).await {
        Ok(result) => result,
        Err(_) => Err(IpcError::new(codes::INTERNAL, "The account call stopped.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_public_upload_goes_only_to_a_plain_https_name() {
        assert_eq!(
            public_upload_host("https://Files.School.example/upload?id=1").as_deref(),
            Some("files.school.example")
        );
        for bad in [
            "http://files.school.example/up",
            "https://files.school.example:8443/up",
            "https://127.0.0.1/up",
            "https://[::1]/up",
            "https://10.0.0.5/up",
            "https://localhost/up",
            "https://printer.local/up",
            "https://intranet/up",
            "https://user:pass@files.school.example/up",
            "file:///C:/secret",
            "not a url",
        ] {
            assert_eq!(public_upload_host(bad), None, "{bad}");
        }
    }

    #[test]
    fn names_are_checked_before_they_reach_the_disk() {
        let root = tempfile::tempdir().expect("a folder");
        for bad in ["", "..", "a/../b", "/etc/passwd", "a\\b", ".hidden", "a/.b", "x:y", &"a".repeat(200)] {
            assert!(resolve_temp(root.path(), bad).is_err(), "{bad}");
        }
        let ok = resolve_temp(root.path(), "export/Page (1).docx").expect("a name");
        assert!(ok.starts_with(root.path().join("tmp")));
        assert!(state_file(root.path(), "readwise.cursor").is_ok());
        for bad in ["", "Upper", "a/b", "../x", ".x"] {
            assert!(state_file(root.path(), bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn an_absolute_path_passes_only_inside_the_temp_folder() {
        let root = tempfile::tempdir().expect("a folder");
        let tmp = root.path().join("tmp");
        fs::create_dir_all(&tmp).expect("makes");
        let inside = tmp.join("a.docx");
        fs::write(&inside, b"x").expect("writes");
        assert!(resolve_temp(root.path(), &inside.to_string_lossy()).is_ok());
        let outside = root.path().join("other.txt");
        fs::write(&outside, b"x").expect("writes");
        assert!(resolve_temp(root.path(), &outside.to_string_lossy()).is_err());
    }

    #[test]
    fn parts_join_text_bytes_and_a_slice_of_a_file() {
        let root = tempfile::tempdir().expect("a folder");
        let tmp = root.path().join("tmp");
        fs::create_dir_all(&tmp).expect("makes");
        fs::write(tmp.join("f.bin"), b"0123456789").expect("writes");
        let parts: Vec<Part> = serde_json::from_value(json!([
            { "kind": "text", "text": "a" },
            { "kind": "base64", "base64": "Yg==" },
            { "kind": "file", "file": "f.bin", "offset": 2, "length": 3 },
            { "kind": "file", "file": "f.bin", "offset": 8, "length": 99 },
        ]))
        .expect("parses");
        assert_eq!(join_parts(root.path(), &parts).expect("joins"), b"ab23489");
    }
}
