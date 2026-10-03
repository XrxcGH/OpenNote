//! The core workload (plan 13.6): the writer uses the real `Core`, `StdFs`, `CanonicalCodec`, and `OpsApplier`,
//! with the shortened timings of `Timings::for_crash_tests`, so saves, rotations, and compactions happen all the
//! time.
//!
//! A setup run makes the notebook, one section, and the pages, and writes a manifest to the data folder. Each
//! iteration then replays its script: edits from WP3's generator, undo and redo, saves, and tree changes on
//! scratch pages. After a journal flush makes an edit durable, the writer prints `ACK p<k> <step>`, where the
//! step counts the transactions applied to that page in this iteration.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use opennote_core::error::FsErrorKind;
use opennote_core::format::CanonicalCodec;
use opennote_core::id::{ClientId, DeviceId, PageId, SectionId, TrashItemId};
use opennote_core::model::DeviceRef;
use opennote_core::ops::apply::OpsApplier;
use opennote_core::session::core::{Core, CoreConfig, MemoryCaps};
use opennote_core::session::notebook::{NodePlacement, NodeRef, NotebookHandle, ParentRef};
use opennote_core::session::page::{read_page_dir, PageHandle};
use opennote_core::store::failpoint;
use opennote_core::store::layout::NotebookLayout;
use opennote_core::store::std_fs::StdFs;
use opennote_core::testing::fakes::NullSink;
use opennote_core::{Clock, CoreError, Limits, Timings};

use super::core_script::{self as script, Action, Manifest, Model, SharedClock, CLIENT, PAGES, STEP};
use super::Paths;
use crate::rng::Rng;

/// Fail points of the core, from plan 13.6, and the highest hit number worth arming for each.
pub const FAIL_POINTS: [(&str, u64); 33] = [
    ("journal.appended", 200),
    ("journal.half_record", 200),
    ("journal.flushed", 60),
    ("journal.rotate.created", 4),
    ("journal.rotate.copied", 4),
    ("journal.rotate.switched", 4),
    ("journal.rotate.deleted", 4),
    ("save.segment.written", 12),
    ("save.save_begin.flushed", 12),
    ("save.page.tmp_flushed", 12),
    ("save.page.renamed", 12),
    ("save.page.flushed", 12),
    ("save.md.written", 12),
    ("save.history.written", 3),
    ("save.title_copy.written", 3),
    ("compact.written", 3),
    ("tree.intent.flushed", 6),
    ("tree.page.created", 3),
    ("tree.move.target_entry", 2),
    ("tree.move.source_entry", 2),
    ("tree.move.renamed", 2),
    ("trash.item.written", 3),
    ("trash.entries.removed", 3),
    ("trash.folder.moved", 3),
    ("restore.entries.added", 2),
    ("restore.folder.moved", 2),
    ("purge.renamed", 2),
    ("duplicate.copied", 2),
    ("notebook_move.copied", 1),
    ("recovery.replayed", 2),
    ("recovery.saved", 2),
    ("gc.deleted", 3),
    ("migration.backup.written", 1),
];

/// The fail point just after the sabotaged writer damages a page. A test arms it to stop the writer with the
/// damage done, however slow the machine is, rather than hoping a random kill lands after it.
pub const SABOTAGE_POINT: &str = "corew.sabotage.damaged";

/// A device for the harness.
fn device() -> DeviceRef {
    DeviceRef {
        id: DeviceId::parse("01m1e34qm04rx4vfj1927vgwgm").unwrap_or_else(|_| DeviceId::from(opennote_core::Id::ZERO)),
        label: "Crash test device".into(),
    }
}

/// Starts a core on the data folder with the crash-test timings.
pub fn start_core(data: &Path, clock: Arc<dyn Clock>) -> Result<Core, String> {
    let timings = Timings::for_crash_tests();
    let config = CoreConfig {
        data_dir: data.to_path_buf(),
        device: device(),
        app_version: "opennote-crashtest".into(),
        fs: Arc::new(StdFs::new(&timings)),
        codec: Arc::new(CanonicalCodec),
        applier: Arc::new(OpsApplier),
        clock,
        limits: Limits::default(),
        timings,
        caps: MemoryCaps::default(),
    };
    Core::start(config, Arc::new(NullSink), None).map_err(|e| format!("Core::start: {e}"))
}

fn err(context: &str) -> impl Fn(CoreError) -> String + '_ {
    move |e| format!("{context}: {e}")
}

/// Whether a call failed only because the hostile reader held a file open past the Busy retries, which the app
/// reports and retries rather than treating as damage (spec 17.6).
fn held(e: &CoreError) -> bool {
    matches!(e, CoreError::Fs(f) if matches!(f.kind, FsErrorKind::Busy | FsErrorKind::Blocked))
}

/// The setup run: makes the notebook, a section, and the pages, and writes the manifest.
pub fn setup(paths: &Paths) -> Result<(), String> {
    std::fs::create_dir_all(&paths.data).map_err(|e| e.to_string())?;
    let core = start_core(&paths.data, Arc::new(script::clock_for(0)))?;
    let parent = paths.notebook.parent().ok_or("the notebook needs a parent folder")?;
    let title = paths
        .notebook
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let notebook = core.create_notebook(parent, &title).map_err(err("create_notebook"))?;
    let top = NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    };
    let section = notebook.create_section("Crash", top).map_err(err("create_section"))?;
    let mut pages = Vec::new();
    for _ in 0..PAGES {
        pages.push(
            notebook
                .create_page(section, at_end(section))
                .map_err(err("create_page"))?
                .to_string(),
        );
    }
    notebook.close().map_err(err("close"))?;
    let manifest = Manifest {
        notebook: find_notebook(parent, &title)?,
        section: section.to_string(),
        pages,
    };
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(Manifest::path(&paths.data), json).map_err(|e| e.to_string())
}

fn at_end(section: SectionId) -> NodePlacement {
    NodePlacement {
        parent: ParentRef::Section(section),
        before: None,
    }
}

/// The folder `create_notebook` made: the one named after the title, or else the only one with a notebook file.
fn find_notebook(parent: &Path, title: &str) -> Result<std::path::PathBuf, String> {
    let named = parent.join(title);
    if named.join("notebook.json").exists() {
        return Ok(named);
    }
    let found = std::fs::read_dir(parent)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path());
    found
        .into_iter()
        .find(|path| path.join("notebook.json").exists())
        .ok_or_else(|| "create_notebook made no notebook folder".into())
}

/// One page the writer edits: the core's session and the model.
struct Session {
    handle: PageHandle,
    model: Model,
    applied: u64,
}

/// The writer: recovers, replays the iteration's script, and idles until it is killed.
pub fn write(paths: &Paths, seed: u64, iteration: u64, sabotage: bool) -> Result<(), String> {
    let manifest = Manifest::load(&paths.data)?;
    let clock: SharedClock = Arc::new(script::clock_for(iteration));
    let core = start_core(&paths.data, clock.clone())?;
    core.recover_pending(Some(&manifest.notebook))
        .map_err(err("recover_pending"))?;
    let notebook = core.open_notebook(&manifest.notebook).map_err(err("open_notebook"))?;
    let client = ClientId::parse(CLIENT).map_err(|e| format!("{e:?}"))?;
    let mut sessions = Vec::new();
    for page in manifest.page_ids()? {
        let dir = NotebookLayout::new(&manifest.notebook).page_dir(manifest.section_id()?, page);
        let fs = StdFs::new(&Timings::for_crash_tests());
        let loaded = read_page_dir(&fs, &CanonicalCodec, &dir, &Limits::default()).map_err(|e| format!("{e:?}"))?;
        let handle = notebook.open_page(page, client.clone()).map_err(err("open_page"))?;
        sessions.push(Session {
            handle,
            model: Model::new(loaded.page),
            applied: 0,
        });
    }
    crate::workload::say("READY");
    let mut tree = Scratch::default();
    for action in script::script(seed, iteration)? {
        clock.advance(STEP);
        step(&mut sessions, &notebook, &manifest, &mut tree, &action, &clock, &client)?;
        if sabotage {
            damage(&manifest)?;
            failpoint::hit(SABOTAGE_POINT);
        }
    }
    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}

/// Runs one step of the script.
fn step(
    sessions: &mut [Session],
    notebook: &NotebookHandle,
    manifest: &Manifest,
    tree: &mut Scratch,
    action: &Action,
    clock: &SharedClock,
    client: &ClientId,
) -> Result<(), String> {
    let page = match action {
        Action::Edit(page, _) | Action::Undo(page) | Action::Redo(page) | Action::Save(page) => *page,
        Action::Tree(choice) => return tree.change(notebook, manifest, *choice),
    };
    let session = sessions.get_mut(page).ok_or("no such page")?;
    match action {
        Action::Edit(_, edit) => {
            let Some(request) = session.model.request(edit, client) else {
                return Ok(());
            };
            let ack = session
                .handle
                .apply(request.clone())
                .map_err(|e| format!("apply: {e:?}"))?;
            session.model.apply(&request, clock)?;
            session.applied += 1;
            session
                .handle
                .wait_durable(ack.seq, Duration::from_secs(5))
                .map_err(err("wait_durable"))?;
            crate::workload::say(&format!("ACK p{page} {}", session.applied));
        }
        Action::Undo(_) | Action::Redo(_) => {
            let redo = matches!(action, Action::Redo(_));
            let done = if redo {
                session.handle.redo(client)
            } else {
                session.handle.undo(client)
            };
            done.map_err(|e| format!("undo: {e:?}"))?;
            if session.model.undo_or_redo(redo, clock, client)? {
                session.applied += 1;
            }
        }
        _ => match session.handle.save_now() {
            Ok(_) => crate::workload::say(&format!("SAVE p{page} saved")),
            // The hostile reader outlasted the short Busy retries of the crash-test timings. The app's autosave
            // tries again later (spec 17.6), and the page stays dirty until then.
            Err(e) if held(&e) => crate::workload::say(&format!("HELD save p{page}: {e}")),
            Err(e) => return Err(err("save_now")(e)),
        },
    }
    Ok(())
}

/// The sabotaged writer overwrites a page's `page.json` with a torn copy, which verification must catch.
fn damage(manifest: &Manifest) -> Result<(), String> {
    let page = manifest.page_ids()?.into_iter().next().ok_or("no pages")?;
    let dir = NotebookLayout::new(&manifest.notebook).page_dir(manifest.section_id()?, page);
    let path = NotebookLayout::page_json(&dir);
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes[..bytes.len() / 2]).map_err(|e| e.to_string())
}

/// Scratch pages for tree changes: created, duplicated, deleted, restored, and purged.
#[derive(Default)]
struct Scratch {
    pages: Vec<PageId>,
    trash: Vec<TrashItemId>,
}

impl Scratch {
    /// Runs one tree change. A change cut short by a held file is skipped, as the person would try again, and
    /// the check after the iteration still finds each page exactly once.
    fn change(&mut self, notebook: &NotebookHandle, manifest: &Manifest, choice: u64) -> Result<(), String> {
        match self.try_change(notebook, manifest.section_id()?, choice) {
            Err(e) if held(&e) => {
                crate::workload::say(&format!("HELD tree change: {e}"));
                Ok(())
            }
            result => result.map_err(err("tree change")),
        }
    }

    fn try_change(&mut self, notebook: &NotebookHandle, section: SectionId, choice: u64) -> Result<(), CoreError> {
        let mut rng = Rng::new(choice);
        match (rng.below(5), self.pages.is_empty(), self.trash.is_empty()) {
            (0, _, _) | (1 | 2, true, _) | (3 | 4, _, true) => {
                let page = notebook.create_page(section, at_end(section))?;
                self.pages.push(page);
                crate::workload::say(&format!("TREE create {page}"));
            }
            (1, false, _) => {
                let source = self.pages[rng.below(self.pages.len())];
                let copy = notebook.duplicate(source)?;
                self.pages.push(copy);
                crate::workload::say(&format!("TREE create {copy}"));
            }
            (2, false, _) => {
                let page = self.pages.swap_remove(rng.below(self.pages.len()));
                let items = notebook.delete(&[NodeRef::Page(page)])?;
                self.trash.extend(&items);
                for item in &items {
                    crate::workload::say(&format!("TREE delete {page} {item}"));
                }
            }
            (3, _, false) => {
                let item = self.trash.swap_remove(rng.below(self.trash.len()));
                for node in notebook.restore(item, None)? {
                    if let NodeRef::Page(page) = node {
                        self.pages.push(page);
                        crate::workload::say(&format!("TREE restore {page}"));
                    }
                }
            }
            _ => {
                let item = self.trash.swap_remove(rng.below(self.trash.len()));
                // Announced first: a purge that a kill or a held file cuts short may still finish in recovery,
                // and one that finished may be killed before it could say so. Either way its page may be gone.
                crate::workload::say(&format!("TREE purge {item}"));
                notebook.purge(item)?;
            }
        }
        Ok(())
    }
}
