//! Merging what several devices know into one manifest, with rules that give the same answer on every device and
//! in any order, so all devices converge (ADR 0049, "Merging").
//!
//! A version that another has seen loses to it. Versions that saw nothing of each other are concurrent: equal
//! contents just join, an edit beats a delete, and different contents follow the rule for the kind of file. No rule
//! drops text: when two versions of a page can't both be `page.json`, the other one goes to `.conflicts/`, which
//! the app shows as a conflict to review (spec 14.1).

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;

use opennote_core::format::history_json::{merge_versions, read_versions, write_versions};
use opennote_core::format::page_json::read_page;
use opennote_core::format::tree_json::{merge_notebooks, merge_sections, read_notebook, read_section};
use opennote_core::format::tree_json::{write_notebook, write_section};
use opennote_core::Limits;

use crate::error::Result;
use crate::manifest::{dominates, join, Content, Entry, Manifest, Vv};

/// Reads small files for the merge rules, and turns bytes a rule wrote into content.
pub trait Contents {
    /// The bytes of a content, from this device or from storage.
    fn bytes(&self, content: &Content) -> Result<Vec<u8>>;
    /// Content for bytes a rule made, kept for upload.
    fn make(&self, bytes: Vec<u8>) -> Content;
}

/// Two versions that couldn't be merged; both are kept.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// The path that kept one version.
    pub path: String,
    /// Where the other version went.
    pub kept_as: String,
}

/// The merged manifest.
#[derive(Debug, Default)]
pub struct Merged {
    /// Every path.
    pub entries: Manifest,
    /// Versions kept side by side.
    pub conflicts: Vec<Conflict>,
}

/// What a path is, for the rules.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// `page.json`.
    Page,
    /// `section.json`.
    Section,
    /// `notebook.json`.
    Notebook,
    /// A page's `.history/versions.json`.
    Versions,
    /// An ink segment, an asset, or a sealed blob: never changed once written.
    Immutable,
    /// A readable copy the app writes again from the files above.
    Derived,
    /// A protected section's sealed manifest, which sync never opens.
    SealedManifest,
    /// Anything else.
    Other,
}

fn split(path: &str) -> (&str, &str) {
    path.rsplit_once('/').unwrap_or(("", path))
}

pub use opennote_core::store::sealed::SEALED_CONFLICT;

/// Whether a folder name holds a protected section's sealed files: `.sealed`, or a copy of another version of
/// them that sync kept, `.sealed-conflict-<hash>`.
pub fn is_sealed_name(name: &str) -> bool {
    name == ".sealed" || name.starts_with(SEALED_CONFLICT)
}

/// The kind of a path.
pub fn kind(path: &str) -> Kind {
    let (dir, name) = split(path);
    let (_, parent) = split(dir);
    if dir.split('/').any(is_sealed_name) {
        return if name == "manifest" && is_sealed_name(parent) {
            Kind::SealedManifest
        } else {
            Kind::Immutable
        };
    }
    match name {
        "page.json" => Kind::Page,
        "section.json" => Kind::Section,
        "notebook.json" => Kind::Notebook,
        "versions.json" if parent == ".history" => Kind::Versions,
        "page.md" | "ink.svg" | "index.md" | "README.md" => Kind::Derived,
        "FORMAT.md" if parent == ".opennote" => Kind::Derived,
        _ if parent == "ink" && name.ends_with(".onk") => Kind::Immutable,
        _ if parent == "assets" => Kind::Immutable,
        _ => Kind::Other,
    }
}

fn short(content: &Content) -> &str {
    &content.id[..content.id.len().min(8)]
}

/// Where the other version of an ordinary file goes: `notes (conflicted copy 1a2b3c4d).txt`.
fn conflicted_copy(path: &str, content: &Content) -> String {
    let (dir, name) = split(path);
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name, String::new()),
    };
    let file = format!("{stem} (conflicted copy {}){ext}", short(content));
    if dir.is_empty() {
        file
    } else {
        format!("{dir}/{file}")
    }
}

/// Where a sealed manifest's other version goes: a folder beside `.sealed` in the same section,
/// `.sealed-conflict-<hash>/manifest`. The blobs it needs are copied there too (see [`copy_sealed_sets`]), so the
/// folder opens on its own with the section's password.
fn sealed_copy(path: &str, content: &Content) -> String {
    let (sealed_dir, _) = split(path);
    let (section_dir, _) = split(sealed_dir);
    let folder = format!("{SEALED_CONFLICT}{}", short(content));
    if section_dir.is_empty() {
        format!("{folder}/manifest")
    } else {
        format!("{section_dir}/{folder}/manifest")
    }
}

struct PageInfo {
    revision: String,
    ancestors: BTreeSet<String>,
    saved_at: i64,
}

fn page_info(bytes: &[u8]) -> Option<PageInfo> {
    let page = read_page(bytes, &Limits::default()).ok()?.page;
    Some(PageInfo {
        revision: page.revision.id.to_string(),
        ancestors: page.revision.ancestors.iter().map(|r| r.to_string()).collect(),
        saved_at: page.revision.saved_at.unix_ms(),
    })
}

/// The versions no other version has seen, one per distinct version, in a fixed order.
fn maximal(mut candidates: Vec<Entry>) -> Vec<Entry> {
    candidates.sort_by(|a, b| (a.deleted, &a.content, &a.vv).cmp(&(b.deleted, &b.content, &b.vv)));
    candidates.dedup();
    let all = candidates.clone();
    candidates.retain(|e| !all.iter().any(|o| o != e && dominates(&o.vv, &e.vv) && o.vv != e.vv));
    candidates
}

/// One path, resolved: its version, the other versions kept at new paths, and whether it came from more than one
/// version that saw nothing of the others.
struct Resolved {
    entry: Entry,
    others: Vec<(String, Entry)>,
    concurrent: bool,
}

fn resolve(path: &str, candidates: Vec<Entry>, contents: &dyn Contents) -> Result<Resolved> {
    let top = maximal(candidates);
    let concurrent = top.len() > 1;
    let (entry, others) = resolve_top(path, top, contents)?;
    Ok(Resolved {
        entry,
        others,
        concurrent,
    })
}

/// The merged version of one path from its maximal versions, and any other versions kept at new paths.
fn resolve_top(path: &str, top: Vec<Entry>, contents: &dyn Contents) -> Result<(Entry, Vec<(String, Entry)>)> {
    if top.len() == 1 {
        return Ok((top.into_iter().next().expect("one"), Vec::new()));
    }
    let vv = top.iter().fold(Vv::new(), |acc, e| join(&acc, &e.vv));
    let mut live: Vec<Content> = top.iter().filter(|e| e.live()).map(|e| e.content.clone()).collect();
    live.sort();
    live.dedup();
    let entry = |content: Content| Entry {
        vv: vv.clone(),
        content,
        deleted: false,
    };
    match live.len() {
        // Deleted everywhere: keep the last content that sorts highest, so all devices agree.
        0 => {
            let content = top.iter().map(|e| e.content.clone()).max().expect("some");
            return Ok((
                Entry {
                    vv,
                    content,
                    deleted: true,
                },
                Vec::new(),
            ));
        }
        // One content: an edit beats a delete, and equal edits join.
        1 => return Ok((entry(live.remove(0)), Vec::new())),
        _ => {}
    }
    match kind(path) {
        Kind::Page => resolve_pages(path, live, contents, &entry),
        Kind::Section | Kind::Notebook | Kind::Versions => match merge_tree(path, &live, contents)? {
            Some(bytes) => Ok((entry(contents.make(bytes)), Vec::new())),
            None => Ok(keep_both(path, live, &entry)),
        },
        Kind::Derived => Ok((entry(live.pop().expect("two or more")), Vec::new())),
        Kind::SealedManifest => {
            let winner = live.pop().expect("two or more");
            let others = live.into_iter().map(|c| (sealed_copy(path, &c), entry(c))).collect();
            Ok((entry(winner), others))
        }
        Kind::Immutable | Kind::Other => Ok(keep_both(path, live, &entry)),
    }
}

/// The content that sorts highest stays, and the others go beside it as conflicted copies.
fn keep_both(path: &str, mut live: Vec<Content>, entry: &dyn Fn(Content) -> Entry) -> (Entry, Vec<(String, Entry)>) {
    let winner = live.pop().expect("two or more");
    let others = live
        .into_iter()
        .map(|c| (conflicted_copy(path, &c), entry(c)))
        .collect();
    (entry(winner), others)
}

fn resolve_pages(
    path: &str,
    live: Vec<Content>,
    contents: &dyn Contents,
    entry: &dyn Fn(Content) -> Entry,
) -> Result<(Entry, Vec<(String, Entry)>)> {
    let mut parsed = Vec::new();
    let mut unparsed = Vec::new();
    for content in live {
        match page_info(&contents.bytes(&content)?) {
            Some(info) => parsed.push((info, content)),
            None => unparsed.push(content),
        }
    }
    // A revision that another lists among its ancestors is an older save of the same page: not a conflict.
    let older: BTreeSet<String> = parsed
        .iter()
        .flat_map(|(info, _)| info.ancestors.iter().filter(|a| **a != info.revision).cloned())
        .collect();
    parsed.retain(|(info, _)| !older.contains(&info.revision));
    if parsed.is_empty() {
        return Ok(keep_both(path, unparsed, entry));
    }
    parsed.sort_by(|(a, ac), (b, bc)| (a.saved_at, ac).cmp(&(b.saved_at, bc)));
    let (_, winner) = parsed.pop().expect("one or more");
    let (dir, _) = split(path);
    let prefix = if dir.is_empty() {
        String::new()
    } else {
        format!("{dir}/")
    };
    let mut others: Vec<(String, Entry)> = parsed
        .into_iter()
        .map(|(info, c)| (format!("{prefix}.conflicts/{}.json", info.revision), entry(c)))
        .collect();
    others.extend(unparsed.into_iter().map(|c| (conflicted_copy(path, &c), entry(c))));
    Ok((entry(winner), others))
}

/// The core's own commutative merge of tree files and version lists, folded in a fixed order. `None` if any copy
/// doesn't read, so the caller keeps both instead.
fn merge_tree(path: &str, live: &[Content], contents: &dyn Contents) -> Result<Option<Vec<u8>>> {
    let limits = Limits::default();
    let mut all = Vec::new();
    for content in live {
        all.push(contents.bytes(content)?);
    }
    Ok(match kind(path) {
        Kind::Section => {
            let files: Option<Vec<_>> = all.iter().map(|b| read_section(b, &limits).ok()).collect();
            files.and_then(|files| {
                let mut iter = files.into_iter();
                let first = iter.next()?;
                Some(write_section(&iter.fold(first, |acc, f| merge_sections(&acc, &f))))
            })
        }
        Kind::Notebook => {
            let files: Option<Vec<_>> = all.iter().map(|b| read_notebook(b, &limits).ok()).collect();
            files.and_then(|files| {
                let mut iter = files.into_iter();
                let first = iter.next()?;
                Some(write_notebook(&iter.fold(first, |acc, f| merge_notebooks(&acc, &f))))
            })
        }
        _ => {
            let files: Option<Vec<_>> = all.iter().map(|b| read_versions(b, &limits).ok()).collect();
            files.and_then(|files| {
                let mut iter = files.into_iter();
                let first = iter.next()?;
                Some(write_versions(&iter.fold(first, |acc, f| merge_versions(&acc, &f))))
            })
        }
    })
}

/// The ink segments and assets a page file points at, as paths relative to its page folder.
fn page_refs(bytes: &[u8]) -> BTreeSet<String> {
    let mut plain = Vec::new();
    let bytes = if bytes.starts_with(&[0x1f, 0x8b]) {
        if flate2::read::GzDecoder::new(bytes)
            .take(64 * 1024 * 1024)
            .read_to_end(&mut plain)
            .is_err()
        {
            return BTreeSet::new();
        }
        &plain[..]
    } else {
        bytes
    };
    let Ok(read) = read_page(bytes, &Limits::default()) else {
        return BTreeSet::new();
    };
    let page = read.page;
    let mut refs: BTreeSet<String> = page
        .ink
        .segments()
        .iter()
        .map(|s| format!("ink/{}.onk", s.id))
        .collect();
    refs.extend(page.assets.values().map(|a| format!("assets/{}", a.file)));
    refs
}

/// Merges manifests. `before` is this device's own manifest before the merge: folders where nothing changed are
/// not checked again.
pub fn merge(inputs: &[&Manifest], before: &Manifest, contents: &dyn Contents) -> Result<Merged> {
    let mut by_path: BTreeMap<&str, Vec<Entry>> = BTreeMap::new();
    for manifest in inputs {
        for (path, entry) in manifest.iter() {
            by_path.entry(path.as_str()).or_default().push(entry.clone());
        }
    }
    let mut merged = Merged::default();
    let mut extras: Vec<(String, String, Entry)> = Vec::new();
    let mut concurrent: BTreeSet<String> = BTreeSet::new();
    let mut had_live: BTreeSet<String> = BTreeSet::new();
    let mut sealed_sets: Vec<(String, String)> = Vec::new();
    for (path, candidates) in by_path {
        if candidates.iter().any(Entry::live) {
            had_live.insert(path.to_owned());
        }
        let resolved = resolve(path, candidates, contents)?;
        if resolved.concurrent {
            concurrent.insert(path.to_owned());
        }
        if kind(path) == Kind::SealedManifest {
            sealed_sets.extend(resolved.others.iter().map(|(at, _)| (path.to_owned(), at.clone())));
        }
        merged.entries.insert(path.to_owned(), resolved.entry);
        extras.extend(resolved.others.into_iter().map(|(at, e)| (path.to_owned(), at, e)));
    }
    // Other versions land at new paths. A path may already hold one (another device kept it there too), so they
    // merge like any other version. Each round moves names further from the original, and three rounds is plenty.
    for _ in 0..4 {
        if extras.is_empty() {
            break;
        }
        let mut next = Vec::new();
        for (from, at, entry) in std::mem::take(&mut extras) {
            merged.conflicts.push(Conflict {
                path: from.clone(),
                kept_as: at.clone(),
            });
            let mut candidates = vec![entry];
            candidates.extend(merged.entries.get(&at).cloned());
            let resolved = resolve(&at, candidates, contents)?;
            if kind(&at) == Kind::SealedManifest {
                sealed_sets.extend(resolved.others.iter().map(|(to, _)| (at.clone(), to.clone())));
            }
            merged.entries.insert(at.clone(), resolved.entry);
            next.extend(resolved.others.into_iter().map(|(to, e)| (at.clone(), to, e)));
        }
        extras = next;
    }
    merged
        .conflicts
        .sort_by(|a, b| (&a.path, &a.kept_as).cmp(&(&b.path, &b.kept_as)));
    merged.conflicts.dedup();
    let sealed = Sealed {
        concurrent: &concurrent,
        had_live: &had_live,
    };
    revive_referenced(&mut merged.entries, before, contents, &sealed)?;
    copy_sealed_sets(&mut merged.entries, &sealed_sets, contents)?;
    Ok(merged)
}

/// What the merge knew of each path, for protected sections' folders, which sync can't read.
struct Sealed<'a> {
    /// The paths that resolved from versions that saw nothing of each other.
    concurrent: &'a BTreeSet<String>,
    /// The paths that some version had as a live file.
    had_live: &'a BTreeSet<String>,
}

/// A protected section's sealed files are one unit: the manifest names the blobs it needs, and sync can't read
/// it. When two devices changed the manifest, the other version went to a `.sealed-conflict-<hash>` folder. Every
/// blob the section's sealed folder holds now (after the deleted ones that either version may still name came
/// back) is copied there, so that folder is whole. Blobs never change once written and equal bytes are one chunk,
/// so a copy costs no storage.
fn copy_sealed_sets(entries: &mut Manifest, sets: &[(String, String)], contents: &dyn Contents) -> Result<()> {
    for (manifest, copy) in sets {
        let (from, _) = split(manifest);
        let (to, _) = split(copy);
        let Some(copy_vv) = entries.get(copy).map(|e| e.vv.clone()) else {
            continue;
        };
        let prefix = format!("{from}/");
        let blobs: Vec<(String, Entry)> = entries
            .range(prefix.clone()..)
            .take_while(|(p, _)| p.starts_with(&prefix))
            .filter(|(p, e)| e.live() && *p != manifest && !p[prefix.len()..].contains('/'))
            .map(|(p, e)| (format!("{to}/{}", &p[prefix.len()..]), e.clone()))
            .collect();
        for (at, blob) in blobs {
            let entry = Entry {
                vv: join(&blob.vv, &copy_vv),
                content: blob.content,
                deleted: false,
            };
            let mut candidates = vec![entry];
            candidates.extend(entries.get(&at).cloned());
            let resolved = resolve(&at, candidates, contents)?;
            entries.insert(at, resolved.entry);
            for (other, e) in resolved.others {
                entries.entry(other).or_insert(e);
            }
        }
    }
    Ok(())
}

/// An edit beats a delete across files, too: an ink segment or asset that a live page (its `page.json`, a kept
/// conflict, or a saved version) still points at comes back, so a merged page never misses ink. In a protected
/// section, whose manifest sync can't read, the sealed blobs that some version in this merge still had come back
/// only when the manifest itself resolved from concurrent versions, as either one may name them. A manifest that
/// resolved cleanly came from a device that saw every version, so its deletes stand. (Each path has its own
/// version vector, so a blob's and the manifest's can't be compared.)
fn revive_referenced(
    entries: &mut Manifest,
    before: &Manifest,
    contents: &dyn Contents,
    sealed: &Sealed,
) -> Result<()> {
    let changed = |path: &str| before.get(path) != entries.get(path);
    let mut folders: BTreeSet<String> = BTreeSet::new();
    for path in entries.keys() {
        if !changed(path) {
            continue;
        }
        let (dir, _) = split(path);
        let (page_dir, sub) = split(dir);
        match sub {
            "ink" | "assets" | ".conflicts" | ".history" => folders.insert(page_dir.to_owned()),
            _ if kind(path) == Kind::Page => folders.insert(dir.to_owned()),
            _ if kind(path) == Kind::Immutable || kind(path) == Kind::SealedManifest => folders.insert(dir.to_owned()),
            _ => false,
        };
    }
    for folder in folders {
        let prefix = if folder.is_empty() {
            String::new()
        } else {
            format!("{folder}/")
        };
        let in_folder: Vec<String> = entries
            .range(prefix.clone()..)
            .take_while(|(p, _)| p.starts_with(&prefix))
            .map(|(p, _)| p.clone())
            .collect();
        if is_sealed_name(split(&folder).1) {
            let manifest_path = format!("{prefix}manifest");
            let Some(manifest) = entries.get(&manifest_path).filter(|e| e.live()).cloned() else {
                continue;
            };
            if !sealed.concurrent.contains(&manifest_path) {
                continue;
            }
            for path in in_folder {
                let entry = &entries[&path];
                if entry.deleted && path != manifest_path && sealed.had_live.contains(&path) {
                    let vv = join(&entry.vv, &manifest.vv);
                    let content = entry.content.clone();
                    entries.insert(
                        path,
                        Entry {
                            vv,
                            content,
                            deleted: false,
                        },
                    );
                }
            }
            continue;
        }
        let tombstones: Vec<String> = in_folder
            .iter()
            .filter(|p| {
                let rest = &p[prefix.len()..];
                entries[*p].deleted && (rest.starts_with("ink/") || rest.starts_with("assets/"))
            })
            .cloned()
            .collect();
        if tombstones.is_empty() {
            continue;
        }
        let roots: Vec<String> = in_folder
            .iter()
            .filter(|p| {
                let rest = &p[prefix.len()..];
                entries[*p].live()
                    && (rest == "page.json"
                        || (rest.starts_with(".conflicts/") && rest.ends_with(".json"))
                        || (rest.starts_with(".history/") && rest.ends_with(".json.gz")))
            })
            .cloned()
            .collect();
        let mut wanted = BTreeSet::new();
        let mut root_vv = Vv::new();
        for root in &roots {
            let entry = &entries[root];
            root_vv = join(&root_vv, &entry.vv);
            wanted.extend(page_refs(&contents.bytes(&entry.content)?));
        }
        for path in tombstones {
            if wanted.contains(&path[prefix.len()..]) {
                let entry = &entries[&path];
                let revived = Entry {
                    vv: join(&entry.vv, &root_vv),
                    content: entry.content.clone(),
                    deleted: false,
                };
                entries.insert(path, revived);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_classified_by_the_note_format() {
        assert_eq!(kind("Bio/s1/p1/page.json"), Kind::Page);
        assert_eq!(kind("Bio/s1/section.json"), Kind::Section);
        assert_eq!(kind("Bio/notebook.json"), Kind::Notebook);
        assert_eq!(kind("Bio/s1/p1/.history/versions.json"), Kind::Versions);
        assert_eq!(kind("Bio/s1/p1/ink/01ab.onk"), Kind::Immutable);
        assert_eq!(kind("Bio/s1/p1/assets/01ab-leaf.png"), Kind::Immutable);
        assert_eq!(kind("Bio/s1/.sealed/manifest"), Kind::SealedManifest);
        assert_eq!(kind("Bio/s1/.sealed/4f2a"), Kind::Immutable);
        assert_eq!(kind("Bio/s1/.sealed-conflict-1a2b/manifest"), Kind::SealedManifest);
        assert_eq!(kind("Bio/s1/.sealed-conflict-1a2b/4f2a"), Kind::Immutable);
        assert_eq!(kind("Bio/s1/.sealed-notes/manifest"), Kind::Other);
        assert_eq!(kind("Bio/s1/p1/page.md"), Kind::Derived);
        assert_eq!(kind("Bio/.opennote/FORMAT.md"), Kind::Derived);
        assert_eq!(kind("Bio/FORMAT.md"), Kind::Other);
        assert_eq!(kind("Bio/s1/p1/versions.json"), Kind::Other);
        assert_eq!(kind("todo.txt"), Kind::Other);
    }

    #[test]
    fn other_versions_get_names_beside_the_original() {
        let c = Content {
            id: "1a2b3c4d5e".into(),
            size: 1,
            chunks: vec![],
        };
        assert_eq!(
            conflicted_copy("Bio/notes.txt", &c),
            "Bio/notes (conflicted copy 1a2b3c4d).txt"
        );
        assert_eq!(conflicted_copy("Makefile", &c), "Makefile (conflicted copy 1a2b3c4d)");
        assert_eq!(
            conflicted_copy("Bio/.hidden", &c),
            "Bio/.hidden (conflicted copy 1a2b3c4d)"
        );
        assert_eq!(
            sealed_copy("Bio/s1/.sealed/manifest", &c),
            "Bio/s1/.sealed-conflict-1a2b3c4d/manifest"
        );
    }
}
