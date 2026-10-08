//! The notebooks and sections that an `in:` operator can name.

use opennote_core::{NotebookId, SectionId};

use crate::text::fold;

/// A notebook or a section that an `in:` operator can name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NamedPlace {
    /// A notebook.
    Notebook(NotebookId),
    /// A section.
    Section(SectionId),
}

/// The names of the notebooks and sections, which the index does not keep.
pub trait PlaceNames {
    /// The places with this name, as typed. An implementation should match ignoring case and accents, and
    /// match the start of a name when no name is equal, so `in:bio` works while the person is still typing.
    fn find(&self, name: &str) -> Vec<NamedPlace>;
}

/// A list of places, for a caller that has read the notebook tree.
#[derive(Clone, Debug, Default)]
pub struct PlaceList {
    places: Vec<(String, NamedPlace)>,
}

impl PlaceList {
    /// An empty list.
    pub fn new() -> PlaceList {
        PlaceList::default()
    }

    /// Adds a notebook.
    pub fn notebook(&mut self, name: &str, id: NotebookId) -> &mut PlaceList {
        self.places.push((fold(name), NamedPlace::Notebook(id)));
        self
    }

    /// Adds a section.
    pub fn section(&mut self, name: &str, id: SectionId) -> &mut PlaceList {
        self.places.push((fold(name), NamedPlace::Section(id)));
        self
    }
}

impl PlaceNames for PlaceList {
    fn find(&self, name: &str) -> Vec<NamedPlace> {
        let wanted = fold(name);
        if wanted.is_empty() {
            return Vec::new();
        }
        let exact: Vec<NamedPlace> = self
            .places
            .iter()
            .filter(|(folded, _)| *folded == wanted)
            .map(|(_, place)| *place)
            .collect();
        if !exact.is_empty() {
            return exact;
        }
        self.places
            .iter()
            .filter(|(folded, _)| folded.starts_with(&wanted))
            .map(|(_, place)| *place)
            .collect()
    }
}
