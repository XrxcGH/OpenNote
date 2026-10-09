// checks-disable-file modifiability: one table of routes with their checks; split it when it grows again

//! The API's endpoints, and the checks each request passes on its way: the `Host` and `Origin` headers, the
//! token, the grant's access and notebooks, locked sections, and the person's approval for a change. Every request
//! with a valid token, and every refusal of one, lands in the access log.
//!
//! | Method and path | Needs |
//! |---|---|
//! | `GET /v1/status`, `GET /v1/hello?nonce=` | nothing |
//! | `POST /v1/pair`, `POST /v1/pair/code` | the person's approval, or a code they made |
//! | `GET /v1/me` | a token |
//! | `GET /v1/notebooks`, `GET /v1/notebooks/{id}/sections` | any grant (names only) |
//! | `GET /v1/sections/{id}/pages`, `GET /v1/pages/{id}`, `GET /v1/search?q=`, `GET /v1/sections/{id}/export` | read |
//! | `POST /v1/sections/{id}/pages` | add pages |
//! | `POST /v1/pages/{id}/append`, `POST /v1/daily`, `POST /v1/backup` | read and write |

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};

use crate::{
    access_log::{AccessLog, Entry, Outcome},
    backend::{ApprovalRequest, Approver, Attachment, Backend, BackendError, Decision, Location, NewPage, Question},
    grants::{random_hex, Access, AppGrant, AppKind, Grants, NewGrant, Scope},
    guard::{host_ok, origin_of, Origin, Transport},
    hmac::hmac_hex,
    http::{Request, Response},
    pairing::{CodeRefusal, Pairing},
};

/// The API version in every path.
pub const VERSION: &str = "v1";

/// Limits on what a request may carry.
pub const MAX_TITLE: usize = 200;
pub const MAX_MARKDOWN: usize = 2 * 1024 * 1024;
pub const MAX_ATTACHMENTS: usize = 10;
pub const MAX_ATTACHMENT: usize = 15 * 1024 * 1024;
pub const MAX_URL: usize = 2048;
pub const MAX_SEARCH: usize = 50;

/// What changed, for the app's App permissions page to refresh.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Changed {
    Grants,
    Log,
}

type Notify = Arc<dyn Fn(Changed) + Send + Sync>;

/// Everything a request needs.
pub struct Api {
    pub grants: Arc<Grants>,
    pub backend: Arc<dyn Backend>,
    pub approver: Arc<dyn Approver>,
    pub log: Arc<AccessLog>,
    pub pairing: Arc<Pairing>,
    /// The key of `GET /v1/hello`, which proves to a client that this listener is OpenNote's before it sends a
    /// token. It is made for each start and kept in the credential store for the `opennote` tool.
    proof_key: std::sync::RwLock<Vec<u8>>,
    notify: Notify,
}

/// A refused or failed request, already shaped as its response.
type Refusal = Box<Response>;

fn refuse(status: u16, code: &str, message: &str) -> Refusal {
    Box::new(Response::error(status, code, message))
}

impl Api {
    pub fn new(
        grants: Arc<Grants>,
        backend: Arc<dyn Backend>,
        approver: Arc<dyn Approver>,
        log: Arc<AccessLog>,
        proof_key: Vec<u8>,
    ) -> Api {
        Api {
            grants,
            backend,
            approver,
            log,
            pairing: Arc::default(),
            proof_key: std::sync::RwLock::new(proof_key),
            notify: Arc::new(|_| {}),
        }
    }

    /// The key `GET /v1/hello` proves knowledge of.
    pub fn proof_key(&self) -> Vec<u8> {
        self.proof_key
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// A new key, for a new start of the listeners.
    pub fn set_proof_key(&self, key: Vec<u8>) {
        *self
            .proof_key
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = key;
    }

    /// Calls `notify` when grants or the log change.
    pub fn on_change(mut self, notify: impl Fn(Changed) + Send + Sync + 'static) -> Api {
        self.notify = Arc::new(notify);
        self
    }

    /// Answers one request that arrived over `transport`.
    pub fn handle(&self, request: &Request, transport: Transport) -> Response {
        if !host_ok(transport, request.header("host")) {
            return Response::error(421, "host", "This request isn't addressed to OpenNote on this PC.");
        }
        let origin = origin_of(request.header("origin"));
        if origin == Origin::Refused {
            return Response::error(403, "origin", "Web pages can't use OpenNote's local API.");
        }
        let mut response = if request.method == "OPTIONS" {
            preflight(&origin)
        } else {
            match self.route(request, &origin) {
                Ok(response) | Err(response) => response,
            }
        };
        if let Some(text) = self.cors_origin(&origin, request) {
            response.set("Access-Control-Allow-Origin", text);
            response.set("Vary", "Origin");
        }
        response
    }

    /// The origin a browser may read this answer from: any extension (its token is still bound to it), and a web
    /// origin only while it pairs as a mail add-in or once a grant is bound to it. Any other web page gets its
    /// refusal without the header, so its scripts can't even read why.
    fn cors_origin<'o>(&self, origin: &'o Origin, request: &Request) -> Option<&'o str> {
        match origin {
            Origin::Extension(text) => Some(text),
            Origin::Web(text) => {
                let pairing = request.path.trim_end_matches('/') == "/v1/pair/code";
                let bound = || {
                    self.grants.apps().iter().any(|app| {
                        app.origin
                            .as_deref()
                            .is_some_and(|bound| bound.eq_ignore_ascii_case(text))
                    })
                };
                (pairing || bound()).then_some(text.as_str())
            }
            Origin::None | Origin::Refused => None,
        }
    }

    fn route(&self, request: &Request, origin: &Origin) -> Result<Response, Response> {
        let segments = request
            .segments()
            .ok_or_else(|| Response::error(400, "path", "The path isn't valid."))?;
        let parts: Vec<&str> = segments.iter().map(String::as_str).collect();
        if parts.first() != Some(&VERSION) {
            return Err(Response::error(404, "notFound", "There's nothing at this path."));
        }
        let method = request.method.as_str();
        match (method, &parts[1..]) {
            ("GET", ["status"]) => return Ok(Response::json(200, &json!({ "app": "OpenNote", "api": 1 }))),
            ("GET", ["hello"]) => return Ok(self.hello(request)),
            ("POST", ["pair"]) => return self.pair_ask(request, origin).map_err(|refusal| *refusal),
            ("POST", ["pair", "code"]) => return self.pair_code(request, origin).map_err(|refusal| *refusal),
            _ => {}
        }
        let grant = self.authenticate(request, origin).map_err(|refusal| *refusal)?;
        let caller = Caller {
            api: self,
            grant: &grant,
        };
        let result = match (method, &parts[1..]) {
            ("GET", ["me"]) => Ok(Response::json(200, &me(&grant))),
            ("GET", ["notebooks"]) => caller.notebooks(),
            ("GET", ["notebooks", id, "sections"]) => caller.sections(id),
            ("GET", ["sections", id, "pages"]) => caller.pages(id),
            ("GET", ["pages", id]) => caller.read(id, request.query("format")),
            ("GET", ["search"]) => caller.search(request),
            ("GET", ["sections", id, "export"]) => caller.export(id),
            ("POST", ["sections", id, "pages"]) => caller.create(id, request),
            ("POST", ["pages", id, "append"]) => caller.append(id, request),
            ("POST", ["daily"]) => caller.daily(request),
            ("POST", ["backup"]) => caller.backup(),
            (_, ["me" | "notebooks" | "sections" | "pages" | "search" | "daily" | "backup", ..]) => {
                Err(refuse(405, "method", "This path doesn't take that method."))
            }
            _ => Err(refuse(404, "notFound", "There's nothing at this path.")),
        };
        result.map_err(|refusal| *refusal)
    }

    /// Proves this listener is OpenNote's: an HMAC of the client's nonce under the start's key.
    fn hello(&self, request: &Request) -> Response {
        let nonce = request.query("nonce").unwrap_or_default();
        if nonce.len() < 16 || nonce.len() > 128 || !nonce.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Response::error(400, "nonce", "Send a nonce of 16 to 128 hex characters.");
        }
        Response::json(200, &json!({ "proof": hmac_hex(&self.proof_key(), nonce.as_bytes()) }))
    }

    fn authenticate(&self, request: &Request, origin: &Origin) -> Result<AppGrant, Refusal> {
        let token = request
            .header("authorization")
            .and_then(|value| value.strip_prefix("Bearer "))
            .unwrap_or_default();
        let Some(grant) = self.grants.authenticate(token) else {
            self.log
                .add(Entry::new("-", "Unknown app", &action_name(request), Outcome::Refused).detail("noValidToken"));
            self.changed(Changed::Log);
            return Err(refuse(
                401,
                "token",
                "This app isn't connected to OpenNote, or its access was removed. Connect it again.",
            ));
        };
        let bound = match (origin, &grant.origin) {
            (Origin::None, None) => true,
            (Origin::Extension(text) | Origin::Web(text), Some(bound)) => text.eq_ignore_ascii_case(bound),
            _ => false,
        };
        if !bound {
            self.record(
                &grant,
                &action_name(request),
                Outcome::Refused,
                None,
                Some("wrongOrigin"),
            );
            return Err(refuse(403, "origin", "This token belongs to another app."));
        }
        self.grants.touch(&grant.id, crate::now_secs());
        Ok(grant)
    }

    fn record(
        &self,
        grant: &AppGrant,
        action: &str,
        outcome: Outcome,
        target: Option<&Location>,
        detail: Option<&str>,
    ) {
        self.record_id(
            grant,
            action,
            outcome,
            target.map(|place| (place.title.as_str(), place.id.as_str())),
            detail,
        );
    }

    fn record_id(
        &self,
        grant: &AppGrant,
        action: &str,
        outcome: Outcome,
        target: Option<(&str, &str)>,
        detail: Option<&str>,
    ) {
        let mut entry = Entry::new(&grant.id, &grant.name, action, outcome);
        if let Some((title, id)) = target {
            entry = entry.target(id, Some(title));
        }
        if let Some(detail) = detail {
            entry = entry.detail(detail);
        }
        self.log.add(entry);
        self.changed(Changed::Log);
    }

    fn changed(&self, what: Changed) {
        (self.notify)(what);
    }

    /// `POST /v1/pair`: a program asks to connect, and waits for the person's answer.
    fn pair_ask(&self, request: &Request, origin: &Origin) -> Result<Response, Refusal> {
        if *origin != Origin::None {
            return Err(refuse(
                403,
                "origin",
                "Extensions connect with a pairing code from App permissions.",
            ));
        }
        #[derive(Deserialize)]
        struct Body {
            name: String,
            kind: String,
        }
        let body: Body = json_body(request)?;
        let kind = AppKind::parse(&body.kind)
            .filter(|kind| matches!(kind, AppKind::App | AppKind::Cli | AppKind::Assistant))
            .ok_or_else(|| refuse(400, "kind", "The kind must be app, cli, or assistant."))?;
        let name = crate::grants::clean_name(&body.name);
        let _ticket = self.pairing.start_ask(Instant::now()).map_err(|why| {
            self.log
                .add(Entry::new("-", &name, "pair", Outcome::Refused).detail(why));
            refuse(
                429,
                "busy",
                "OpenNote is already asking about another app. Try again in a few minutes.",
            )
        })?;
        let question = ApprovalRequest {
            id: random_hex(8),
            app_name: name.clone(),
            question: Question::Connect {
                app_kind: kind,
                wants: Access::Read,
            },
        };
        match self.approver.ask(question) {
            Decision::Allow { access, notebooks, .. } => {
                let grant = NewGrant {
                    name,
                    kind,
                    // A new connection reads only, unless the person chose more in the dialog.
                    access: access.unwrap_or(Access::Read),
                    notebooks: notebooks.unwrap_or(Scope::Notebooks(Vec::new())),
                    ask_before_writes: true,
                    origin: None,
                };
                self.issue(grant)
            }
            Decision::Deny => {
                self.log
                    .add(Entry::new("-", &name, "pair", Outcome::Refused).detail("declined"));
                self.changed(Changed::Log);
                Err(refuse(403, "declined", "The person didn't allow this app to connect."))
            }
        }
    }

    /// `POST /v1/pair/code`: an extension or a mail add-in pairs with a code the person made in the app.
    fn pair_code(&self, request: &Request, origin: &Origin) -> Result<Response, Refusal> {
        #[derive(Deserialize)]
        struct Body {
            code: String,
            name: String,
            kind: String,
        }
        let body: Body = json_body(request)?;
        let kind = AppKind::parse(&body.kind)
            .filter(|kind| matches!(kind, AppKind::Clipper | AppKind::Mail | AppKind::App))
            .ok_or_else(|| refuse(400, "kind", "The kind must be clipper, mail, or app."))?;
        if matches!(origin, Origin::Web(_)) && kind != AppKind::Mail {
            return Err(refuse(403, "origin", "Only a mail add-in pairs from a web page."));
        }
        let name = crate::grants::clean_name(&body.name);
        match self.pairing.redeem(&body.code, Instant::now()) {
            Ok(code) => {
                let bound = match origin {
                    Origin::Extension(text) | Origin::Web(text) => Some(text.clone()),
                    _ => None,
                };
                let grant = NewGrant {
                    name,
                    kind,
                    access: code.access,
                    notebooks: code.notebooks,
                    // The person adds each clip by hand, so adding pages doesn't ask again. Anything more does.
                    ask_before_writes: code.access != Access::AddPages,
                    origin: bound,
                };
                self.issue(grant)
            }
            Err(refusal) => {
                let detail = if refusal == CodeRefusal::Wrong {
                    "wrongCode"
                } else {
                    "noCode"
                };
                self.log
                    .add(Entry::new("-", &name, "pair", Outcome::Refused).detail(detail));
                self.changed(Changed::Log);
                Err(refuse(
                    403,
                    detail,
                    "That pairing code doesn't work. Make a new one in OpenNote, in App permissions.",
                ))
            }
        }
    }

    fn issue(&self, grant: NewGrant) -> Result<Response, Refusal> {
        let (app, token) = self
            .grants
            .issue(grant, crate::now_secs())
            .map_err(|_| refuse(503, "store", "OpenNote couldn't save this app's access. Try again."))?;
        self.log.add(Entry::new(&app.id, &app.name, "pair", Outcome::Allowed));
        self.changed(Changed::Grants);
        self.changed(Changed::Log);
        Ok(Response::json(200, &json!({ "token": token, "app": me(&app) })))
    }
}

fn preflight(origin: &Origin) -> Response {
    if *origin == Origin::None {
        return Response::new(204);
    }
    let mut response = Response::new(204);
    response.set("Access-Control-Allow-Methods", "GET, POST");
    response.set("Access-Control-Allow-Headers", "authorization, content-type");
    response.set("Access-Control-Allow-Private-Network", "true");
    response.set("Access-Control-Max-Age", "600");
    response
}

/// A short name for the access log, from the method and the path's shape (never its IDs).
fn action_name(request: &Request) -> String {
    let path: Vec<&str> = request.path.split('/').filter(|part| !part.is_empty()).collect();
    match (request.method.as_str(), path.as_slice()) {
        ("GET", [_, "notebooks"]) => "notebooks.list",
        ("GET", [_, "notebooks", _, "sections"]) => "sections.list",
        ("GET", [_, "sections", _, "pages"]) => "pages.list",
        ("GET", [_, "pages", _]) => "page.read",
        ("GET", [_, "search"]) => "search",
        ("GET", [_, "sections", _, "export"]) => "section.export",
        ("POST", [_, "sections", _, "pages"]) => "page.create",
        ("POST", [_, "pages", _, "append"]) => "page.append",
        ("POST", [_, "daily"]) => "daily.append",
        ("POST", [_, "backup"]) => "backup",
        ("GET", [_, "me"]) => "me",
        _ => "other",
    }
    .to_owned()
}

fn me(app: &AppGrant) -> Value {
    json!({
        "id": app.id,
        "name": app.name,
        "kind": app.kind,
        "access": app.access,
        "notebooks": app.notebooks,
        "askBeforeWrites": app.ask_before_writes,
    })
}

fn json_body<T: DeserializeOwned>(request: &Request) -> Result<T, Refusal> {
    let json = request.header("content-type").is_some_and(|value| {
        value
            .split(';')
            .next()
            .is_some_and(|kind| kind.trim().eq_ignore_ascii_case("application/json"))
    });
    if !json {
        return Err(refuse(415, "contentType", "Send the body as application/json."));
    }
    serde_json::from_slice(&request.body).map_err(|_| refuse(400, "body", "The body isn't the JSON this path takes."))
}

fn backend_refusal(error: BackendError) -> Refusal {
    match error {
        BackendError::NotFound => refuse(404, "notFound", "There's no such notebook, section, or page."),
        BackendError::Locked => refuse(423, "locked", "That section is locked. Unlock it in OpenNote first."),
        BackendError::ReadOnly => refuse(409, "readOnly", "That page can't be changed."),
        BackendError::Invalid(why) => refuse(400, "invalid", &why),
        BackendError::Failed(why) => {
            log::warn!("The local API couldn't finish a request: {why}");
            refuse(503, "failed", "OpenNote couldn't do that just now. Try again.")
        }
    }
}

/// A request from an app with a valid token.
struct Caller<'a> {
    api: &'a Api,
    grant: &'a AppGrant,
}

impl Caller<'_> {
    fn allowed(&self, action: &str, target: Option<&Location>) {
        self.api.record(self.grant, action, Outcome::Allowed, target, None);
    }

    fn refused(&self, action: &str, target: Option<&Location>, detail: &str, refusal: Refusal) -> Refusal {
        self.api
            .record(self.grant, action, Outcome::Refused, target, Some(detail));
        refusal
    }

    fn need(&self, action: &str, ok: bool) -> Result<(), Refusal> {
        if ok {
            return Ok(());
        }
        Err(self.refused(
            action,
            None,
            "notInGrant",
            refuse(
                403,
                "access",
                "This app's access doesn't include that. Change it in App permissions.",
            ),
        ))
    }

    /// Where `id` is, after checking that the grant covers it and it isn't locked.
    fn place(&self, action: &str, id: &str) -> Result<Location, Refusal> {
        let place = self.api.backend.locate(id).map_err(|error| {
            self.api
                .record(self.grant, action, Outcome::Refused, None, Some("notFound"));
            backend_refusal(error)
        })?;
        if !self.grant.notebooks.covers(&place.notebook_id) {
            return Err(self.refused(
                action,
                None,
                "notInGrant",
                refuse(
                    403,
                    "notInGrant",
                    "This app can't use that notebook. Change it in App permissions.",
                ),
            ));
        }
        if place.locked {
            return Err(self.refused(action, Some(&place), "locked", backend_refusal(BackendError::Locked)));
        }
        Ok(place)
    }

    /// Asks the person before a change, unless the grant says not to.
    fn approve(&self, action: &str, what: &str, place: &Location) -> Result<(), Refusal> {
        if !self.grant.ask_before_writes {
            return Ok(());
        }
        let question = ApprovalRequest {
            id: random_hex(8),
            app_name: self.grant.name.clone(),
            question: Question::Change {
                action: what.to_owned(),
                target: place.title.clone(),
            },
        };
        match self.api.approver.ask(question) {
            Decision::Allow { always, .. } => {
                if always {
                    let grant = self.grant;
                    let _ = self
                        .api
                        .grants
                        .update(&grant.id, grant.access, grant.notebooks.clone(), false);
                    self.api.changed(Changed::Grants);
                }
                Ok(())
            }
            Decision::Deny => Err(self.refused(
                action,
                Some(place),
                "declined",
                refuse(403, "declined", "The person didn't allow this change."),
            )),
        }
    }

    fn notebooks(&self) -> Result<Response, Refusal> {
        let notebooks = self.api.backend.notebooks().map_err(backend_refusal)?;
        let mine: Vec<_> = notebooks
            .into_iter()
            .filter(|notebook| self.grant.notebooks.covers(&notebook.id))
            .collect();
        self.allowed("notebooks.list", None);
        Ok(Response::json(200, &json!({ "notebooks": mine })))
    }

    fn sections(&self, notebook: &str) -> Result<Response, Refusal> {
        let place = self.place("sections.list", notebook)?;
        let sections = self.api.backend.sections(notebook).map_err(backend_refusal)?;
        self.allowed("sections.list", Some(&place));
        Ok(Response::json(200, &json!({ "sections": sections })))
    }

    fn pages(&self, section: &str) -> Result<Response, Refusal> {
        self.need("pages.list", self.grant.access.can_read())?;
        let place = self.place("pages.list", section)?;
        let pages = self.api.backend.pages(section).map_err(backend_refusal)?;
        self.allowed("pages.list", Some(&place));
        Ok(Response::json(200, &json!({ "pages": pages })))
    }

    fn read(&self, page: &str, format: Option<&str>) -> Result<Response, Refusal> {
        self.need("page.read", self.grant.access.can_read())?;
        let place = self.place("page.read", page)?;
        let text = self.api.backend.read_page(page).map_err(backend_refusal)?;
        self.allowed("page.read", Some(&place));
        if format == Some("md") {
            return Ok(Response::text(200, "text/markdown; charset=utf-8", &text.markdown));
        }
        Ok(Response::json(200, &json!(text)))
    }

    fn search(&self, request: &Request) -> Result<Response, Refusal> {
        self.need("search", self.grant.access.can_read())?;
        let text = request.query("q").unwrap_or_default().trim();
        if text.is_empty() || text.chars().count() > 500 {
            return Err(refuse(
                400,
                "query",
                "Send the words to search for as q, up to 500 characters.",
            ));
        }
        let limit = request
            .query("limit")
            .and_then(|limit| limit.parse::<usize>().ok())
            .unwrap_or(20)
            .clamp(1, MAX_SEARCH);
        let hits = self.api.backend.search(text, limit * 3).map_err(backend_refusal)?;
        let mut locked: HashMap<String, bool> = HashMap::new();
        let mut mine = Vec::new();
        for hit in hits {
            if !self.grant.notebooks.covers(&hit.page.notebook_id) {
                continue;
            }
            let section = hit.page.section_id.clone();
            let is_locked = *locked
                .entry(section.clone())
                .or_insert_with(|| self.api.backend.locate(&section).map_or(true, |place| place.locked));
            if !is_locked {
                mine.push(hit);
            }
            if mine.len() == limit {
                break;
            }
        }
        self.api.record_id(
            self.grant,
            "search",
            Outcome::Allowed,
            None,
            Some(&format!("{} results", mine.len())),
        );
        Ok(Response::json(200, &json!({ "hits": mine })))
    }

    fn export(&self, section: &str) -> Result<Response, Refusal> {
        self.need("section.export", self.grant.access.can_read())?;
        let place = self.place("section.export", section)?;
        let pages = self.api.backend.pages(section).map_err(backend_refusal)?;
        let mut out = Vec::with_capacity(pages.len());
        for page in pages {
            out.push(self.api.backend.read_page(&page.id).map_err(backend_refusal)?);
        }
        self.allowed("section.export", Some(&place));
        Ok(Response::json(200, &json!({ "section": place.title, "pages": out })))
    }

    fn create(&self, section: &str, request: &Request) -> Result<Response, Refusal> {
        self.need("page.create", self.grant.access.can_add_pages())?;
        let page = new_page(json_body(request)?)?;
        let place = self.place("page.create", section)?;
        if place.section_id.as_deref() != Some(section) {
            return Err(refuse(
                400,
                "section",
                "Pages go into a section. That ID isn't a section.",
            ));
        }
        self.approve(
            "page.create",
            &format!("add the page \u{201c}{}\u{201d}", page.title),
            &place,
        )?;
        let created = self
            .api
            .backend
            .create_page(section, page, &self.grant.name)
            .map_err(|error| self.failed("page.create", &place, error))?;
        self.api.record_id(
            self.grant,
            "page.create",
            Outcome::Allowed,
            Some((&created.title, &created.id)),
            None,
        );
        Ok(Response::json(201, &json!({ "page": created })))
    }

    fn append(&self, page: &str, request: &Request) -> Result<Response, Refusal> {
        self.need("page.append", self.grant.access.can_change_pages())?;
        let markdown = markdown_of(json_body(request)?)?;
        let place = self.place("page.append", page)?;
        self.approve("page.append", "add to this page", &place)?;
        let changed = self
            .api
            .backend
            .append(page, &markdown, &self.grant.name)
            .map_err(|error| self.failed("page.append", &place, error))?;
        self.allowed("page.append", Some(&place));
        Ok(Response::json(200, &json!({ "page": changed })))
    }

    fn daily(&self, request: &Request) -> Result<Response, Refusal> {
        self.need("daily.append", self.grant.access.can_change_pages())?;
        let markdown = markdown_of(json_body(request)?)?;
        let place = self.api.backend.daily_target().map_err(backend_refusal)?;
        if !self.grant.notebooks.covers(&place.notebook_id) {
            return Err(self.refused(
                "daily.append",
                None,
                "notInGrant",
                refuse(
                    403,
                    "notInGrant",
                    "This app can't use the notebook that holds the daily notes.",
                ),
            ));
        }
        if place.locked {
            return Err(self.refused(
                "daily.append",
                Some(&place),
                "locked",
                backend_refusal(BackendError::Locked),
            ));
        }
        self.approve("daily.append", "add to today's daily note", &place)?;
        let page = self
            .api
            .backend
            .append_daily(&markdown, &self.grant.name)
            .map_err(|error| self.failed("daily.append", &place, error))?;
        self.api.record_id(
            self.grant,
            "daily.append",
            Outcome::Allowed,
            Some((&page.title, &page.id)),
            None,
        );
        Ok(Response::json(200, &json!({ "page": page })))
    }

    fn backup(&self) -> Result<Response, Refusal> {
        self.need(
            "backup",
            self.grant.access.can_change_pages() && self.grant.notebooks == Scope::All,
        )?;
        let place = Location {
            id: String::new(),
            notebook_id: String::new(),
            section_id: None,
            locked: false,
            title: "every notebook".to_owned(),
        };
        self.approve("backup", "back up every notebook now", &place)?;
        let folder = self
            .api
            .backend
            .backup()
            .map_err(|error| self.failed("backup", &place, error))?;
        self.allowed("backup", None);
        Ok(Response::json(200, &json!({ "folder": folder })))
    }

    fn failed(&self, action: &str, place: &Location, error: BackendError) -> Refusal {
        let detail = match &error {
            BackendError::Locked => "locked",
            BackendError::NotFound => "notFound",
            _ => "failed",
        };
        self.api
            .record(self.grant, action, Outcome::Failed, Some(place), Some(detail));
        backend_refusal(error)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageBody {
    title: String,
    #[serde(default)]
    markdown: String,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    attachments: Vec<AttachmentBody>,
}

#[derive(Deserialize)]
struct AttachmentBody {
    name: String,
    mime: String,
    /// Base64.
    data: String,
}

#[derive(Deserialize)]
struct MarkdownBody {
    markdown: String,
}

fn markdown_of(body: MarkdownBody) -> Result<String, Refusal> {
    if body.markdown.trim().is_empty() || body.markdown.len() > MAX_MARKDOWN {
        return Err(refuse(400, "markdown", "Send between 1 byte and 2 MB of Markdown."));
    }
    Ok(clean_text(&body.markdown))
}

/// Text without NUL and other control characters but tabs and line breaks.
fn clean_text(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .collect()
}

/// Whether a source address may be kept on a page: `http` or `https`, one line, not too long.
pub fn source_ok(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && url.len() <= MAX_URL
        && !url.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// A safe file name: no folders, no characters Windows refuses, at most 100 characters.
pub fn file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"|?*".contains(*c))
        .take(100)
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_owned();
    if cleaned.is_empty() {
        "attachment".to_owned()
    } else {
        cleaned
    }
}

fn new_page(body: PageBody) -> Result<NewPage, Refusal> {
    let title = clean_text(&body.title).replace(['\n', '\t'], " ").trim().to_owned();
    if title.is_empty() || title.chars().count() > MAX_TITLE {
        return Err(refuse(400, "title", "A page needs a title of 1 to 200 characters."));
    }
    if body.markdown.len() > MAX_MARKDOWN {
        return Err(refuse(400, "markdown", "The Markdown is larger than 2 MB."));
    }
    if body.source_url.as_deref().is_some_and(|url| !source_ok(url)) {
        return Err(refuse(400, "sourceUrl", "The source must be an http or https address."));
    }
    if body.attachments.len() > MAX_ATTACHMENTS {
        return Err(refuse(400, "attachments", "A page can carry at most 10 attachments."));
    }
    let mut attachments = Vec::with_capacity(body.attachments.len());
    for attachment in body.attachments {
        let mime = attachment.mime.trim().to_ascii_lowercase();
        let mime_ok = mime.len() <= 100
            && mime.split_once('/').is_some_and(|(kind, sub)| {
                !kind.is_empty()
                    && !sub.is_empty()
                    && mime.bytes().all(|b| b.is_ascii_alphanumeric() || b"/.+-".contains(&b))
            });
        if !mime_ok || attachment.data.len() > MAX_ATTACHMENT / 3 * 4 + 4 {
            return Err(refuse(
                400,
                "attachments",
                "An attachment is too large or has no valid type.",
            ));
        }
        let bytes = STANDARD
            .decode(attachment.data.as_bytes())
            .map_err(|_| refuse(400, "attachments", "An attachment isn't valid base64."))?;
        attachments.push(Attachment {
            name: file_name(&attachment.name),
            mime,
            bytes,
        });
    }
    Ok(NewPage {
        title,
        markdown: clean_text(&body.markdown),
        source_url: body.source_url,
        attachments,
    })
}

/// How long the app gives the person to answer a question.
pub const APPROVAL_WAIT: Duration = Duration::from_secs(120);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_sources_and_file_names_safe() {
        assert!(source_ok("https://example.org/a?b=c"));
        assert!(source_ok("http://intranet/page"));
        for bad in [
            "javascript:alert(1)",
            "file:///c:/x",
            "https://a b",
            "data:text/html,x",
            "https://x\n",
        ] {
            assert!(!source_ok(bad), "{bad}");
        }
        assert_eq!(file_name("..\\..\\Windows\\evil.exe"), "evil.exe");
        assert_eq!(file_name("a<b>:c?.png"), "abc.png");
        assert_eq!(file_name("..."), "attachment");
        assert_eq!(file_name(".htaccess"), "htaccess");
    }

    #[test]
    fn names_actions_by_the_shape_of_the_path() {
        let request = |method: &str, path: &str| Request {
            method: method.into(),
            path: path.into(),
            ..Request::default()
        };
        assert_eq!(action_name(&request("GET", "/v1/pages/p1")), "page.read");
        assert_eq!(action_name(&request("POST", "/v1/sections/s1/pages")), "page.create");
        assert_eq!(action_name(&request("DELETE", "/v1/pages/p1")), "other");
    }
}
