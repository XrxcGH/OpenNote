//! What the API asks of the notes: the [`Backend`] trait, which the app implements over its core and the tests
//! implement in memory, and the [`Approver`] trait, which asks the person in the app.

use serde::{Deserialize, Serialize};

use crate::grants::{Access, AppKind, Scope};

/// A notebook as the API lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookInfo {
    pub id: String,
    pub title: String,
}

/// A section. A locked section is listed, so an app can say why it can't use it, but nothing inside it is read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionInfo {
    pub id: String,
    pub notebook_id: String,
    pub title: String,
    pub locked: bool,
}

/// A page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub id: String,
    pub notebook_id: String,
    pub section_id: String,
    pub title: String,
    /// RFC 3339, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
}

/// A page's text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageText {
    pub page: PageInfo,
    /// The page as Markdown, with a line for each part that has no text, such as a drawing.
    pub markdown: String,
}

/// Where a notebook, section, or page is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    /// The notebook, section, or page itself.
    pub id: String,
    pub notebook_id: String,
    pub section_id: Option<String>,
    /// The node, or the section it is in, is locked.
    pub locked: bool,
    pub title: String,
}

/// A file a new page carries, such as a screenshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attachment {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// A page to add.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct NewPage {
    pub title: String,
    pub markdown: String,
    /// The web page or message it came from, kept as a link at the top.
    pub source_url: Option<String>,
    pub attachments: Vec<Attachment>,
}

/// A search result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub page: PageInfo,
    /// A few words around the match.
    #[serde(default)]
    pub snippet: String,
}

/// Why the notes couldn't do something.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackendError {
    NotFound,
    /// The page or its section is locked.
    Locked,
    /// The page is read-only, such as a page in a backup.
    ReadOnly,
    /// The request asked for something that can't be, such as an empty title.
    Invalid(String),
    /// Anything else. The message goes to the app's log, never to the caller.
    Failed(String),
}

/// The notes, as the API reaches them. Every method runs on a connection's thread.
pub trait Backend: Send + Sync {
    fn notebooks(&self) -> Result<Vec<NotebookInfo>, BackendError>;
    fn sections(&self, notebook: &str) -> Result<Vec<SectionInfo>, BackendError>;
    fn pages(&self, section: &str) -> Result<Vec<PageInfo>, BackendError>;
    /// Where any notebook, section, or page is.
    fn locate(&self, id: &str) -> Result<Location, BackendError>;
    fn read_page(&self, page: &str) -> Result<PageText, BackendError>;
    /// Adds a page at the end of a section. `author` is the app's name, which page history shows as
    /// "Added via <author>".
    fn create_page(&self, section: &str, page: NewPage, author: &str) -> Result<PageInfo, BackendError>;
    /// Adds Markdown at the end of a page, as one step of page history named "Changed via <author>".
    fn append(&self, page: &str, markdown: &str, author: &str) -> Result<PageInfo, BackendError>;
    /// Today's daily note, made if needed, with the Markdown added at the end.
    fn append_daily(&self, markdown: &str, author: &str) -> Result<PageInfo, BackendError>;
    /// The daily note's page, without making it: where [`Backend::append_daily`] would write.
    fn daily_target(&self) -> Result<Location, BackendError>;
    fn search(&self, text: &str, limit: usize) -> Result<Vec<SearchHit>, BackendError>;
    /// Runs a backup to the folder the person chose in Settings, and says where it went.
    fn backup(&self) -> Result<String, BackendError>;
}

/// What the person is asked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Question {
    /// A new app wants to connect.
    Connect {
        #[serde(rename = "appKind")]
        app_kind: AppKind,
        /// What it asks for. The person may give less.
        wants: Access,
    },
    /// An app wants to change notes: add a page, add to a page, or run a backup.
    Change {
        action: String,
        /// The page or section, by title.
        target: String,
    },
}

/// One question for the person, with an ID the answer names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    /// The app's name, as it gave it. The dialog says the name came from the app.
    pub app_name: String,
    pub question: Question,
}

/// The person's answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Decision {
    /// For a new app: what it gets. For a change: allowed once, or from now on without asking.
    Allow {
        #[serde(default)]
        access: Option<Access>,
        #[serde(default)]
        notebooks: Option<Scope>,
        #[serde(default)]
        always: bool,
    },
    Deny,
}

/// Asks the person in the app and waits for the answer. An unanswered question is a [`Decision::Deny`] after the
/// approver's own time limit, so a request never waits forever.
pub trait Approver: Send + Sync {
    fn ask(&self, request: ApprovalRequest) -> Decision;
}
