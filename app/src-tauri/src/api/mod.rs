//! The local API in the app (crates/api; docs/help/local-api.md). With `api.local` on and "Let apps on this PC
//! connect" on in Settings, Privacy, App permissions, it listens on a port of `127.0.0.1` and on a named pipe of this
//! profile, and nowhere else. Off means no listener at all.
//!
//! - Grants and webhooks are in `api.json` beside the settings.
//!   Token hashes and webhook secrets are in Windows Credential Manager, through the connectors' credential store.
//! - Where it listens goes to `api-endpoint.json` in the local data folder, and the key that proves the listener is
//!   OpenNote's goes to the credential store, for the `opennote` tool. Both are removed when it stops.
//! - Questions for the person go to the interface as `api://event` events; App permissions answers them with
//!   `api_call("decide")`.
//! - Every access is in `api-access.log` in the log folder.
//!
//! One command, `api_call`, carries every method, like `shellqol_call`.

pub mod approver;
pub mod backend;
pub mod markdown;
pub mod webhooks;

use std::{
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock, PoisonError},
    time::Instant,
};

use opennote_api::{
    access_log::AccessLog,
    backend::Decision,
    client::{write_discovery, Discovery, DISCOVERY_FILE, PROOF_TARGET},
    grants::{random_bytes, Access, ConfigFile, Grants, Scope, SecretStore},
    hmac::hex,
    routes::{Api, Changed},
    server::Server,
    webhooks::{clean_hook, secret_target, Dispatcher, Webhook, BACKOFF, MAX_HOOKS},
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use self::{
    approver::{question_event, AppApprover},
    backend::{CoreBackend, Notes},
};
use crate::{
    connectors::Secret,
    ipc::{IpcError, IpcResult},
    paths::Paths,
    platform_flags,
};

/// The event channel of the local API.
pub const EVENT: &str = "api://event";

/// The connectors' credential store, as the API crate's [`SecretStore`].
pub struct Credentials(pub Arc<dyn crate::connectors::SecretStore>);

#[allow(clippy::result_unit_err)]
impl SecretStore for Credentials {
    fn put(&self, target: &str, secret: &str) -> Result<(), ()> {
        self.0.put(target, &Secret::new(secret)).map_err(|_| ())
    }

    fn get(&self, target: &str) -> Result<Option<String>, ()> {
        self.0
            .get(target)
            .map(|found| found.map(|secret| secret.expose().to_owned()))
            .map_err(|_| ())
    }

    fn delete(&self, target: &str) -> Result<(), ()> {
        self.0.delete(target).map_err(|_| ())
    }
}

/// The managed state of the local API.
pub struct ApiState {
    pub grants: Arc<Grants>,
    pub log: Arc<AccessLog>,
    pub approver: Arc<AppApprover>,
    secrets: Arc<dyn SecretStore>,
    api: OnceLock<Arc<Api>>,
    server: Mutex<Option<Server>>,
    discovery: PathBuf,
    pipe: String,
    /// The webhook sender and the watcher of saves, made at start-up when the flag is on.
    hooks: OnceLock<(Arc<Dispatcher>, Mutex<std::sync::mpsc::Sender<webhooks::Watch>>)>,
}

impl ApiState {
    pub fn new(paths: &Paths) -> ApiState {
        let secrets: Arc<dyn SecretStore> = Arc::new(Credentials(crate::connectors::platform_store()));
        ApiState {
            grants: Arc::new(Grants::new(
                ConfigFile::at(&paths.roaming.join("api.json")),
                secrets.clone(),
            )),
            log: Arc::new(AccessLog::at(&paths.logs.join("api-access.log"))),
            approver: Arc::default(),
            secrets,
            api: OnceLock::new(),
            server: Mutex::new(None),
            discovery: paths.local.join(DISCOVERY_FILE),
            pipe: format!("OpenNote-api-{}", paths.profile_key()),
            hooks: OnceLock::new(),
        }
    }

    fn api(&self, app: &AppHandle) -> Arc<Api> {
        self.api
            .get_or_init(|| {
                let notify_app = app.clone();
                let api = Api::new(
                    self.grants.clone(),
                    Arc::new(CoreBackend::new(Notes::App(app.clone()))),
                    self.approver.clone(),
                    self.log.clone(),
                    Vec::new(),
                )
                .on_change(move |what| {
                    let what = match what {
                        Changed::Grants => "grants",
                        Changed::Log => "log",
                    };
                    let _ = notify_app.emit(EVENT, json!({ "kind": "changed", "what": what }));
                });
                Arc::new(api)
            })
            .clone()
    }

    fn running(&self) -> Option<(u16, Option<String>)> {
        self.server
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .map(|server| (server.port(), server.pipe().map(str::to_owned)))
    }

    /// Starts the listeners, unless they run already.
    fn start(&self, app: &AppHandle) -> IpcResult<()> {
        let mut server = self.server.lock().unwrap_or_else(PoisonError::into_inner);
        if server.is_some() {
            return Ok(());
        }
        // A new key for each start: a client checks it before it sends a token.
        let key = random_bytes(32);
        let api = self.api(app);
        api.set_proof_key(key.clone());
        let port = self.grants.config().port;
        let started =
            Server::start(api, port, Some(&self.pipe)).map_err(|error| IpcError::new("io", error.to_string()))?;
        if started.port() != port {
            let chosen = started.port();
            let _ = self.grants.change(|config| config.port = chosen);
        }
        if self.secrets.put(PROOF_TARGET, &hex(&key)).is_err() {
            ::log::warn!("Couldn't store the local API's key; the opennote tool won't connect.");
        }
        let discovery = Discovery {
            port: started.port(),
            pipe: started.pipe().map(str::to_owned),
        };
        if let Err(error) = write_discovery(&self.discovery, &discovery) {
            ::log::warn!("Couldn't write where the local API listens: {error}");
        }
        ::log::info!("The local API listens on 127.0.0.1:{}.", started.port());
        *server = Some(started);
        Ok(())
    }

    /// Starts the webhook sender and the watcher of saves.
    fn start_hooks(&self, app: &AppHandle) {
        let notify_app = app.clone();
        let dispatcher = Arc::new(Dispatcher::start(
            self.grants.clone(),
            self.secrets.clone(),
            self.log.clone(),
            Arc::new(webhooks::HttpsPoster),
            BACKOFF.to_vec(),
            move || {
                let _ = notify_app.emit(EVENT, json!({ "kind": "changed", "what": "log" }));
            },
        ));
        let watch = webhooks::start_watcher(CoreBackend::new(Notes::App(app.clone())), dispatcher.clone());
        if self.hooks.set((dispatcher, Mutex::new(watch))).is_err() {
            return;
        }
        let state = app.clone();
        app.state::<crate::core_bridge::CoreBridge>()
            .on_saved(Box::new(move |page| {
                let api = state.state::<ApiState>();
                // Pages are read only when a hook would hear about them.
                if !api.grants.config().webhooks.iter().any(|hook| hook.enabled) {
                    return;
                }
                if let Some((_, watch)) = api.hooks.get() {
                    let _ = watch
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .send(webhooks::Watch::Saved(page.to_owned()));
                }
            }));
    }

    fn dispatcher(&self) -> IpcResult<Arc<Dispatcher>> {
        self.hooks
            .get()
            .map(|(dispatcher, _)| dispatcher.clone())
            .ok_or_else(|| IpcError::new("notRunning", "Webhooks aren't part of this build."))
    }

    /// Stops the listeners and removes what tells clients where they were.
    pub fn stop(&self) {
        let server = self.server.lock().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(server) = server {
            server.stop();
            let _ = std::fs::remove_file(&self.discovery);
            let _ = self.secrets.delete(PROOF_TARGET);
            ::log::info!("The local API stopped.");
        }
    }
}

/// Whether the API may run: the flag, and the person's choice.
fn wanted(app: &AppHandle, state: &ApiState) -> bool {
    platform_flags::is_on_for(app, platform_flags::API_LOCAL) && state.grants.config().enabled
}

/// Connects the approver to the interface and starts the listeners when they're wanted. Runs at start-up.
pub fn start(app: &AppHandle) {
    let state = app.state::<ApiState>();
    let (show, hide) = (app.clone(), app.clone());
    state.approver.connect(
        Arc::new(move |request| {
            let _ = show.emit(EVENT, question_event(request));
        }),
        Arc::new(move |id| {
            let _ = hide.emit(EVENT, json!({ "kind": "answered", "id": id }));
        }),
    );
    if platform_flags::is_on_for(app, platform_flags::API_LOCAL) {
        state.start_hooks(app);
    }
    if !wanted(app, &state) {
        return;
    }
    if let Err(error) = state.start(app) {
        ::log::warn!("The local API didn't start: {}", error.message);
    }
}

/// The command `opennote mcp` runs as, for "Copy MCP config": the tool in the app's `bin` folder.
fn tool_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let folder = exe.parent().map(PathBuf::from).unwrap_or_default();
    folder
        .join(crate::install::path_entry::CLI_DIR)
        .join(crate::install::path_entry::CLI_EXE)
}

/// The MCP configuration an assistant such as Claude Desktop reads, with the tool's full path.
pub fn mcp_config(tool: &std::path::Path) -> String {
    let config = json!({
        "mcpServers": {
            "opennote": {
                "command": tool.display().to_string(),
                "args": ["mcp"]
            }
        }
    });
    serde_json::to_string_pretty(&config).unwrap_or_default()
}

fn arg<T: serde::de::DeserializeOwned>(args: &Value, name: &str) -> IpcResult<T> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
        .map_err(|error| IpcError::invalid(name, &error.to_string()))
}

fn io(error: std::io::Error) -> IpcError {
    IpcError::new("io", error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppChange {
    id: String,
    access: Access,
    notebooks: Scope,
    ask_before_writes: bool,
}

/// One method of App permissions.
// checks-disable-next-line modifiability: one match over the command names, whose arms share its state; split it when it grows again
pub fn call(app: &AppHandle, state: &ApiState, method: &str, args: &Value) -> IpcResult<Value> {
    let changed = |what: &str| {
        let _ = app.emit(EVENT, json!({ "kind": "changed", "what": what }));
    };
    match method {
        "status" => {
            let running = state.running();
            Ok(json!({
                "available": platform_flags::is_on_for(app, platform_flags::API_LOCAL),
                "enabled": state.grants.config().enabled,
                "running": running.is_some(),
                "port": running.as_ref().map(|(port, _)| *port),
                "pipe": running.and_then(|(_, pipe)| pipe),
            }))
        }
        "setEnabled" => {
            let enabled: bool = arg(args, "enabled")?;
            state.grants.change(|config| config.enabled = enabled).map_err(io)?;
            if enabled && wanted(app, state) {
                state.start(app)?;
            } else {
                state.stop();
            }
            changed("status");
            call(app, state, "status", &Value::Null)
        }
        "apps" => Ok(json!(state.grants.apps())),
        "updateApp" => {
            let change: AppChange =
                serde_json::from_value(args.clone()).map_err(|error| IpcError::invalid("app", &error.to_string()))?;
            let found = state
                .grants
                .update(&change.id, change.access, change.notebooks, change.ask_before_writes)
                .map_err(io)?;
            changed("grants");
            Ok(json!(found))
        }
        "revoke" => {
            let id: String = arg(args, "id")?;
            let found = state.grants.revoke(&id).map_err(io)?;
            state.log.add(opennote_api::Entry::new(
                &id,
                "",
                "revoke",
                opennote_api::Outcome::Allowed,
            ));
            changed("grants");
            Ok(json!(found))
        }
        "log" => {
            let limit: Option<usize> = arg(args, "limit")?;
            Ok(json!(state.log.recent(limit.unwrap_or(200).min(500))))
        }
        "clearLog" => {
            state.log.clear();
            changed("log");
            Ok(Value::Null)
        }
        "pending" => Ok(json!(state.approver.pending())),
        "decide" => {
            let id: String = arg(args, "id")?;
            let decision: Decision = arg(args, "decision")?;
            Ok(json!(state.approver.decide(&id, decision)))
        }
        "pairCode" => {
            let access: Access = arg(args, "access")?;
            let notebooks: Scope = arg(args, "notebooks")?;
            let Some((port, _)) = state.running() else {
                return Err(IpcError::new(
                    "notRunning",
                    "Turn on Let apps on this PC connect first.",
                ));
            };
            let now = Instant::now();
            let (code, expires) = state.api(app).pairing.new_code(access, notebooks, now);
            let left = expires.saturating_duration_since(now).as_millis() as f64;
            Ok(json!({ "code": code, "port": port, "expiresAt": crate::boot::now_epoch_ms() + left }))
        }
        "cancelCode" => {
            state.api(app).pairing.cancel_code();
            Ok(Value::Null)
        }
        "webhooks" => Ok(json!(state.grants.config().webhooks)),
        "saveWebhook" => {
            let hook: Webhook = arg(args, "hook")?;
            let secret: Option<String> = arg(args, "secret")?;
            save_webhook(state, hook, secret).inspect(|_| changed("webhooks"))
        }
        "deleteWebhook" => {
            let id: String = arg(args, "id")?;
            let found = state
                .grants
                .change(|config| {
                    let before = config.webhooks.len();
                    config.webhooks.retain(|hook| hook.id != id);
                    before != config.webhooks.len()
                })
                .map_err(io)?;
            let _ = state.secrets.delete(&secret_target(&id));
            changed("webhooks");
            Ok(json!(found))
        }
        "testWebhook" => {
            let id: String = arg(args, "id")?;
            match state.dispatcher()?.test(&id) {
                Ok(status) => Ok(json!({ "status": status })),
                Err(_) => Ok(json!({ "status": null })),
            }
        }
        "cliStatus" => {
            let tool = tool_path();
            let folder = tool.parent().map(PathBuf::from).unwrap_or_default();
            Ok(json!({
                "installed": tool.is_file(),
                "onPath": tool.is_file() && crate::install::path_entry::contains(&folder),
                "folder": folder.display().to_string(),
            }))
        }
        "setCliPath" => {
            let on: bool = arg(args, "on")?;
            let tool = tool_path();
            let folder = tool.parent().map(PathBuf::from).unwrap_or_default();
            if on && !tool.is_file() {
                return Err(IpcError::new(
                    "notInstalled",
                    "The opennote command isn't installed yet.",
                ));
            }
            if on {
                crate::install::path_entry::add(&folder);
            } else {
                crate::install::path_entry::remove(&folder);
            }
            call(app, state, "cliStatus", &Value::Null)
        }
        "mcpConfig" => Ok(json!({ "config": mcp_config(&tool_path()), "toolInstalled": tool_path().is_file() })),
        _ => Err(IpcError::invalid("method", "isn't a local API method")),
    }
}

/// Saves a hook the person typed. A new hook without a secret gets a random one, returned this once so the person
/// can give it to the receiver; after that it is only in the credential store.
fn save_webhook(state: &ApiState, hook: Webhook, secret: Option<String>) -> IpcResult<Value> {
    let mut hook = clean_hook(hook).map_err(|why| IpcError::invalid("hook", why))?;
    let existing = state.grants.config().webhooks;
    let is_new = !existing.iter().any(|one| one.id == hook.id);
    if is_new {
        if existing.len() >= MAX_HOOKS {
            return Err(IpcError::invalid("hook", "can't be added: 20 webhooks is the most"));
        }
        hook.id = opennote_api::grants::random_hex(8);
    }
    let typed = secret
        .map(|secret| secret.trim().to_owned())
        .filter(|secret| !secret.is_empty());
    if typed
        .as_ref()
        .is_some_and(|secret| secret.len() > 256 || secret.chars().any(char::is_control))
    {
        return Err(IpcError::invalid(
            "secret",
            "must be one line of at most 256 characters",
        ));
    }
    let made = (is_new && typed.is_none()).then(|| opennote_api::grants::random_hex(32));
    if let Some(secret) = typed.as_ref().or(made.as_ref()) {
        state
            .secrets
            .put(&secret_target(&hook.id), secret)
            .map_err(|()| IpcError::new("store", "The credential store refused the secret."))?;
    }
    let saved = hook.clone();
    state
        .grants
        .change(|config| {
            config.webhooks.retain(|one| one.id != saved.id);
            config.webhooks.push(saved);
        })
        .map_err(io)?;
    Ok(json!({ "hook": hook, "newSecret": made }))
}

/// Every method of App permissions, in one command.
#[tauri::command]
pub async fn api_call(app: AppHandle, state: State<'_, ApiState>, method: String, args: Value) -> IpcResult<Value> {
    let _ = state;
    // Starting, stopping, and revoking touch the credential store and the disk, so they run off the command thread.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ApiState>();
        call(&app, &state, &method, &args)
    })
    .await
    .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mcp_config_names_the_tool_and_its_mcp_command() {
        let config = mcp_config(std::path::Path::new(
            r"C:\Users\Ada\AppData\Local\Programs\OpenNote\bin\opennote.exe",
        ));
        let json: Value = serde_json::from_str(&config).expect("json");
        assert_eq!(json["mcpServers"]["opennote"]["args"], json!(["mcp"]));
        assert!(json["mcpServers"]["opennote"]["command"]
            .as_str()
            .expect("a path")
            .ends_with(r"bin\opennote.exe"));
    }
}
