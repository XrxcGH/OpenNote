//! Reading archives that NSKeyedArchiver wrote: a binary property list whose `$objects` array holds every object, and whose
//! dictionaries point at one another with UID references (Apple's public Foundation documentation).
//!
//! Every lookup follows at most [`MAX_HOPS`] references, so a reference loop ends instead of spinning.

use super::bplist::{Obj, Plist};

/// The most UID references one lookup follows.
const MAX_HOPS: usize = 8;

/// An archive over a parsed property list.
pub struct Keyed<'p, 'a> {
    plist: &'p Plist<'a>,
    /// The plist indexes of `$objects`, so UID `n` is `objects[n]`.
    objects: Vec<usize>,
}

impl<'p, 'a> Keyed<'p, 'a> {
    /// The archive in a property list, or `None` when it has no `$objects`.
    pub fn new(plist: &'p Plist<'a>) -> Option<Keyed<'p, 'a>> {
        let list = plist.dict_get(plist.top(), "$objects")?;
        let Some(Obj::Array(objects)) = plist.get(list) else {
            return None;
        };
        Some(Keyed {
            plist,
            objects: objects.clone(),
        })
    }

    /// The plist indexes of every archived object, in archive order.
    pub fn objects(&self) -> &[usize] {
        &self.objects
    }

    /// The object an index names, with UID references followed.
    pub fn resolve(&self, mut index: usize) -> usize {
        for _ in 0..MAX_HOPS {
            match self.plist.get(index) {
                Some(Obj::Uid(uid)) => match usize::try_from(*uid).ok().and_then(|u| self.objects.get(u)) {
                    Some(next) => index = *next,
                    None => return usize::MAX,
                },
                _ => return index,
            }
        }
        usize::MAX
    }

    /// The value of a key of a dictionary, resolved.
    pub fn get(&self, dict: usize, key: &str) -> Option<usize> {
        let dict = self.resolve(dict);
        self.plist.dict_get(dict, key).map(|v| self.resolve(v))
    }

    /// The class name of an archived object (`$class` → `$classname`).
    pub fn class_name(&self, object: usize) -> Option<String> {
        let class = self.get(object, "$class")?;
        self.string(self.get(class, "$classname")?)
    }

    /// Text: a string object, or an `NSString` archived as a dictionary with `NS.string`.
    pub fn string(&self, index: usize) -> Option<String> {
        let index = self.resolve(index);
        self.plist.string(index).or_else(|| {
            self.plist
                .dict_get(index, "NS.string")
                .and_then(|s| self.plist.string(self.resolve(s)))
        })
    }

    /// Bytes: a data object, or an `NSData` archived as a dictionary with `NS.data`.
    pub fn data(&self, index: usize) -> Option<&'a [u8]> {
        let index = self.resolve(index);
        self.plist.data(index).or_else(|| {
            self.plist
                .dict_get(index, "NS.data")
                .and_then(|d| self.plist.data(self.resolve(d)))
        })
    }

    /// A number.
    pub fn number(&self, index: usize) -> Option<f64> {
        match self.plist.get(self.resolve(index))? {
            #[allow(clippy::cast_precision_loss)]
            Obj::Int(n) => Some(*n as f64),
            Obj::Real(r) if r.is_finite() => Some(*r),
            _ => None,
        }
    }

    /// The members of an array: a plist array, or an `NSArray` archived with `NS.objects`.
    pub fn array(&self, index: usize) -> Vec<usize> {
        let index = self.resolve(index);
        let list = match self.plist.get(index) {
            Some(Obj::Array(items)) => Some(items),
            Some(Obj::Dict(_)) => {
                self.plist
                    .dict_get(index, "NS.objects")
                    .and_then(|o| match self.plist.get(self.resolve(o)) {
                        Some(Obj::Array(items)) => Some(items),
                        _ => None,
                    })
            }
            _ => None,
        };
        list.map(|items| items.iter().map(|i| self.resolve(*i)).collect())
            .unwrap_or_default()
    }

    /// Every archived dictionary that has a key, in archive order.
    pub fn dicts_with(&self, key: &str) -> Vec<usize> {
        self.objects
            .iter()
            .copied()
            .filter(|o| self.plist.dict_get(*o, key).is_some())
            .collect()
    }
}
