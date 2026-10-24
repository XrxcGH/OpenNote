//! Property sets ([MS-ONESTORE] 2.6.1 to 2.6.9): the data of an object.
//!
//! An object's data starts with up to three streams of CompactIDs (the objects, object spaces, and contexts it
//! points to), then a property set. Properties that point to something take their IDs from the streams in the
//! order the properties are read, nested sets included.

use std::collections::HashMap;

use super::bytes::{utf16, CompactId, Damage, ExGuid, Guid, Read, Reader};
use super::limits;

/// A global identification table ([MS-ONESTORE] 2.1.3): the GUID of each index.
pub(crate) type IdTable = HashMap<u32, Guid>;

/// The 26-bit `id` of a PropertyID ([MS-ONESTORE] 2.6.6). [MS-ONE] 2.1.12 lists whole PropertyID values, type bits
/// included; properties are matched on the `id` alone, because the type in a file decides how its data is read.
pub(crate) const fn pid(value: u32) -> u32 {
    value & 0x03FF_FFFF
}

/// The value of one property.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Value<'a> {
    /// `NoData`.
    Empty,
    /// `Bool`.
    Bool(bool),
    /// 1, 2, 4, or 8 bytes, or the data of `FourBytesOfLengthFollowedByData`.
    Bytes(&'a [u8]),
    /// `ObjectID` or `ArrayOfObjectIDs`.
    Objects(Vec<ExGuid>),
    /// `ObjectSpaceID` or `ArrayOfObjectSpaceIDs`.
    Spaces(Vec<ExGuid>),
    /// `ContextID` or `ArrayOfContextIDs`.
    Contexts(Vec<ExGuid>),
    /// `PropertySet` or `ArrayOfPropertyValues`.
    Sets(Vec<PropSet<'a>>),
}

/// A property set ([MS-ONESTORE] 2.6.7), with its references resolved.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct PropSet<'a> {
    props: Vec<(u32, Value<'a>)>,
}

impl<'a> PropSet<'a> {
    /// The value of a property, by its [MS-ONE] PropertyID.
    pub(crate) fn get(&self, prid: u32) -> Option<&Value<'a>> {
        let id = pid(prid);
        self.props.iter().find(|(p, _)| *p == id).map(|(_, v)| v)
    }

    /// A Boolean property; unset is `false`.
    pub(crate) fn flag(&self, prid: u32) -> bool {
        matches!(self.get(prid), Some(Value::Bool(true)))
    }

    /// An unsigned number of 1 to 8 bytes.
    pub(crate) fn number(&self, prid: u32) -> Option<u64> {
        match self.get(prid)? {
            Value::Bytes(b) if !b.is_empty() && b.len() <= 8 => {
                let mut full = [0u8; 8];
                full[..b.len()].copy_from_slice(b);
                Some(u64::from_le_bytes(full))
            }
            _ => None,
        }
    }

    /// Raw bytes.
    pub(crate) fn bytes(&self, prid: u32) -> Option<&'a [u8]> {
        match self.get(prid)? {
            Value::Bytes(b) => Some(b),
            _ => None,
        }
    }

    /// A WzInAtom string ([MS-ONE] 2.2.9): UTF-16 up to its NUL.
    pub(crate) fn text(&self, prid: u32) -> Option<String> {
        self.bytes(prid).map(utf16)
    }

    /// The objects a property points to.
    pub(crate) fn objects(&self, prid: u32) -> &[ExGuid] {
        match self.get(prid) {
            Some(Value::Objects(ids)) => ids,
            _ => &[],
        }
    }

    /// The object spaces a property points to.
    pub(crate) fn spaces(&self, prid: u32) -> &[ExGuid] {
        match self.get(prid) {
            Some(Value::Spaces(ids)) => ids,
            _ => &[],
        }
    }

    /// The nested property sets of a property.
    pub(crate) fn sets(&self, prid: u32) -> &[PropSet<'a>] {
        match self.get(prid) {
            Some(Value::Sets(sets)) => sets,
            _ => &[],
        }
    }

    /// An ArrayOfUINT32s ([MS-ONE] 2.2.11).
    pub(crate) fn numbers(&self, prid: u32) -> Vec<u32> {
        self.bytes(prid)
            .map(|b| b.as_chunks::<4>().0.iter().map(|c| u32::from_le_bytes(*c)).collect())
            .unwrap_or_default()
    }
}

/// One stream of CompactIDs, resolved to ExtendedGUIDs, read in order.
struct Stream {
    ids: Vec<ExGuid>,
    next: usize,
}

impl Stream {
    fn read(r: &mut Reader<'_>, count: usize, table: &IdTable) -> Read<Stream> {
        if count > r.remaining() / 4 {
            return Err(Damage::new("an object lists more references than it holds"));
        }
        let mut ids = Vec::with_capacity(count);
        for _ in 0..count {
            let id = CompactId::from_u32(r.u32()?);
            // An index missing from the table resolves to "none", so the reference is dropped later.
            let guid = table.get(&id.index).copied().unwrap_or(Guid::ZERO);
            ids.push(ExGuid {
                guid,
                n: if guid == Guid::ZERO { 0 } else { u32::from(id.n) },
            });
        }
        Ok(Stream { ids, next: 0 })
    }

    fn empty() -> Stream {
        Stream {
            ids: Vec::new(),
            next: 0,
        }
    }

    fn take(&mut self, count: usize) -> Read<Vec<ExGuid>> {
        let end = self
            .next
            .checked_add(count)
            .filter(|end| *end <= self.ids.len())
            .ok_or_else(|| Damage::new("a property points to more objects than the object lists"))?;
        let out = self.ids[self.next..end].to_vec();
        self.next = end;
        Ok(out)
    }
}

struct Streams {
    objects: Stream,
    spaces: Stream,
    contexts: Stream,
    /// Properties read so far, against [`limits::PROPERTIES`].
    read: usize,
}

/// Reads an ObjectSpaceObjectPropSet ([MS-ONESTORE] 2.6.1), resolving CompactIDs with `table`.
pub(crate) fn parse<'a>(data: &'a [u8], table: &IdTable) -> Read<PropSet<'a>> {
    let mut r = Reader::new(data);
    let header = r.u32()?;
    let objects = Stream::read(&mut r, (header & 0x00FF_FFFF) as usize, table)?;
    let mut spaces = Stream::empty();
    let mut contexts = Stream::empty();
    if header >> 31 == 0 {
        let osid_header = r.u32()?;
        spaces = Stream::read(&mut r, (osid_header & 0x00FF_FFFF) as usize, table)?;
        if (osid_header >> 30) & 1 == 1 {
            let context_header = r.u32()?;
            contexts = Stream::read(&mut r, (context_header & 0x00FF_FFFF) as usize, table)?;
        }
    }
    let mut streams = Streams {
        objects,
        spaces,
        contexts,
        read: 0,
    };
    set(&mut r, &mut streams, 0)
}

fn set<'a>(r: &mut Reader<'a>, streams: &mut Streams, depth: usize) -> Read<PropSet<'a>> {
    if depth > limits::NESTING {
        return Err(Damage::new("property sets are nested too deeply"));
    }
    let count = usize::from(r.u16()?);
    if count > r.remaining() / 4 {
        return Err(Damage::new("a property set lists more properties than it holds"));
    }
    let mut prids = Vec::with_capacity(count);
    for _ in 0..count {
        prids.push(r.u32()?);
    }
    let mut props = Vec::with_capacity(count);
    for prid in prids {
        streams.read += 1;
        if streams.read > limits::PROPERTIES {
            return Err(Damage::new("an object holds more properties than OpenNote reads"));
        }
        let value = value(prid, r, streams, depth)?;
        props.push((pid(prid), value));
    }
    Ok(PropSet { props })
}

fn value<'a>(prid: u32, r: &mut Reader<'a>, streams: &mut Streams, depth: usize) -> Read<Value<'a>> {
    let count = |r: &mut Reader<'a>| r.u32().map(|n| n as usize);
    Ok(match (prid >> 26) & 0x1F {
        0x1 => Value::Empty,
        0x2 => Value::Bool(prid >> 31 == 1),
        0x3 => Value::Bytes(r.bytes(1)?),
        0x4 => Value::Bytes(r.bytes(2)?),
        0x5 => Value::Bytes(r.bytes(4)?),
        0x6 => Value::Bytes(r.bytes(8)?),
        0x7 => {
            let len = r.u32()?;
            if len >= 0x4000_0000 {
                return Err(Damage::new("a property is longer than the format allows"));
            }
            Value::Bytes(r.bytes(len as usize)?)
        }
        0x8 => Value::Objects(streams.objects.take(1)?),
        0x9 => {
            let n = count(r)?;
            Value::Objects(streams.objects.take(n)?)
        }
        0xA => Value::Spaces(streams.spaces.take(1)?),
        0xB => {
            let n = count(r)?;
            Value::Spaces(streams.spaces.take(n)?)
        }
        0xC => Value::Contexts(streams.contexts.take(1)?),
        0xD => {
            let n = count(r)?;
            Value::Contexts(streams.contexts.take(n)?)
        }
        0x10 => {
            let n = count(r)?;
            if n == 0 {
                return Ok(Value::Sets(Vec::new()));
            }
            let _element_type = r.u32()?;
            if n > r.remaining() / 2 {
                return Err(Damage::new("an array lists more property sets than it holds"));
            }
            let mut sets = Vec::with_capacity(n);
            for _ in 0..n {
                sets.push(set(r, streams, depth + 1)?);
            }
            Value::Sets(sets)
        }
        0x11 => Value::Sets(vec![set(r, streams, depth + 1)?]),
        other => return Err(Damage::new(format!("a property has an unknown type ({other:#x})"))),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn le(words: &[u32]) -> Vec<u8> {
        words.iter().flat_map(|w| w.to_le_bytes()).collect()
    }

    #[test]
    fn references_come_from_the_streams_in_property_order() {
        let guid = Guid([7; 16]);
        let table = IdTable::from([(1, guid)]);
        // Two object IDs and no object space stream; then 3 properties: a bool, an array of 2 objects, 4 bytes.
        let mut data = le(&[0x8000_0002, 0x0000_0105, 0x0000_0106]);
        data.extend_from_slice(&3u16.to_le_bytes());
        data.extend(le(&[0x8800_1C04, 0x2400_1C20, 0x1400_1C01, 2, 99]));
        let set = parse(&data, &table).expect("parses");
        assert!(set.flag(0x0800_1C04));
        let ids = set.objects(0x2400_1C20);
        assert_eq!(ids, &[ExGuid { guid, n: 5 }, ExGuid { guid, n: 6 }]);
        assert_eq!(set.number(0x1400_1C01), Some(99));
    }

    #[test]
    fn counts_larger_than_the_data_are_refused() {
        let table = IdTable::new();
        assert!(parse(&le(&[0x80FF_FFFF]), &table).is_err());
        let mut data = le(&[0x8000_0000]);
        data.extend_from_slice(&1u16.to_le_bytes());
        data.extend(le(&[0x2400_1C20, 50]));
        assert!(parse(&data, &table).is_err());
    }
}
