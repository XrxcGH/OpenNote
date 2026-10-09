//! An API over notes in memory, for this crate's tests, the `opennote` tool's tests, and the MCP tests. Nothing
//! here touches a real notes folder or the credential store.

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use crate::{
    access_log::AccessLog,
    backend::{
        ApprovalRequest, Approver, Backend, BackendError, Decision, Location, NewPage, NotebookInfo, PageInfo,
        PageText, SearchHit, SectionInfo,
    },
    grants::{lock, random_bytes, ConfigFile, Grants, MemorySecrets},
    routes::Api,
    server::Server,
};

#[derive(Debug, Clone)]
struct Page {
    info: PageInfo,
    markdown: String,
    /// What page history would show, such as "Added via opennote".
    history: Vec<String>,
}

/// Two notebooks: Biology (sections Cells and the locked Diary) and Work (section Meetings), with a page in each
/// unlocked section and one in the locked one.
pub struct MemoryBackend {
    notebooks: Vec<NotebookInfo>,
    sections: Vec<SectionInfo>,
    pages: Mutex<Vec<Page>>,
    next: Mutex<u32>,
}

impl Default for MemoryBackend {
    fn default() -> MemoryBackend {
        let notebook = |id: &str, title: &str| NotebookInfo {
            id: id.into(),
            title: title.into(),
        };
        let section = |id: &str, notebook: &str, title: &str, locked: bool| SectionInfo {
            id: id.into(),
            notebook_id: notebook.into(),
            title: title.into(),
            locked,
        };
        let page = |id: &str, notebook: &str, section: &str, title: &str, text: &str| Page {
            info: PageInfo {
                id: id.into(),
                notebook_id: notebook.into(),
                section_id: section.into(),
                title: title.into(),
                modified: None,
            },
            markdown: text.into(),
            history: Vec::new(),
        };
        MemoryBackend {
            notebooks: vec![notebook("nb-bio", "Biology"), notebook("nb-work", "Work")],
            sections: vec![
                section("s-cells", "nb-bio", "Cells", false),
                section("s-diary", "nb-bio", "Diary", true),
                section("s-meet", "nb-work", "Meetings", false),
            ],
            pages: Mutex::new(vec![
                page(
                    "p-mito",
                    "nb-bio",
                    "s-cells",
                    "Mitochondria",
                    "The powerhouse of the cell.",
                ),
                page(
                    "p-secret",
                    "nb-bio",
                    "s-diary",
                    "Dear diary",
                    "A secret about mitochondria.",
                ),
                page(
                    "p-standup",
                    "nb-work",
                    "s-meet",
                    "Standup",
                    "Mitochondria budget approved.",
                ),
            ]),
            next: Mutex::new(1),
        }
    }
}

impl MemoryBackend {
    /// What page history holds for a page.
    pub fn history(&self, page: &str) -> Vec<String> {
        lock(&self.pages)
            .iter()
            .find(|each| each.info.id == page)
            .map(|each| each.history.clone())
            .unwrap_or_default()
    }

    pub fn markdown(&self, page: &str) -> Option<String> {
        lock(&self.pages)
            .iter()
            .find(|each| each.info.id == page)
            .map(|each| each.markdown.clone())
    }

    pub fn page_count(&self) -> usize {
        lock(&self.pages).len()
    }

    fn section(&self, id: &str) -> Option<&SectionInfo> {
        self.sections.iter().find(|section| section.id == id)
    }
}

impl Backend for MemoryBackend {
    fn notebooks(&self) -> Result<Vec<NotebookInfo>, BackendError> {
        Ok(self.notebooks.clone())
    }

    fn sections(&self, notebook: &str) -> Result<Vec<SectionInfo>, BackendError> {
        Ok(self
            .sections
            .iter()
            .filter(|section| section.notebook_id == notebook)
            .cloned()
            .collect())
    }

    fn pages(&self, section: &str) -> Result<Vec<PageInfo>, BackendError> {
        if self.section(section).ok_or(BackendError::NotFound)?.locked {
            return Err(BackendError::Locked);
        }
        Ok(lock(&self.pages)
            .iter()
            .filter(|page| page.info.section_id == section)
            .map(|page| page.info.clone())
            .collect())
    }

    fn locate(&self, id: &str) -> Result<Location, BackendError> {
        if let Some(notebook) = self.notebooks.iter().find(|notebook| notebook.id == id) {
            return Ok(Location {
                id: id.into(),
                notebook_id: notebook.id.clone(),
                section_id: None,
                locked: false,
                title: notebook.title.clone(),
            });
        }
        if let Some(section) = self.section(id) {
            return Ok(Location {
                id: id.into(),
                notebook_id: section.notebook_id.clone(),
                section_id: Some(section.id.clone()),
                locked: section.locked,
                title: section.title.clone(),
            });
        }
        let pages = lock(&self.pages);
        let page = pages
            .iter()
            .find(|page| page.info.id == id)
            .ok_or(BackendError::NotFound)?;
        Ok(Location {
            id: id.into(),
            notebook_id: page.info.notebook_id.clone(),
            section_id: Some(page.info.section_id.clone()),
            locked: self
                .section(&page.info.section_id)
                .is_some_and(|section| section.locked),
            title: page.info.title.clone(),
        })
    }

    fn read_page(&self, page: &str) -> Result<PageText, BackendError> {
        let pages = lock(&self.pages);
        let found = pages
            .iter()
            .find(|each| each.info.id == page)
            .ok_or(BackendError::NotFound)?;
        if self
            .section(&found.info.section_id)
            .is_some_and(|section| section.locked)
        {
            return Err(BackendError::Locked);
        }
        Ok(PageText {
            page: found.info.clone(),
            markdown: format!("# {}\n\n{}", found.info.title, found.markdown),
        })
    }

    fn create_page(&self, section: &str, page: NewPage, author: &str) -> Result<PageInfo, BackendError> {
        let place = self.section(section).ok_or(BackendError::NotFound)?;
        if place.locked {
            return Err(BackendError::Locked);
        }
        let id = {
            let mut next = lock(&self.next);
            *next += 1;
            format!("p-new{}", *next)
        };
        let mut markdown = page.markdown;
        if let Some(url) = page.source_url {
            markdown = format!("Source: <{url}>\n\n{markdown}");
        }
        for attachment in &page.attachments {
            markdown.push_str(&format!("\n\n[{}]({} bytes)", attachment.name, attachment.bytes.len()));
        }
        let info = PageInfo {
            id,
            notebook_id: place.notebook_id.clone(),
            section_id: section.into(),
            title: page.title,
            modified: None,
        };
        lock(&self.pages).push(Page {
            info: info.clone(),
            markdown,
            history: vec![format!("Added via {author}")],
        });
        Ok(info)
    }

    fn append(&self, page: &str, markdown: &str, author: &str) -> Result<PageInfo, BackendError> {
        let mut pages = lock(&self.pages);
        let found = pages
            .iter_mut()
            .find(|each| each.info.id == page)
            .ok_or(BackendError::NotFound)?;
        found.markdown.push_str("\n\n");
        found.markdown.push_str(markdown);
        found.history.push(format!("Changed via {author}"));
        Ok(found.info.clone())
    }

    fn append_daily(&self, markdown: &str, author: &str) -> Result<PageInfo, BackendError> {
        let existing = lock(&self.pages)
            .iter()
            .find(|page| page.info.title == "Today")
            .map(|page| page.info.id.clone());
        match existing {
            Some(id) => self.append(&id, markdown, author),
            None => self.create_page(
                "s-meet",
                NewPage {
                    title: "Today".into(),
                    markdown: markdown.into(),
                    ..NewPage::default()
                },
                author,
            ),
        }
    }

    fn daily_target(&self) -> Result<Location, BackendError> {
        self.locate("s-meet")
    }

    fn search(&self, text: &str, limit: usize) -> Result<Vec<SearchHit>, BackendError> {
        let needle = text.to_lowercase();
        // Like the real index, it finds text in a locked section too; the API must leave those hits out.
        Ok(lock(&self.pages)
            .iter()
            .filter(|page| {
                page.markdown.to_lowercase().contains(&needle) || page.info.title.to_lowercase().contains(&needle)
            })
            .take(limit)
            .map(|page| SearchHit {
                page: page.info.clone(),
                snippet: page.markdown.chars().take(40).collect(),
            })
            .collect())
    }

    fn backup(&self) -> Result<String, BackendError> {
        Ok(r"D:\Backups\OpenNote".into())
    }
}

/// Answers each question with the next scripted decision, or no when the script runs out, and keeps the questions.
#[derive(Default)]
pub struct ScriptedApprover {
    answers: Mutex<VecDeque<Decision>>,
    asked: Mutex<Vec<ApprovalRequest>>,
}

impl ScriptedApprover {
    pub fn answer(&self, decision: Decision) {
        lock(&self.answers).push_back(decision);
    }

    pub fn asked(&self) -> Vec<ApprovalRequest> {
        lock(&self.asked).clone()
    }
}

impl Approver for ScriptedApprover {
    fn ask(&self, request: ApprovalRequest) -> Decision {
        lock(&self.asked).push(request);
        lock(&self.answers).pop_front().unwrap_or(Decision::Deny)
    }
}

/// A running API over [`MemoryBackend`], on a free port.
pub struct TestApi {
    pub server: Option<Server>,
    pub api: Arc<Api>,
    pub backend: Arc<MemoryBackend>,
    pub approver: Arc<ScriptedApprover>,
    pub secrets: Arc<MemorySecrets>,
    pub port: u16,
}

impl TestApi {
    pub fn start() -> TestApi {
        let backend = Arc::new(MemoryBackend::default());
        let approver = Arc::new(ScriptedApprover::default());
        let secrets = Arc::new(MemorySecrets::default());
        let grants = Arc::new(Grants::new(ConfigFile::memory(), secrets.clone()));
        let api = Arc::new(Api::new(
            grants,
            backend.clone(),
            approver.clone(),
            Arc::new(AccessLog::memory()),
            random_bytes(32),
        ));
        let server = Server::start(api.clone(), 0, None).expect("the test server starts");
        let port = server.port();
        TestApi {
            server: Some(server),
            api,
            backend,
            approver,
            secrets,
            port,
        }
    }

    /// The proof key as hex, as the credential store would hold it.
    pub fn proof_hex(&self) -> String {
        crate::hmac::hex(&self.api.proof_key())
    }

    pub fn stop(&mut self) {
        if let Some(server) = self.server.take() {
            server.stop();
        }
    }
}

impl Drop for TestApi {
    fn drop(&mut self) {
        self.stop();
    }
}
