//! The journal thread's loop: commands in order, and a flush within the group commit interval of the first
//! unflushed record (plan 8.2).

use std::collections::HashMap;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Instant;

use super::page::PageJournal;
use super::tree::TreeState;
use super::{BaseSnapshot, JournalConfig, JournalMeta, PageShared, TreeShared};
use crate::error::{FsError, FsErrorKind, JournalError};
use crate::id::{PageId, RevisionId};
use crate::store::fs::Durability;
use crate::store::layout::NotebookKey;

/// A request to the journal thread. Records arrive already framed and numbered.
pub enum Command {
    OpenPage {
        key: NotebookKey,
        page: PageId,
        meta: JournalMeta,
        base: BaseSnapshot,
        reply: Sender<Result<(u64, Arc<PageShared>), JournalError>>,
    },
    Append {
        id: u64,
        seq: u64,
        bytes: Vec<u8>,
        edit: bool,
    },
    SaveBegin {
        id: u64,
        seq: u64,
        bytes: Vec<u8>,
        reply: Sender<Result<(), JournalError>>,
    },
    AfterSave {
        id: u64,
        durability: Durability,
        base: BaseSnapshot,
        through: u64,
    },
    Close {
        id: u64,
        last_save: Option<(RevisionId, Durability)>,
    },
    Detach {
        id: u64,
    },
    OpenTree {
        key: NotebookKey,
        meta: JournalMeta,
        reply: Sender<Result<Arc<TreeShared>, JournalError>>,
    },
    TreeAppend {
        key: NotebookKey,
        seq: u64,
        bytes: Vec<u8>,
        done: bool,
        reply: Option<Sender<Result<(), JournalError>>>,
    },
    Flush {
        reply: Sender<Result<(), JournalError>>,
    },
    Shutdown {
        reply: Sender<()>,
    },
}

/// The journal thread's state.
pub struct Worker {
    config: JournalConfig,
    pages: HashMap<u64, PageJournal>,
    next_id: u64,
    trees: HashMap<NotebookKey, TreeState>,
}

impl Worker {
    pub fn new(config: JournalConfig) -> Worker {
        Worker {
            config,
            pages: HashMap::new(),
            next_id: 1,
            trees: HashMap::new(),
        }
    }

    /// Runs until `Shutdown`, or until every sender is gone.
    pub fn run(mut self, commands: &Receiver<Command>) {
        loop {
            let received = match self.deadline() {
                Some(deadline) => commands.recv_timeout(deadline.saturating_duration_since(Instant::now())),
                None => commands.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match received {
                Ok(Command::Shutdown { reply }) => {
                    self.stop();
                    let _ = reply.send(());
                    return;
                }
                Ok(command) => self.handle(command),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    self.stop();
                    return;
                }
            }
            self.flush_due();
        }
    }

    fn deadline(&self) -> Option<Instant> {
        let pages = self.pages.values().filter_map(|p| p.deadline(&self.config));
        let trees = self.trees.values().filter_map(|t| t.deadline(&self.config));
        pages.chain(trees).min()
    }

    fn flush_due(&mut self) {
        let now = Instant::now();
        let config = &self.config;
        for page in self.pages.values_mut() {
            if page.deadline(config).is_some_and(|due| due <= now) {
                page.sync(config);
            }
        }
        for tree in self.trees.values_mut() {
            if tree.deadline(config).is_some_and(|due| due <= now) {
                tree.sync(config);
            }
        }
    }

    fn stop(&mut self) {
        let config = &self.config;
        for page in self.pages.values_mut() {
            page.detach(config);
        }
        for tree in self.trees.values_mut() {
            tree.sync(config);
        }
        self.pages.clear();
        self.trees.clear();
    }

    fn handle(&mut self, command: Command) {
        let Some(command) = self.handle_page(command) else {
            return;
        };
        match command {
            Command::OpenTree { key, meta, reply } => {
                let _ = reply.send(self.open_tree(key, meta));
            }
            Command::TreeAppend {
                key,
                seq,
                bytes,
                done,
                reply,
            } => self.tree_append(&key, seq, &bytes, done, reply),
            Command::Flush { reply } => {
                let _ = reply.send(self.flush_all());
            }
            _ => {}
        }
    }

    /// Handles a command about a page's journal, or hands it back.
    fn handle_page(&mut self, command: Command) -> Option<Command> {
        let config = &self.config;
        match command {
            Command::OpenPage {
                key,
                page,
                meta,
                base,
                reply,
            } => {
                let _ = reply.send(self.open_page(key, page, meta, base));
            }
            Command::Append { id, seq, bytes, edit } => {
                if let Some(page) = self.pages.get_mut(&id) {
                    page.append(config, seq, bytes, edit);
                }
            }
            Command::SaveBegin { id, seq, bytes, reply } => {
                let result = match self.pages.get_mut(&id) {
                    Some(page) => page.save_begin(config, seq, bytes),
                    None => Err(JournalError::Closed),
                };
                let _ = reply.send(result);
            }
            Command::AfterSave {
                id,
                durability,
                base,
                through,
            } => {
                if let Some(page) = self.pages.get_mut(&id) {
                    page.after_save(config, durability, base, through);
                }
            }
            Command::Close { id, last_save } => {
                if let Some(mut page) = self.pages.remove(&id) {
                    page.close(config, last_save);
                }
            }
            Command::Detach { id } => {
                if let Some(mut page) = self.pages.remove(&id) {
                    page.detach(config);
                }
            }
            other => return Some(other),
        }
        None
    }

    fn open_page(
        &mut self,
        key: NotebookKey,
        page: PageId,
        meta: JournalMeta,
        base: BaseSnapshot,
    ) -> Result<(u64, Arc<PageShared>), JournalError> {
        if self.pages.values().any(|p| p.key == key && p.page == page) {
            let path = self.config.root.join(&key.0);
            return Err(JournalError::Degraded(FsError::new(FsErrorKind::Busy, path)));
        }
        let journal = PageJournal::open(&self.config, key, page, meta, base)?;
        let shared = journal.shared.clone();
        let id = self.next_id;
        self.next_id = id.saturating_add(1);
        self.pages.insert(id, journal);
        Ok((id, shared))
    }

    fn open_tree(&mut self, key: NotebookKey, meta: JournalMeta) -> Result<Arc<TreeShared>, JournalError> {
        if let Some(tree) = self.trees.get(&key) {
            return Ok(tree.shared.clone());
        }
        let tree = TreeState::open(&self.config, &key, meta)?;
        let shared = tree.shared.clone();
        self.trees.insert(key, tree);
        Ok(shared)
    }

    fn tree_append(
        &mut self,
        key: &NotebookKey,
        seq: u64,
        bytes: &[u8],
        done: bool,
        reply: Option<Sender<Result<(), JournalError>>>,
    ) {
        let config = &self.config;
        let result = match self.trees.get_mut(key) {
            Some(tree) => {
                let result = tree.append(config, seq, bytes, reply.is_some());
                if done {
                    tree.tidy(config);
                }
                result
            }
            None => Err(JournalError::Closed),
        };
        if let Some(reply) = reply {
            let _ = reply.send(result);
        }
    }

    fn flush_all(&mut self) -> Result<(), JournalError> {
        let config = &self.config;
        let mut first_error = None;
        for page in self.pages.values_mut() {
            page.sync(config);
            if let Some(err) = page.shared.health.error() {
                first_error.get_or_insert(JournalError::Degraded(err));
            }
        }
        for tree in self.trees.values_mut() {
            tree.sync(config);
        }
        first_error.map_or(Ok(()), Err)
    }
}
