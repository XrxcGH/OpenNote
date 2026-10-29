//! Object spaces, revisions, and objects ([MS-ONESTORE] 2.1.3 to 2.1.14 and 2.5).
//!
//! The root file node list names every object space in the file and which one is the root. Each object space
//! has a list of revisions; the current revision is the one labeled with the default context and revision role 1
//! ([MS-ONESTORE] 2.1.11, 2.1.12). A revision holds the objects of the revision it depends on, plus its own.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use super::bytes::{Chunk, CompactId, Damage, ExGuid, Guid, Read, Reader};
use super::limits;
use super::props::{self, IdTable, PropSet};
use super::store::Store;

/// `FileDataStoreObject.guidHeader`, [MS-ONESTORE] 2.6.13.
const FILE_DATA_HEADER: Guid = Guid::new(
    0xBDE3_16E7,
    0x2665,
    0x4511,
    [0xA4, 0xC4, 0x8D, 0x4D, 0x0B, 0x7A, 0x9E, 0xAC],
);

/// The revision role of the active view, [MS-ONESTORE] 2.1.12.
const DEFAULT_ROLE: u32 = 1;

/// Where an object's data is.
#[derive(Clone, Debug)]
enum Data<'a> {
    /// An ObjectSpaceObjectPropSet, read with the global identification table of its object group.
    Props { blob: &'a [u8], table: Rc<IdTable> },
    /// A file data object: its FileDataReference string ([MS-ONESTORE] 2.5.27).
    File(String),
}

/// An object as declared in a revision.
#[derive(Clone, Debug)]
struct Decl<'a> {
    jcid: u32,
    data: Data<'a>,
}

/// An object, ready to read.
pub(crate) enum Object<'a> {
    /// An object with a property set.
    Props { jcid: u32, props: PropSet<'a> },
    /// A file data object and its reference string.
    File { reference: String },
}

/// Where a file data object's bytes are.
pub(crate) enum FileData<'a> {
    /// Inside this file.
    Inside(&'a [u8]),
    /// In the onefiles folder beside the file, under this name.
    Outside(String),
    /// Nowhere: the reference is invalid or points to nothing.
    Missing,
}

/// The current revision of one object space.
pub(crate) struct Space<'a> {
    objects: HashMap<ExGuid, Decl<'a>>,
    roots: HashMap<u32, ExGuid>,
    /// Whether the object space is encrypted (a password-protected section), so its data cannot be read.
    pub encrypted: bool,
}

impl<'a> Space<'a> {
    /// The root object for a root role ([MS-ONE] 2.1.8): 1 for content, 2 for metadata.
    pub(crate) fn root(&self, role: u32) -> Option<ExGuid> {
        self.roots.get(&role).copied()
    }

    /// Reads an object. `None` when the revision has no such object; an error when its data is damaged.
    pub(crate) fn object(&self, id: ExGuid) -> Option<Read<Object<'a>>> {
        let decl = self.objects.get(&id)?;
        Some(match &decl.data {
            Data::Props { blob, table } => {
                #[cfg(test)]
                PARSES.with(|n| n.set(n.get() + 1));
                props::parse(blob, table).map(|props| Object::Props { jcid: decl.jcid, props })
            }
            Data::File(reference) => Ok(Object::File {
                reference: reference.clone(),
            }),
        })
    }
}

#[cfg(test)]
thread_local! {
    /// How many property sets this thread has parsed, for tests that bound the work of a read.
    pub(crate) static PARSES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// A revision while its list is read.
#[derive(Default)]
struct Revision<'a> {
    dependent: ExGuid,
    encrypted: bool,
    objects: HashMap<ExGuid, Decl<'a>>,
    roots: HashMap<u32, ExGuid>,
}

/// An open section file: its store, its object spaces, and its file data.
pub(crate) struct File<'a> {
    store: Store<'a>,
    /// The root object space.
    pub root: ExGuid,
    spaces: HashMap<ExGuid, Chunk>,
    file_data: HashMap<Guid, Chunk>,
}

impl<'a> File<'a> {
    /// Opens a section file and reads its root file node list ([MS-ONESTORE] 2.1.14).
    pub(crate) fn open(data: &'a [u8]) -> Read<File<'a>> {
        let store = Store::open(data)?;
        let mut root = None;
        let mut spaces = HashMap::new();
        let mut file_data = HashMap::new();
        for node in store.root_list()? {
            match node.id {
                0x004 => root = Some(node.data().exguid()?),
                0x008 => {
                    let (chunk, mut rest) = node.reference()?;
                    let gosid = rest.exguid()?;
                    if let Some(chunk) = chunk {
                        spaces.insert(gosid, chunk);
                    }
                }
                0x090 => {
                    if let (Some(chunk), _) = node.reference()? {
                        read_file_data_list(&store, chunk, &mut file_data)?;
                    }
                }
                _ => {}
            }
            if spaces.len() > limits::SPACES {
                return Err(Damage::new("the file holds more pages than OpenNote reads"));
            }
        }
        let root = root.ok_or_else(|| Damage::new("the file names no root object space"))?;
        Ok(File {
            store,
            root,
            spaces,
            file_data,
        })
    }

    /// Reads the current revision of an object space. `None` when the file has no such object space.
    pub(crate) fn space(&self, gosid: ExGuid) -> Option<Read<Space<'a>>> {
        let chunk = *self.spaces.get(&gosid)?;
        Some(self.read_space(chunk))
    }

    fn read_space(&self, manifest: Chunk) -> Read<Space<'a>> {
        // [MS-ONESTORE] 2.1.6: of several revision manifest lists, only the last counts.
        let list = self
            .store
            .list(manifest)?
            .into_iter()
            .rfind(|n| n.id == 0x010)
            .ok_or_else(|| Damage::new("an object space has no revisions"))?;
        let (chunk, _) = list.reference()?;
        let chunk = chunk.ok_or_else(|| Damage::new("an object space has no revisions"))?;
        let mut revisions: HashMap<ExGuid, Revision<'a>> = HashMap::new();
        let mut labels: HashMap<(ExGuid, u32), ExGuid> = HashMap::new();
        let mut order = Vec::new();
        let mut current: Option<(ExGuid, Revision<'a>)> = None;
        for node in self.store.list(chunk)? {
            match node.id {
                0x01E | 0x01F => {
                    let mut r = node.data();
                    let rid = r.exguid()?;
                    let dependent = r.exguid()?;
                    let role = r.u32()?;
                    let encoding = r.u16()?;
                    let context = if node.id == 0x01F { r.exguid()? } else { ExGuid::ZERO };
                    labels.insert((context, role), rid);
                    let revision = Revision {
                        dependent,
                        encrypted: encoding == 2,
                        ..Revision::default()
                    };
                    current = Some((rid, revision));
                }
                0x07C => {
                    if let Some((_, revision)) = current.as_mut() {
                        revision.encrypted = true;
                    }
                }
                0x0B0 => {
                    if let Some((_, revision)) = current.as_mut() {
                        if let (Some(group), _) = node.reference()? {
                            self.read_group(group, revision)?;
                        }
                    }
                }
                0x05A => {
                    let mut r = node.data();
                    let oid = r.exguid()?;
                    let role = r.u32()?;
                    if let Some((_, revision)) = current.as_mut() {
                        revision.roots.insert(role, oid);
                    }
                }
                0x01C => {
                    if let Some((rid, revision)) = current.take() {
                        order.push(rid);
                        revisions.insert(rid, revision);
                    }
                }
                0x05C | 0x05D => {
                    let mut r = node.data();
                    let rid = r.exguid()?;
                    let role = r.u32()?;
                    let context = if node.id == 0x05D { r.exguid()? } else { ExGuid::ZERO };
                    labels.insert((context, role), rid);
                }
                _ => {}
            }
            if revisions.len() > limits::REVISIONS {
                return Err(Damage::new("an object space has more revisions than OpenNote reads"));
            }
        }
        let chosen = labels
            .get(&(ExGuid::ZERO, DEFAULT_ROLE))
            .copied()
            .filter(|rid| revisions.contains_key(rid))
            .or_else(|| order.last().copied())
            .ok_or_else(|| Damage::new("an object space has no finished revision"))?;
        merge(chosen, &mut revisions)
    }

    /// Reads an object group ([MS-ONESTORE] 2.1.13) into a revision.
    ///
    /// The group is read in two passes. The first builds each global identification table (a new one starts at
    /// every GlobalIdTableStart node) and notes the objects declared under it; the second resolves the objects
    /// with their finished table, which they all share. A table entry after a declaration, which a well-formed
    /// file never has, so joins the table instead of copying it once per object.
    fn read_group(&self, chunk: Chunk, revision: &mut Revision<'a>) -> Read<()> {
        enum Pending<'a> {
            Props(&'a [u8]),
            File(String),
        }
        let mut tables: Vec<IdTable> = vec![IdTable::new()];
        let mut declared: Vec<(usize, u32, u32, Pending<'a>)> = Vec::new();
        for node in self.store.list(chunk)? {
            let generation = tables.len() - 1;
            match node.id {
                0x022 => tables.push(IdTable::new()),
                0x024 => {
                    let mut r = node.data();
                    let index = r.u32()?;
                    let guid = r.guid()?;
                    let entries = &mut tables[generation];
                    if entries.len() >= limits::TABLE_ENTRIES {
                        return Err(Damage::new("an identification table is too large"));
                    }
                    entries.insert(index, guid);
                }
                0x0A4 | 0x0A5 | 0x0C4 | 0x0C5 => {
                    let (blob, mut r) = node.reference()?;
                    let oid = r.u32()?;
                    let jcid = r.u32()?;
                    if let Some(blob) = blob {
                        let blob = blob.slice(self.store.data)?;
                        declared.push((generation, oid, jcid, Pending::Props(blob)));
                    }
                }
                0x072 | 0x073 => {
                    let mut r = node.data();
                    let oid = r.u32()?;
                    let jcid = r.u32()?;
                    if node.id == 0x072 {
                        r.u8()?;
                    } else {
                        r.u32()?;
                    }
                    let reference = r.storage_string()?;
                    declared.push((generation, oid, jcid, Pending::File(reference)));
                }
                _ => {}
            }
        }
        let tables: Vec<Rc<IdTable>> = tables.into_iter().map(Rc::new).collect();
        for (generation, oid, jcid, pending) in declared {
            let table = &tables[generation];
            let data = match pending {
                Pending::Props(blob) => Data::Props {
                    blob,
                    table: Rc::clone(table),
                },
                Pending::File(reference) => Data::File(reference),
            };
            revision.objects.insert(resolve(oid, table), Decl { jcid, data });
        }
        Ok(())
    }

    /// Finds a file data object's bytes from its FileDataReference ([MS-ONESTORE] 2.5.27, 2.6.13).
    pub(crate) fn file_data(&self, reference: &str) -> FileData<'a> {
        if let Some(name) = reference.strip_prefix("<file>") {
            return FileData::Outside(name.to_owned());
        }
        let Some(guid) = reference.strip_prefix("<ifndf>").and_then(Guid::parse) else {
            return FileData::Missing;
        };
        match self.file_data.get(&guid).map(|c| read_file_data(self.store.data, *c)) {
            Some(Ok(bytes)) => FileData::Inside(bytes),
            _ => FileData::Missing,
        }
    }
}

/// Reads the file data store list ([MS-ONESTORE] 2.5.21, 2.5.22): where each stored file is, by its GUID.
fn read_file_data_list(store: &Store<'_>, chunk: Chunk, out: &mut HashMap<Guid, Chunk>) -> Read<()> {
    for entry in store.list(chunk)? {
        if entry.id != 0x094 {
            continue;
        }
        let (chunk, mut rest) = entry.reference()?;
        if let Some(chunk) = chunk {
            out.insert(rest.guid()?, chunk);
        }
    }
    Ok(())
}

/// A CompactID resolved with a global identification table.
fn resolve(value: u32, table: &IdTable) -> ExGuid {
    let id = CompactId::from_u32(value);
    match table.get(&id.index) {
        Some(guid) => ExGuid {
            guid: *guid,
            n: u32::from(id.n),
        },
        None => ExGuid::ZERO,
    }
}

/// The objects and roots of a revision and every revision it depends on, newest winning.
fn merge<'a>(chosen: ExGuid, revisions: &mut HashMap<ExGuid, Revision<'a>>) -> Read<Space<'a>> {
    let mut chain = Vec::new();
    let mut seen = HashSet::new();
    let mut next = chosen;
    while !next.is_zero() {
        if !seen.insert(next) {
            return Err(Damage::new("revisions depend on each other in a loop"));
        }
        let Some(revision) = revisions.remove(&next) else {
            break;
        };
        next = revision.dependent;
        chain.push(revision);
    }
    let mut space = Space {
        objects: HashMap::new(),
        roots: HashMap::new(),
        encrypted: false,
    };
    for revision in chain.into_iter().rev() {
        space.encrypted |= revision.encrypted;
        space.objects.extend(revision.objects);
        space.roots.extend(revision.roots);
    }
    Ok(space)
}

/// The data of a FileDataStoreObject ([MS-ONESTORE] 2.6.13).
fn read_file_data(data: &[u8], chunk: Chunk) -> Read<&[u8]> {
    let mut r = Reader::new(chunk.slice(data)?);
    if r.guid()? != FILE_DATA_HEADER {
        return Err(Damage::new("a stored file has the wrong signature"));
    }
    let len = r.u64()?;
    r.u32()?;
    r.u64()?;
    let len = usize::try_from(len).map_err(|_| Damage::new("a stored file is too large"))?;
    r.bytes(len)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onenote::write::{section, PageSpec, SectionSpec};

    /// Every object of a group shares one identification table, so a table entry after each declaration does
    /// not copy the table once per object (R3-1).
    #[test]
    fn objects_of_a_group_share_one_identification_table() {
        let spec = SectionSpec {
            pages: vec![PageSpec {
                title: "Shared".into(),
                ..PageSpec::default()
            }],
            interleaved_table: true,
            ..SectionSpec::default()
        };
        let data = section(&spec);
        let file = File::open(&data).expect("the section opens");
        for gosid in file.spaces.keys() {
            let space = file.space(*gosid).expect("the space exists").expect("the space reads");
            let tables: Vec<&Rc<IdTable>> = space
                .objects
                .values()
                .filter_map(|d| match &d.data {
                    Data::Props { table, .. } => Some(table),
                    Data::File(_) => None,
                })
                .collect();
            assert!(tables.len() > 1);
            assert!(tables.iter().all(|t| Rc::ptr_eq(t, tables[0])), "one table per group");
        }
        let read = crate::onenote::read_section(&data).expect("the section reads");
        let page = read.pages().next().expect("a page").expect("the page reads");
        assert_eq!(page.title, "Shared");
    }
}
