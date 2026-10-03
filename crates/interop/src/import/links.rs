//! Turning the links and images of an imported note into OpenNote links and assets.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use opennote_core::{AssetId, PageId};

use super::scan::Scan;
use crate::assets::is_image;
use crate::dest::{self, ImportLink};
use crate::doc::parse::WIKI_PREFIX;
use crate::doc::{visit_inlines_mut, Block, Inline, Marks};
use crate::page_builder::PageBuilder;
use crate::report::PageReport;

/// Attachments bigger than this are not copied in, so one video cannot fill the memory.
const MAX_ATTACHMENT_BYTES: u64 = 256 << 20;

/// What the links and images of a note turned into, for its report.
#[derive(Debug, Default)]
pub struct Stats {
    /// Links to other notes.
    pub notes_linked: usize,
    /// Links to notes that are not in the import.
    pub notes_missing: usize,
    /// Links to a heading of the same note.
    pub anchors: usize,
    /// Notes embedded in this one, now links.
    pub embedded_notes: usize,
    /// Images that came over.
    pub images: usize,
    /// Images that are not in the folder.
    pub images_missing: usize,
    /// Images on the web, now links.
    pub remote_images: usize,
    /// Attachments that came over as file blocks.
    pub attachments: usize,
    /// Files that a note uses but the import could not read.
    pub unreadable: usize,
    /// Links to scripts, local files, other computers, and other apps, which were not kept.
    pub unfollowable: usize,
}

impl Stats {
    /// Adds what happened to a page report.
    pub fn describe(&self, report: &mut PageReport) {
        report.came_over_count(self.notes_linked, "link to another note", "links to other notes");
        report.came_over_count(self.images, "image", "images");
        report.came_over_count(self.attachments, "attachment", "attachments");
        let one_or_many = |one: &'static str, many: &'static str| (one, many);
        let missing = one_or_many(
            "link to a note that is not in the import",
            "links to notes that are not in the import",
        );
        report.simplified_count(self.notes_missing, missing, "Only the link text was kept.");
        let anchors = one_or_many("link to a heading", "links to headings");
        report.simplified_count(
            self.anchors,
            anchors,
            "OpenNote links to pages, so only the text was kept.",
        );
        let embeds = one_or_many("embedded note", "embedded notes");
        report.simplified_count(self.embedded_notes, embeds, "Each became a link to the note.");
        let remote = one_or_many("image on the web", "images on the web");
        report.simplified_count(
            self.remote_images,
            remote,
            "Imports do not go online, so each became a link.",
        );
        let absent = one_or_many("image that was not found", "images that were not found");
        report.skipped_count(self.images_missing, absent, "The description stays in the text.");
        let unfollowable = one_or_many("link that cannot be followed", "links that cannot be followed");
        report.simplified_count(
            self.unfollowable,
            unfollowable,
            "Links to scripts, local files, and other apps were not kept. Their text stays.",
        );
        let unreadable = one_or_many("file that could not be read", "files that could not be read");
        report.skipped_count(self.unreadable, unreadable, "It is too big or is not readable.");
    }
}

/// Resolves the links of one note.
pub struct Links<'a, 'b> {
    scan: &'a Scan,
    dir: &'a [String],
    page: &'a mut PageBuilder<'b>,
    loaded: HashMap<PathBuf, Option<AssetId>>,
    used: &'a mut HashSet<PathBuf>,
    /// Attachments found since the last call to [`Links::take_attached`], for file blocks after the text.
    attached: Vec<AssetId>,
    /// What happened so far.
    pub stats: Stats,
}

impl<'a, 'b> Links<'a, 'b> {
    /// Starts on a note in `dir`, adding its images and attachments to `page`. `used` collects the files that
    /// notes refer to.
    pub fn new(
        scan: &'a Scan,
        dir: &'a [String],
        page: &'a mut PageBuilder<'b>,
        used: &'a mut HashSet<PathBuf>,
    ) -> Links<'a, 'b> {
        Links {
            scan,
            dir,
            page,
            loaded: HashMap::new(),
            used,
            attached: Vec::new(),
            stats: Stats::default(),
        }
    }

    /// The page being built.
    pub fn page(&mut self) -> &mut PageBuilder<'b> {
        self.page
    }

    /// Whether the block is a paragraph that holds nothing but a link to a file in the folder. Such a paragraph
    /// stands for the attachment: the file goes to [`Links::take_attached`], and the paragraph is not kept.
    pub fn take_attachment_paragraph(&mut self, block: &Block) -> bool {
        let Block::Paragraph(inlines) = block else {
            return false;
        };
        let [Inline::Text { marks, .. }] = inlines.as_slice() else {
            return false;
        };
        let Some(dest) = marks.link.as_deref() else {
            return false;
        };
        let target = dest.strip_prefix(WIKI_PREFIX).unwrap_or(dest);
        let scan = self.scan;
        let is_file = dest.starts_with(WIKI_PREFIX) || matches!(dest::for_import(dest), ImportLink::Path(_));
        if !is_file || scan.note(target, self.dir).is_some() {
            return false;
        }
        let Some(path) = scan.file(target, self.dir) else {
            return false;
        };
        match self.load(path) {
            Some(id) => self.attach(id),
            None => self.stats.unreadable += 1,
        }
        true
    }

    /// The attachments found so far. Each one becomes a file block.
    pub fn take_attached(&mut self) -> Vec<AssetId> {
        std::mem::take(&mut self.attached)
    }

    /// Rewrites every link and image in the blocks.
    pub fn resolve(&mut self, blocks: &mut [Block]) {
        visit_inlines_mut(blocks, &mut |inlines| self.inlines(inlines));
    }

    fn inlines(&mut self, inlines: &mut Vec<Inline>) {
        let old = std::mem::take(inlines);
        for inline in old {
            match inline {
                Inline::Image { dest, alt } => inlines.extend(self.image(&dest, &alt)),
                Inline::Text { text, mut marks } => {
                    if let Some(dest) = marks.link.take() {
                        marks.link = self.link(&dest);
                    }
                    inlines.push(Inline::Text { text, marks });
                }
                other => inlines.push(other),
            }
        }
    }

    fn image(&mut self, dest: &str, alt: &str) -> Vec<Inline> {
        if let Some(found) = self.data_image(dest, alt) {
            return found;
        }
        let label = if alt.is_empty() {
            dest.rsplit('/').next().unwrap_or(dest)
        } else {
            alt
        };
        if dest.starts_with("http://") || dest.starts_with("https://") {
            self.stats.remote_images += 1;
            return vec![Inline::marked(label, Marks::link(dest))];
        }
        let scan = self.scan;
        if let Some(path) = scan.file(dest, self.dir) {
            return match self.load(path) {
                Some(id) if self.is_image(id) => {
                    self.stats.images += 1;
                    vec![Inline::Image {
                        dest: format!("asset:{id}"),
                        alt: alt.to_owned(),
                    }]
                }
                Some(id) => {
                    self.attach(id);
                    vec![Inline::text(label)]
                }
                None => vec![Inline::text(format!("[{label}]"))],
            };
        }
        if let Some(page) = self.scan.note(dest, self.dir) {
            self.stats.embedded_notes += 1;
            return vec![Inline::marked(label, Marks::link(page_link(page)))];
        }
        self.stats.images_missing += 1;
        vec![Inline::text(format!("[{label}]"))]
    }

    /// A picture written into the text as a `data:image/...;base64,` address becomes an asset of the page.
    fn data_image(&mut self, dest: &str, alt: &str) -> Option<Vec<Inline>> {
        dest.get(..11).filter(|p| p.eq_ignore_ascii_case("data:image/"))?;
        let (head, data) = dest.split_once(',')?;
        let kind = head.get(11..)?.split(';').next()?.to_ascii_lowercase();
        if !head.to_ascii_lowercase().ends_with(";base64") {
            return None;
        }
        let extension = match kind.as_str() {
            "jpeg" => "jpg",
            "svg+xml" => "svg",
            other => other,
        };
        let packed: String = data.chars().filter(|c| !c.is_whitespace()).collect();
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(packed) else {
            self.stats.images_missing += 1;
            return Some(vec![Inline::text("[image]")]);
        };
        let id = self
            .page
            .add_asset(&format!("image.{extension}"), Some(&format!("image/{kind}")), bytes);
        self.stats.images += 1;
        Some(vec![Inline::Image {
            dest: format!("asset:{id}"),
            alt: alt.to_owned(),
        }])
    }

    /// The new destination of a link, or `None` to keep only its text. Only the schemes of
    /// [`dest::for_import`] are kept; a path is resolved against the files of the import.
    fn link(&mut self, dest: &str) -> Option<String> {
        if let Some(target) = dest.strip_prefix(WIKI_PREFIX) {
            return self.note_or_file(target);
        }
        if dest.trim_start().starts_with('#') {
            self.stats.anchors += 1;
            return None;
        }
        match dest::for_import(dest) {
            ImportLink::Keep(kept) => Some(kept),
            ImportLink::Path(_) => self.note_or_file(dest),
            ImportLink::Refuse => {
                self.stats.unfollowable += 1;
                None
            }
        }
    }

    fn note_or_file(&mut self, target: &str) -> Option<String> {
        if let Some(page) = self.scan.note(target, self.dir) {
            self.stats.notes_linked += 1;
            return Some(page_link(page));
        }
        let scan = self.scan;
        if let Some(path) = scan.file(target, self.dir) {
            match self.load(path) {
                Some(id) => self.attach(id),
                None => self.stats.unreadable += 1,
            }
            return None;
        }
        self.stats.notes_missing += 1;
        None
    }

    fn attach(&mut self, id: AssetId) {
        if !self.attached.contains(&id) {
            self.attached.push(id);
            self.stats.attachments += 1;
        }
    }

    fn is_image(&self, id: AssetId) -> bool {
        self.page.asset(id).is_some_and(|asset| is_image(&asset.mime))
    }

    /// Reads a file into the page's assets once, however often notes refer to it.
    fn load(&mut self, path: &Path) -> Option<AssetId> {
        if let Some(known) = self.loaded.get(path) {
            return *known;
        }
        let name = path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        let small = fs::metadata(path).is_ok_and(|m| m.len() <= MAX_ATTACHMENT_BYTES);
        let bytes = if small { fs::read(path).ok() } else { None };
        let id = bytes.map(|bytes| self.page.add_asset(&name, None, bytes));
        self.used.insert(path.to_path_buf());
        if id.is_none() {
            self.stats.unreadable += 1;
        }
        self.loaded.insert(path.to_path_buf(), id);
        id
    }
}

fn page_link(page: PageId) -> String {
    format!("opennote:page/{page}")
}
