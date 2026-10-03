//! Putting the attachments of an Evernote note into a page, and the converted text with them.

use std::collections::{HashMap, HashSet};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use md5::{Digest, Md5};
use opennote_core::format::names::extension_for_mime;
use opennote_core::model::asset::hex;
use opennote_core::AssetId;

use super::enex_xml::RawResource;
use super::enml::Piece;
use crate::assets::is_image;
use crate::doc::{visit_inlines_mut, Block, Inline, Marks};
use crate::page_builder::PageBuilder;
use crate::report::PageReport;

/// Evernote's handwriting attachments, which no other app can read.
const INK_MIME: &str = "application/vnd.evernote.ink";

/// An attachment with its data decoded.
pub(super) struct Resource {
    pub hash: String,
    pub mime: String,
    pub name: String,
    pub bytes: Vec<u8>,
}

pub(super) fn decode_resources(raw: Vec<RawResource>, report: &mut PageReport) -> Vec<Resource> {
    let mut out = Vec::new();
    for (n, resource) in raw.into_iter().enumerate() {
        let packed: String = resource.data.chars().filter(|c| !c.is_whitespace()).collect();
        let Ok(bytes) = STANDARD.decode(packed) else {
            report.skipped(format!("attachment {}", n + 1), "Its data is damaged.");
            continue;
        };
        let mime = if resource.mime.is_empty() {
            "application/octet-stream".to_owned()
        } else {
            resource.mime
        };
        let name = if resource.file_name.is_empty() {
            let ext = extension_for_mime(&mime).unwrap_or("bin");
            format!("{}.{ext}", if is_image(&mime) { "image" } else { "attachment" })
        } else {
            resource.file_name
        };
        out.push(Resource {
            hash: hex(&Md5::digest(&bytes)),
            mime,
            name,
            bytes,
        });
    }
    out
}

/// Puts the pieces of a converted note into the page, and its attachments with them.
pub(super) struct Placement<'p, 'b> {
    builder: &'p mut PageBuilder<'b>,
    assets: HashMap<String, AssetId>,
    ink: HashSet<String>,
    placed: HashSet<String>,
    images: usize,
    files: usize,
    missing: usize,
}

impl<'p, 'b> Placement<'p, 'b> {
    pub fn new(builder: &'p mut PageBuilder<'b>, resources: Vec<Resource>) -> Placement<'p, 'b> {
        let mut assets = HashMap::new();
        let mut ink = HashSet::new();
        for resource in resources {
            if resource.mime == INK_MIME {
                ink.insert(resource.hash);
            } else {
                let id = builder.add_asset(&resource.name, Some(&resource.mime), resource.bytes);
                assets.insert(resource.hash, id);
            }
        }
        Placement {
            builder,
            assets,
            ink,
            placed: HashSet::new(),
            images: 0,
            files: 0,
            missing: 0,
        }
    }

    pub fn place(&mut self, pieces: Vec<Piece>) {
        for piece in pieces {
            match piece {
                Piece::Block(mut block) => {
                    self.rewrite_media(std::slice::from_mut(&mut block));
                    self.builder.push_blocks(vec![block]);
                }
                Piece::File(hash) => match self.assets.get(&hash) {
                    Some(id) => {
                        self.builder.push_file(*id);
                        self.files += 1;
                        self.placed.insert(hash);
                    }
                    None => self.missing += 1,
                },
                Piece::Task(..) => {}
            }
        }
    }

    /// Points each `media:<hash>` image at the asset that holds its data.
    fn rewrite_media(&mut self, blocks: &mut [Block]) {
        visit_inlines_mut(blocks, &mut |inlines| {
            for inline in inlines.iter_mut() {
                let Inline::Image { dest, .. } = inline else {
                    continue;
                };
                let Some(hash) = dest.strip_prefix("media:") else {
                    continue;
                };
                match self.assets.get(hash) {
                    Some(id) => {
                        self.images += 1;
                        self.placed.insert(hash.to_owned());
                        *dest = format!("asset:{id}");
                    }
                    None => {
                        self.missing += 1;
                        *inline = Inline::marked("[image]", Marks::none());
                    }
                }
            }
        });
    }

    /// Adds the attachments that the text never showed at the end of the page, and describes all of them.
    pub fn finish(mut self, report: &mut PageReport) {
        let mut leftover: Vec<(String, AssetId)> = self
            .assets
            .iter()
            .filter(|(hash, _)| !self.placed.contains(*hash))
            .map(|(hash, id)| (hash.clone(), *id))
            .collect();
        leftover.sort();
        for (_, id) in &leftover {
            let image = self.builder.asset(*id).is_some_and(|a| is_image(&a.mime));
            if image {
                self.builder.push_image(*id, String::new());
                self.images += 1;
            } else {
                self.builder.push_file(*id);
                self.files += 1;
            }
        }
        report.came_over_count(self.images, "image", "images");
        report.came_over_count(self.files, "attachment", "attachments");
        let added = (
            "attachment that the text did not show",
            "attachments that the text did not show",
        );
        report.simplified_count(leftover.len(), added, "They were added at the end of the page.");
        report.skipped_count(
            self.ink.len(),
            ("handwriting", "handwriting attachments"),
            "OpenNote cannot read Evernote ink.",
        );
        let gone = (
            "attachment that is not in the file",
            "attachments that are not in the file",
        );
        report.skipped_count(
            self.missing,
            gone,
            "The note refers to data that the export does not hold.",
        );
    }
}
