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

/// One part of a page, as `inspect_page` describes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockSummary {
    pub id: String,
    /// text, ink, image, file, table, or another kind.
    pub kind: String,
    pub chars: usize,
    pub words: usize,
    /// The first line of its text, at most 80 characters.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub first_line: String,
}

/// One entry of page history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    /// Such as "Changed via opennote command (Claude, copyedit)", or empty for an unnamed save.
    pub label: String,
    /// When it was saved, RFC 3339, when known.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub saved: String,
}

/// A page's parts, so an agent can check that a change landed as it meant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInspection {
    pub page: PageInfo,
    pub blocks: Vec<BlockSummary>,
    /// The Markdown headings, in order, with their `#`s.
    pub headings: Vec<String>,
    pub words: usize,
    /// The newest entries of page history first, at most 10.
    pub history: Vec<HistoryEntry>,
}

/// The words in a text.
pub fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

/// The headings of Markdown text.
pub fn headings_of(markdown: &str) -> Vec<String> {
    markdown
        .lines()
        .map(str::trim_start)
        .filter(|line| {
            let hashes = line.bytes().take_while(|b| *b == b'#').count();
            (1..=6).contains(&hashes) && line[hashes..].starts_with(' ')
        })
        .map(|line| line.chars().take(200).collect())
        .collect()
}

/// A block's summary from its kind and text.
pub fn block_summary(id: &str, kind: &str, text: &str) -> BlockSummary {
    BlockSummary {
        id: id.to_owned(),
        kind: kind.to_owned(),
        chars: text.chars().count(),
        words: word_count(text),
        first_line: text.lines().next().unwrap_or_default().chars().take(80).collect(),
    }
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

    /// A page's parts and its latest history. By default, one text part from [`Backend::read_page`].
    fn inspect(&self, page: &str) -> Result<PageInspection, BackendError> {
        let text = self.read_page(page)?;
        Ok(PageInspection {
            blocks: vec![block_summary("", "text", &text.markdown)],
            headings: headings_of(&text.markdown),
            words: word_count(&text.markdown),
            page: text.page,
            history: Vec::new(),
        })
    }

    /// The page's strokes as polylines in page units, for `render_page`.
    fn ink(&self, page: &str) -> Result<Vec<crate::render::Polyline>, BackendError> {
        let _ = page;
        Err(BackendError::Invalid("This build of OpenNote can't draw pages.".into()))
    }
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
