//! The import sink that writes a notebook folder.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};

use opennote_core::format::names::{fold_name, safe_folder_name};
use opennote_core::format::CanonicalCodec;
use opennote_core::model::{NotebookFile, SectionFile};
use opennote_core::seams::Codec;
use opennote_core::session::page::write_page_dir;
use opennote_core::store::fs::Fs;
use opennote_core::store::layout::NotebookLayout;
use opennote_core::store::lock::ensure_dir_all;
use opennote_core::store::std_fs::StdFs;
use opennote_core::{FsErrorKind, SectionId, Timings};

use super::core_error;
use crate::error::{InteropError, Result};
use crate::sink::{ImportSink, ImportedPage};

/// How many pages are written at once by default. Each page is a few durable file writes, so the disk, not the
/// processor, is what the writers wait for, and a few writers keep it busy.
const DEFAULT_WRITERS: usize = 4;

/// A page to write, with the folder of its section.
struct Job {
    section_dir: PathBuf,
    imported: ImportedPage,
}

/// The files a page needs, written the way the core writes them.
struct PageWriter {
    fs: Arc<dyn Fs>,
    codec: Arc<dyn Codec>,
}

impl PageWriter {
    fn write(&self, job: Job) -> Result<()> {
        let Job { section_dir, imported } = job;
        let page_dir = section_dir.join(imported.page.id.to_string());
        self.fs.create_dir_durable(&page_dir).map_err(core_error)?;
        for (id, bytes) in &imported.asset_bytes {
            let asset = imported
                .page
                .assets
                .get(id)
                .ok_or_else(|| InteropError::Missing(format!("asset {id} in the page's asset table")))?;
            let path = NotebookLayout::asset_path(&page_dir, asset).map_err(core_error)?;
            if let Some(folder) = path.parent() {
                ensure_dir_all(self.fs.as_ref(), folder).map_err(core_error)?;
            }
            self.fs.create_durable(&path, bytes).map_err(core_error)?;
        }
        write_page_dir(self.fs.as_ref(), self.codec.as_ref(), &page_dir, &imported.page).map_err(core_error)?;
        Ok(())
    }
}

/// Threads that write pages while the import goes on converting the next ones.
struct Pool {
    sender: Option<SyncSender<Job>>,
    handles: Vec<JoinHandle<()>>,
    failure: Arc<Mutex<Option<InteropError>>>,
}

impl Pool {
    fn start(writer: &Arc<PageWriter>, threads: usize) -> Pool {
        let (sender, receiver) = sync_channel::<Job>(threads * 2);
        let receiver = Arc::new(Mutex::new(receiver));
        let failure = Arc::new(Mutex::new(None));
        let handles = (0..threads)
            .map(|_| {
                let (writer, receiver, failure) = (Arc::clone(writer), Arc::clone(&receiver), Arc::clone(&failure));
                thread::spawn(move || work(&writer, &receiver, &failure))
            })
            .collect();
        Pool {
            sender: Some(sender),
            handles,
            failure,
        }
    }

    /// Hands a page to a writer. Fails if an earlier page failed to write.
    fn submit(&self, job: Job) -> Result<()> {
        self.check()?;
        let sender = self
            .sender
            .as_ref()
            .ok_or_else(|| InteropError::Sink("the writers have stopped".to_owned()))?;
        sender
            .send(job)
            .map_err(|_| InteropError::Sink("the writers have stopped".to_owned()))
    }

    /// The first failure of a writer, if any.
    fn check(&self) -> Result<()> {
        match self.failure.lock().unwrap_or_else(PoisonError::into_inner).take() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    /// Waits until every page handed over is written.
    fn drain(&mut self) -> Result<()> {
        self.sender = None;
        for handle in self.handles.drain(..) {
            let _ = handle.join();
        }
        self.check()
    }
}

impl Drop for Pool {
    fn drop(&mut self) {
        let _ = self.drain();
    }
}

fn work(writer: &PageWriter, receiver: &Mutex<Receiver<Job>>, failure: &Mutex<Option<InteropError>>) {
    loop {
        let job = receiver.lock().unwrap_or_else(PoisonError::into_inner).recv();
        let Ok(job) = job else {
            return;
        };
        let broken = failure.lock().unwrap_or_else(PoisonError::into_inner).is_some();
        if broken {
            continue;
        }
        if let Err(error) = writer.write(job) {
            failure
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get_or_insert(error);
        }
    }
}

/// Writes an import as a new notebook folder inside `parent`.
///
/// The work happens in a hidden staging folder named `.importing-<notebook ID>`. [`ImportSink::finish`] renames
/// it to the notebook's title, so a half-written import never shows up as a notebook, and
/// [`ImportSink::abort`] deletes it. Pages are written by a few threads at once, because each page costs several
/// durable writes.
pub struct DiskSink {
    writer: Arc<PageWriter>,
    fs: Arc<dyn Fs>,
    codec: Arc<dyn Codec>,
    parent: PathBuf,
    threads: usize,
    pool: Option<Pool>,
    staging: Option<Staging>,
    finished: Option<PathBuf>,
    sections: HashSet<SectionId>,
}

struct Staging {
    dir: PathBuf,
    layout: NotebookLayout,
    title: String,
}

impl DiskSink {
    /// A sink on the real file system with the canonical codec.
    pub fn standard(parent: impl Into<PathBuf>) -> DiskSink {
        let fs: Arc<dyn Fs> = Arc::new(StdFs::new(&Timings::default()));
        DiskSink::new(fs, Arc::new(CanonicalCodec), parent)
    }

    /// A sink that uses the given file system and codec, such as the core's fakes in tests.
    pub fn new(fs: Arc<dyn Fs>, codec: Arc<dyn Codec>, parent: impl Into<PathBuf>) -> DiskSink {
        let threads = thread::available_parallelism()
            .map_or(2, usize::from)
            .clamp(1, DEFAULT_WRITERS);
        DiskSink {
            writer: Arc::new(PageWriter {
                fs: Arc::clone(&fs),
                codec: Arc::clone(&codec),
            }),
            fs,
            codec,
            parent: parent.into(),
            threads,
            pool: None,
            staging: None,
            finished: None,
            sections: HashSet::new(),
        }
    }

    /// Sets how many pages are written at once. One writes each page before the next page is handed over.
    pub fn with_writers(mut self, threads: usize) -> DiskSink {
        self.threads = threads.max(1);
        self
    }

    /// The notebook folder, once the import has finished.
    pub fn notebook_dir(&self) -> Option<&Path> {
        self.finished.as_deref()
    }

    fn staging(&self) -> Result<&Staging> {
        self.staging
            .as_ref()
            .ok_or_else(|| InteropError::Sink("the import has not started a notebook".to_owned()))
    }

    fn ensure_section_dir(&mut self, section: SectionId) -> Result<PathBuf> {
        let dir = self.staging()?.layout.section_dir(section);
        if self.sections.insert(section) {
            self.fs.create_dir_durable(&dir).map_err(core_error)?;
        }
        Ok(dir)
    }

    /// Waits for the writers to finish every page they were given.
    fn drain(&mut self) -> Result<()> {
        match self.pool.take() {
            Some(mut pool) => pool.drain(),
            None => Ok(()),
        }
    }
}

impl ImportSink for DiskSink {
    fn notebook(&mut self, notebook: NotebookFile) -> Result<()> {
        ensure_dir_all(self.fs.as_ref(), &self.parent).map_err(core_error)?;
        let dir = self.parent.join(format!(".importing-{}", notebook.id));
        self.fs.create_dir_durable(&dir).map_err(core_error)?;
        let layout = NotebookLayout::new(&dir);
        let bytes = self.codec.write_notebook(&notebook);
        self.fs
            .replace_durable(&layout.notebook_json(), &bytes)
            .map_err(core_error)?;
        self.staging = Some(Staging {
            dir,
            layout,
            title: notebook.title,
        });
        Ok(())
    }

    fn page(&mut self, section: SectionId, imported: ImportedPage) -> Result<()> {
        let section_dir = self.ensure_section_dir(section)?;
        let job = Job { section_dir, imported };
        if self.threads <= 1 {
            return self.writer.write(job);
        }
        let threads = self.threads;
        let writer = &self.writer;
        self.pool
            .get_or_insert_with(|| Pool::start(writer, threads))
            .submit(job)
    }

    fn section(&mut self, section: SectionFile) -> Result<()> {
        self.ensure_section_dir(section.id)?;
        let path = self.staging()?.layout.section_json(section.id);
        let bytes = self.codec.write_section(&section);
        self.fs.replace_durable(&path, &bytes).map_err(core_error)?;
        Ok(())
    }

    fn finish(&mut self) -> Result<()> {
        self.drain()?;
        let staging = self
            .staging
            .take()
            .ok_or_else(|| InteropError::Sink("the import has not started a notebook".to_owned()))?;
        let mut taken: HashSet<String> = self
            .fs
            .read_dir(&self.parent)
            .map_err(core_error)?
            .into_iter()
            .map(|entry| fold_name(&entry.name))
            .collect();
        loop {
            let name = safe_folder_name(&staging.title, &|n| taken.contains(&fold_name(n)));
            let target = self.parent.join(&name);
            match self.fs.rename_dir(&staging.dir, &target) {
                Ok(_) => {
                    self.finished = Some(target);
                    return Ok(());
                }
                Err(error) if error.kind == FsErrorKind::AlreadyExists && taken.insert(fold_name(&name)) => {}
                Err(error) => {
                    self.staging = Some(staging);
                    return Err(core_error(error));
                }
            }
        }
    }

    fn abort(&mut self) {
        let _ = self.drain();
        if let Some(staging) = self.staging.take() {
            let _ = self.fs.remove_dir_all(&staging.dir);
        }
        self.sections.clear();
    }
}
