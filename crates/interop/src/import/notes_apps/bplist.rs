//! A reader of Apple's binary property lists (`bplist00`), the encoding of Notability's `Session.plist`.
//!
//! The layout comes from Apple's public description of the format: an 8-byte header, the objects, a table of
//! their offsets, and a 32-byte trailer that says how wide the offsets and references are, how many objects there
//! are, and which one is the top. Each object starts with a marker byte whose high four bits give its type and
//! whose low four bits give its size, or `0xF` when an integer object with the size follows.
//!
//! The reader is written for hostile files. It reads each object once, into a flat table whose arrays and
//! dictionaries hold the indexes of other objects, so a list that names the same object a million times costs a
//! million indexes and never a copy of the object. Strings and data stay as ranges of the input until they are
//! asked for. Every offset, length, and count is checked against the input before use, with checked arithmetic.

use std::ops::Range;

/// The most objects a property list may hold. Notability's sessions hold a few thousand.
pub const MAX_OBJECTS: u64 = 1 << 21;
/// The most references all arrays and dictionaries may hold together.
pub const MAX_REFS: usize = 1 << 23;

/// One object of a property list.
#[derive(Clone, Debug, PartialEq)]
pub enum Obj {
    /// `null` or a fill byte.
    Null,
    /// A boolean.
    Bool(bool),
    /// An integer. 16-byte integers keep their low 8 bytes.
    Int(i64),
    /// A floating-point number or a date (seconds since 2001).
    Real(f64),
    /// Bytes, as a range of the input.
    Data(Range<usize>),
    /// ASCII text, as a range of the input.
    Ascii(Range<usize>),
    /// UTF-16 text in big-endian order, as a range of the input.
    Utf16(Range<usize>),
    /// A reference to an entry of `$objects`, as NSKeyedArchiver writes it.
    Uid(u64),
    /// An array or a set: the indexes of its members.
    Array(Vec<usize>),
    /// A dictionary: the indexes of its keys and values.
    Dict(Vec<(usize, usize)>),
}

/// A parsed property list.
#[derive(Debug)]
pub struct Plist<'a> {
    bytes: &'a [u8],
    objects: Vec<Obj>,
    top: usize,
}

/// Why a property list could not be read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlistError(pub &'static str);

type Parsed<T> = std::result::Result<T, PlistError>;

fn bad<T>(why: &'static str) -> Parsed<T> {
    Err(PlistError(why))
}

/// Reads `bytes` big-endian as an unsigned integer of `width` bytes (1 to 8).
fn be(bytes: &[u8], at: usize, width: usize) -> Parsed<u64> {
    let end = at.checked_add(width).ok_or(PlistError("an offset overflows"))?;
    let slice = bytes.get(at..end).ok_or(PlistError("a value runs past the end"))?;
    if width == 0 || width > 8 {
        return bad("an integer has a width the format does not allow");
    }
    Ok(slice.iter().fold(0u64, |n, b| (n << 8) | u64::from(*b)))
}

fn index(value: u64) -> Parsed<usize> {
    usize::try_from(value).map_err(|_| PlistError("an offset is too large"))
}

impl<'a> Plist<'a> {
    /// Parses a binary property list.
    pub fn parse(bytes: &'a [u8]) -> Parsed<Plist<'a>> {
        if bytes.len() < 40 || !bytes.starts_with(b"bplist0") {
            return bad("it is not a binary property list");
        }
        let trailer = bytes.len() - 32;
        let offset_width = usize::from(*bytes.get(trailer + 6).ok_or(PlistError("short trailer"))?);
        let ref_width = usize::from(*bytes.get(trailer + 7).ok_or(PlistError("short trailer"))?);
        let count = be(bytes, trailer + 8, 8)?;
        let top = be(bytes, trailer + 16, 8)?;
        let table = index(be(bytes, trailer + 24, 8)?)?;
        if count == 0 || count > MAX_OBJECTS || top >= count {
            return bad("the object count is out of range");
        }
        if !(1..=8).contains(&offset_width) || !(1..=8).contains(&ref_width) {
            return bad("the offset or reference width is out of range");
        }
        let count = index(count)?;
        let table_len = count
            .checked_mul(offset_width)
            .ok_or(PlistError("the offset table overflows"))?;
        let table_end = table
            .checked_add(table_len)
            .ok_or(PlistError("the offset table overflows"))?;
        if table < 8 || table_end > trailer {
            return bad("the offset table lies outside the file");
        }
        let mut reader = Reader {
            bytes,
            count,
            ref_width,
            end: table,
            refs: 0,
        };
        let mut objects = Vec::with_capacity(count.min(bytes.len()));
        for n in 0..count {
            let offset = index(be(bytes, table + n * offset_width, offset_width)?)?;
            objects.push(reader.object(offset)?);
        }
        Ok(Plist {
            bytes,
            objects,
            top: index(top)?,
        })
    }

    /// The index of the top object.
    pub fn top(&self) -> usize {
        self.top
    }

    /// The object at an index.
    pub fn get(&self, index: usize) -> Option<&Obj> {
        self.objects.get(index)
    }

    /// How many objects there are.
    pub fn len(&self) -> usize {
        self.objects.len()
    }

    /// Whether there are no objects. A parsed list always has its top object.
    pub fn is_empty(&self) -> bool {
        self.objects.is_empty()
    }

    /// The text of a string object.
    pub fn string(&self, index: usize) -> Option<String> {
        match self.objects.get(index)? {
            Obj::Ascii(range) => Some(String::from_utf8_lossy(self.bytes.get(range.clone())?).into_owned()),
            Obj::Utf16(range) => {
                let raw = self.bytes.get(range.clone())?;
                let units: Vec<u16> = raw.as_chunks::<2>().0.iter().map(|c| u16::from_be_bytes(*c)).collect();
                Some(String::from_utf16_lossy(&units))
            }
            _ => None,
        }
    }

    /// The bytes of a data object.
    pub fn data(&self, index: usize) -> Option<&'a [u8]> {
        match self.objects.get(index)? {
            Obj::Data(range) => self.bytes.get(range.clone()),
            _ => None,
        }
    }

    /// The value of a dictionary's key, where keys are strings.
    pub fn dict_get(&self, dict: usize, key: &str) -> Option<usize> {
        let Obj::Dict(pairs) = self.objects.get(dict)? else {
            return None;
        };
        pairs.iter().find(|(k, _)| self.key_is(*k, key)).map(|(_, v)| *v)
    }

    fn key_is(&self, index: usize, key: &str) -> bool {
        match self.objects.get(index) {
            Some(Obj::Ascii(range)) => self.bytes.get(range.clone()) == Some(key.as_bytes()),
            Some(Obj::Utf16(_)) => self.string(index).as_deref() == Some(key),
            _ => false,
        }
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    count: usize,
    ref_width: usize,
    /// Objects end where the offset table starts.
    end: usize,
    refs: usize,
}

impl Reader<'_> {
    fn byte(&self, at: usize) -> Parsed<u8> {
        if at >= self.end {
            return bad("an object lies outside the object area");
        }
        self.bytes
            .get(at)
            .copied()
            .ok_or(PlistError("an object runs past the end"))
    }

    /// A range of `len` units of `unit` bytes from `at`, checked against the object area.
    fn span(&self, at: usize, len: usize, unit: usize) -> Parsed<Range<usize>> {
        let bytes = len.checked_mul(unit).ok_or(PlistError("a length overflows"))?;
        let end = at.checked_add(bytes).ok_or(PlistError("a length overflows"))?;
        if end > self.end {
            return bad("an object runs past the object area");
        }
        Ok(at..end)
    }

    /// The length of a variable object: the marker's low bits, or an integer object after the marker.
    fn length(&self, at: usize, info: u8) -> Parsed<(usize, usize)> {
        if info != 0x0F {
            return Ok((usize::from(info), at + 1));
        }
        let marker = self.byte(at + 1)?;
        if marker >> 4 != 0x1 {
            return bad("a length is not an integer");
        }
        let width = 1usize << (marker & 0x0F).min(3);
        let len = index(be(self.bytes, at + 2, width)?)?;
        if len > self.end {
            return bad("a length is longer than the file");
        }
        Ok((len, at + 2 + width))
    }

    fn reference(&self, at: usize) -> Parsed<usize> {
        let target = index(be(self.bytes, at, self.ref_width)?)?;
        if target >= self.count {
            return bad("a reference names an object that does not exist");
        }
        Ok(target)
    }

    fn references(&mut self, at: usize, count: usize) -> Parsed<Vec<usize>> {
        self.refs = self.refs.checked_add(count).ok_or(PlistError("too many references"))?;
        if self.refs > MAX_REFS {
            return bad("the list holds too many references");
        }
        let range = self.span(at, count, self.ref_width)?;
        range.step_by(self.ref_width).map(|at| self.reference(at)).collect()
    }

    fn object(&mut self, at: usize) -> Parsed<Obj> {
        let marker = self.byte(at)?;
        let info = marker & 0x0F;
        Ok(match marker >> 4 {
            0x0 => match info {
                0x8 => Obj::Bool(false),
                0x9 => Obj::Bool(true),
                _ => Obj::Null,
            },
            0x1 => {
                let width = 1usize << info.min(4);
                let start = if width == 16 { at + 9 } else { at + 1 };
                let raw = be(self.bytes, start, width.min(8))?;
                self.span(at + 1, width, 1)?;
                // One to four byte integers are unsigned, eight byte ones are signed.
                #[allow(clippy::cast_possible_wrap)]
                Obj::Int(raw as i64)
            }
            0x2 => {
                let range = self.span(at + 1, 1usize << info.min(3), 1)?;
                Obj::Real(real(self.bytes.get(range).unwrap_or_default()))
            }
            0x3 => {
                let range = self.span(at + 1, 8, 1)?;
                Obj::Real(real(self.bytes.get(range).unwrap_or_default()))
            }
            0x4 => {
                let (len, start) = self.length(at, info)?;
                Obj::Data(self.span(start, len, 1)?)
            }
            0x5 => {
                let (len, start) = self.length(at, info)?;
                Obj::Ascii(self.span(start, len, 1)?)
            }
            0x6 => {
                let (len, start) = self.length(at, info)?;
                Obj::Utf16(self.span(start, len, 2)?)
            }
            0x8 => Obj::Uid(be(self.bytes, at + 1, usize::from(info) + 1)?),
            0xA | 0xC => {
                let (len, start) = self.length(at, info)?;
                Obj::Array(self.references(start, len)?)
            }
            0xD => {
                let (len, start) = self.length(at, info)?;
                let keys = self.references(start, len)?;
                let values_at = start
                    .checked_add(
                        len.checked_mul(self.ref_width)
                            .ok_or(PlistError("a length overflows"))?,
                    )
                    .ok_or(PlistError("a length overflows"))?;
                let values = self.references(values_at, len)?;
                Obj::Dict(keys.into_iter().zip(values).collect())
            }
            _ => return bad("an object has a type the format does not define"),
        })
    }
}

fn real(bytes: &[u8]) -> f64 {
    match bytes.len() {
        4 => f64::from(f32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])),
        8 => {
            let mut b = [0u8; 8];
            b.copy_from_slice(bytes);
            f64::from_be_bytes(b)
        }
        _ => f64::NAN,
    }
}

/// Writes binary property lists, for the synthetic fixtures of the tests and the fuzz seeds.
#[cfg(any(test, feature = "testing", feature = "fuzzing"))]
pub mod write {
    /// A value to write.
    #[derive(Clone, Debug)]
    pub enum Value {
        /// An integer.
        Int(i64),
        /// A real number.
        Real(f64),
        /// A boolean.
        Bool(bool),
        /// Text.
        Str(String),
        /// Bytes.
        Data(Vec<u8>),
        /// A reference to an entry of `$objects`.
        Uid(u64),
        /// An array.
        Array(Vec<Value>),
        /// A dictionary with string keys, in order.
        Dict(Vec<(String, Value)>),
    }

    /// Writes a value as a `bplist00` file with 8-byte offsets and 4-byte references.
    pub fn plist(value: &Value) -> Vec<u8> {
        let mut objects: Vec<Vec<u8>> = Vec::new();
        let top = add(value, &mut objects);
        let mut out = b"bplist00".to_vec();
        let mut offsets = Vec::new();
        for object in &objects {
            offsets.push(out.len() as u64);
            out.extend_from_slice(object);
        }
        let table = out.len() as u64;
        for offset in offsets {
            out.extend_from_slice(&offset.to_be_bytes());
        }
        out.extend_from_slice(&[0, 0, 0, 0, 0, 0, 8, 4]);
        out.extend_from_slice(&(objects.len() as u64).to_be_bytes());
        out.extend_from_slice(&(top as u64).to_be_bytes());
        out.extend_from_slice(&table.to_be_bytes());
        out
    }

    fn marker(kind: u8, len: usize, out: &mut Vec<u8>) {
        if len < 15 {
            out.push((kind << 4) | len as u8);
        } else {
            out.push((kind << 4) | 0x0F);
            out.push(0x13);
            out.extend_from_slice(&(len as u64).to_be_bytes());
        }
    }

    fn add(value: &Value, objects: &mut Vec<Vec<u8>>) -> usize {
        let at = objects.len();
        objects.push(Vec::new());
        let mut out = Vec::new();
        match value {
            Value::Int(n) => {
                out.push(0x13);
                out.extend_from_slice(&n.to_be_bytes());
            }
            Value::Real(r) => {
                out.push(0x23);
                out.extend_from_slice(&r.to_be_bytes());
            }
            Value::Bool(b) => out.push(if *b { 0x09 } else { 0x08 }),
            Value::Str(s) if s.is_ascii() => {
                marker(0x5, s.len(), &mut out);
                out.extend_from_slice(s.as_bytes());
            }
            Value::Str(s) => {
                let units: Vec<u16> = s.encode_utf16().collect();
                marker(0x6, units.len(), &mut out);
                for unit in units {
                    out.extend_from_slice(&unit.to_be_bytes());
                }
            }
            Value::Data(d) => {
                marker(0x4, d.len(), &mut out);
                out.extend_from_slice(d);
            }
            Value::Uid(n) => {
                out.push(0x83);
                out.extend_from_slice(&(*n as u32).to_be_bytes());
            }
            Value::Array(items) => {
                let refs: Vec<usize> = items.iter().map(|v| add(v, objects)).collect();
                marker(0xA, refs.len(), &mut out);
                for r in refs {
                    out.extend_from_slice(&(r as u32).to_be_bytes());
                }
            }
            Value::Dict(pairs) => {
                let keys: Vec<usize> = pairs
                    .iter()
                    .map(|(k, _)| add(&Value::Str(k.clone()), objects))
                    .collect();
                let values: Vec<usize> = pairs.iter().map(|(_, v)| add(v, objects)).collect();
                marker(0xD, keys.len(), &mut out);
                for r in keys.into_iter().chain(values) {
                    out.extend_from_slice(&(r as u32).to_be_bytes());
                }
            }
        }
        objects[at] = out;
        at
    }
}
