//! Finding OpenNote and getting access. The app writes where it listens to `api-endpoint.json` and keeps the key
//! that proves it is OpenNote in Credential Manager. The tool checks that proof before it sends its own key, asks
//! for access the first time (the person answers in OpenNote), and keeps its key in Credential Manager.

use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use opennote_api::{
    client::{from_hex, read_discovery, Client, ClientError, Endpoint, DISCOVERY_FILE, PROOF_TARGET},
    http::Response,
};
use serde_json::{json, Value};

use crate::store::{Secrets, CLI_TOKEN};

/// Everything the tool reads from this PC, so tests can give it a test server instead.
#[derive(Clone)]
pub struct Env {
    /// Where OpenNote listens, when it does.
    pub endpoint: Option<Endpoint>,
    /// The key the listener must prove it knows.
    pub proof_key: Option<Vec<u8>>,
    pub secrets: Arc<dyn Secrets>,
}

/// The app's local data folder: `%LOCALAPPDATA%\OpenNote`, or `local` inside `OPENNOTE_PROFILE_DIR`.
pub fn local_folder() -> Option<PathBuf> {
    if let Some(profile) = std::env::var_os("OPENNOTE_PROFILE_DIR").filter(|dir| !dir.is_empty()) {
        return Some(PathBuf::from(profile).join("local"));
    }
    std::env::var_os("LOCALAPPDATA").map(|dir| PathBuf::from(dir).join("OpenNote"))
}

impl Env {
    /// What this PC says: the discovery file and Credential Manager.
    #[cfg(windows)]
    pub fn from_system() -> Env {
        let secrets: Arc<dyn Secrets> = Arc::new(crate::store::CredentialManager);
        Env::from_folder(local_folder().as_deref(), secrets)
    }

    /// The listener named in `folder`'s discovery file, with the proof key from `secrets`.
    pub fn from_folder(folder: Option<&Path>, secrets: Arc<dyn Secrets>) -> Env {
        let discovery = folder.and_then(|folder| read_discovery(&folder.join(DISCOVERY_FILE)));
        let endpoint = discovery.map(|found| match found.pipe {
            Some(pipe) if cfg!(windows) && pipe_name_ok(&pipe) => Endpoint::Pipe(pipe),
            _ => Endpoint::Tcp(found.port),
        });
        let proof_key = secrets.get(PROOF_TARGET).and_then(|hex| from_hex(&hex));
        Env {
            endpoint,
            proof_key,
            secrets,
        }
    }
}

/// A pipe name as the app makes it: `OpenNote-api-` and hex.
fn pipe_name_ok(name: &str) -> bool {
    name.strip_prefix("OpenNote-api-")
        .is_some_and(|rest| !rest.is_empty() && rest.len() <= 64 && rest.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// Why a command didn't finish, as the person reads it.
#[derive(Debug)]
pub enum CliError {
    /// Wrong arguments: the message, and the help applies.
    Usage(String),
    /// OpenNote isn't running, or isn't letting apps connect.
    NotRunning,
    /// Something answered that isn't OpenNote.
    NotOpenNote,
    /// The person said no, or access was removed.
    NoAccess(String),
    /// OpenNote answered with a refusal.
    Refused {
        code: String,
        message: String,
    },
    Io(String),
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Usage(message) => write!(f, "{message} Run `opennote --help` to see the commands."),
            Self::NotRunning => f.write_str(
                "OpenNote isn't running, or apps can't connect. Open OpenNote, then Settings, App permissions, \
                 and turn on Let apps on this PC connect.",
            ),
            Self::NotOpenNote => f.write_str("The program listening isn't OpenNote, so nothing was sent to it."),
            Self::NoAccess(message) | Self::Refused { message, .. } | Self::Io(message) => f.write_str(message),
        }
    }
}

impl CliError {
    /// The exit code: 2 for usage, 3 when OpenNote can't be reached, 4 for no access, 1 otherwise.
    pub fn exit_code(&self) -> i32 {
        match self {
            Self::Usage(_) => 2,
            Self::NotRunning | Self::NotOpenNote => 3,
            Self::NoAccess(_) => 4,
            Self::Refused { code, .. } if matches!(code.as_str(), "access" | "notInGrant" | "declined" | "locked") => 4,
            _ => 1,
        }
    }
}

impl From<ClientError> for CliError {
    fn from(error: ClientError) -> CliError {
        match error {
            ClientError::NotRunning => CliError::NotRunning,
            ClientError::NotOpenNote => CliError::NotOpenNote,
            ClientError::Io(error) => CliError::Io(format!("The connection to OpenNote failed: {error}")),
        }
    }
}

/// How the tool connects: its key's name in Credential Manager, and the name and kind OpenNote shows.
#[derive(Debug, Clone)]
pub struct Identity {
    pub token_name: String,
    pub app_name: String,
    /// `cli` or `assistant`.
    pub kind: &'static str,
}

impl Identity {
    pub fn cli() -> Identity {
        Identity {
            token_name: CLI_TOKEN.to_owned(),
            app_name: "opennote command".to_owned(),
            kind: "cli",
        }
    }
}

/// A checked connection with a key.
pub struct Session {
    pub client: Client,
    env: Env,
    identity: Identity,
}

/// Turns a refusal into the error the person reads.
pub fn refusal(response: &Response) -> CliError {
    let body = response.json_body().unwrap_or(Value::Null);
    let code = body["error"].as_str().unwrap_or("failed").to_owned();
    let message = body["message"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("OpenNote answered with status {}.", response.status));
    CliError::Refused { code, message }
}

impl Session {
    /// Finds OpenNote, checks it is OpenNote, and gets a key: the stored one, or a new one after the person
    /// approves in OpenNote. `say` hears what the person should know while they wait.
    pub fn open(env: &Env, identity: Identity, say: &mut dyn Write) -> Result<Session, CliError> {
        let endpoint = env.endpoint.clone().ok_or(CliError::NotRunning)?;
        let key = env.proof_key.clone().ok_or(CliError::NotRunning)?;
        let bare = Client::new(endpoint);
        bare.verify(&key)?;
        let token = match env.secrets.get(&identity.token_name) {
            Some(token) => token,
            None => {
                let _ = writeln!(
                    say,
                    "Asking OpenNote for access as \u{201c}{}\u{201d}. Answer in the OpenNote window.",
                    identity.app_name
                );
                let answer = bare.post("/v1/pair", &json!({ "name": identity.app_name, "kind": identity.kind }))?;
                if answer.status != 200 {
                    let error = refusal(&answer);
                    return Err(match error {
                        CliError::Refused { code, .. } if code == "declined" => {
                            CliError::NoAccess("OpenNote didn't give access. Nothing was changed.".into())
                        }
                        other => other,
                    });
                }
                let token = answer
                    .json_body()
                    .and_then(|body| body["token"].as_str().map(str::to_owned))
                    .ok_or_else(|| CliError::Io("OpenNote's answer had no key.".into()))?;
                if !env.secrets.put(&identity.token_name, &token) {
                    let _ = writeln!(
                        say,
                        "Couldn't save the key in Credential Manager, so OpenNote will ask again next time."
                    );
                }
                token
            }
        };
        Ok(Session {
            client: bare.with_token(Some(token)),
            env: env.clone(),
            identity,
        })
    }

    /// Sends a request; a refused key is forgotten, so the next run asks again.
    pub fn call(&self, response: Result<Response, ClientError>) -> Result<Value, CliError> {
        let response = response?;
        if response.status == 401 {
            self.env.secrets.delete(&self.identity.token_name);
            return Err(CliError::NoAccess(
                "This tool's access was removed in OpenNote. Run the command again to ask for access.".into(),
            ));
        }
        if !(200..300).contains(&response.status) {
            return Err(refusal(&response));
        }
        if response
            .header("content-type")
            .is_some_and(|kind| kind.starts_with("text/"))
        {
            return Ok(Value::String(String::from_utf8_lossy(&response.body).into_owned()));
        }
        Ok(response.json_body().unwrap_or(Value::Null))
    }

    pub fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, CliError> {
        self.call(self.client.get(path, query))
    }

    pub fn post(&self, path: &str, body: &Value) -> Result<Value, CliError> {
        self.call(self.client.post(path, body))
    }

    /// Forgets the key. OpenNote keeps the grant until the person revokes it.
    pub fn forget(env: &Env, identity: &Identity) {
        env.secrets.delete(&identity.token_name);
    }
}

/// A path segment from an ID the person typed: IDs are letters, digits, and dashes.
pub fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_only_pipe_names_and_ids_the_app_makes() {
        assert!(pipe_name_ok("OpenNote-api-0123abcd"));
        assert!(!pipe_name_ok("OpenNote-api-"));
        assert!(!pipe_name_ok(r"OpenNote-api-..\evil"));
        assert!(!pipe_name_ok("other"));
        assert!(id_ok("01k6f00000000000000000b001"));
        assert!(!id_ok("../x"));
        assert!(!id_ok(""));
    }
}
