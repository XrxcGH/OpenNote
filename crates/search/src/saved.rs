//! Saved searches: named queries that an app stores with the person's settings.
//!
//! They are not part of the index, which is a cache that can be deleted at any time. A saved search is something
//! a person made, so the caller keeps the JSON next to the notebook or the settings.

use serde::{Deserialize, Serialize};

use crate::error::{Result, SearchError};
use crate::query::Query;
use crate::text::fold;

/// The version of the JSON layout.
const VERSION: u32 = 1;

/// A query with a name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedSearch {
    /// The name the person chose. Names are unique when compared without case or accents.
    pub name: String,
    /// The search.
    pub query: Query,
}

/// A person's saved searches, in the order they made them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SavedSearches {
    items: Vec<SavedSearch>,
}

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    #[serde(default)]
    searches: Vec<SavedSearch>,
}

impl SavedSearches {
    /// An empty list.
    pub fn new() -> SavedSearches {
        SavedSearches::default()
    }

    /// The searches, in order.
    pub fn iter(&self) -> impl Iterator<Item = &SavedSearch> {
        self.items.iter()
    }

    /// How many searches there are.
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// Whether there are none.
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// The search with a name.
    pub fn get(&self, name: &str) -> Option<&SavedSearch> {
        self.position(name).map(|at| &self.items[at])
    }

    /// Adds a search, or fails when the name is empty or taken.
    pub fn add(&mut self, name: &str, query: Query) -> Result<()> {
        let name = name.trim();
        if name.is_empty() || self.position(name).is_some() {
            return Err(SearchError::SavedName(name.to_string()));
        }
        self.items.push(SavedSearch {
            name: name.to_string(),
            query,
        });
        Ok(())
    }

    /// Replaces the query of a search. Returns whether the search exists.
    pub fn update(&mut self, name: &str, query: Query) -> bool {
        match self.position(name) {
            Some(at) => {
                self.items[at].query = query;
                true
            }
            None => false,
        }
    }

    /// Renames a search, or fails when the new name is empty or taken by another search.
    pub fn rename(&mut self, name: &str, new_name: &str) -> Result<bool> {
        let new_name = new_name.trim();
        let Some(at) = self.position(name) else {
            return Ok(false);
        };
        if new_name.is_empty() || self.position(new_name).is_some_and(|other| other != at) {
            return Err(SearchError::SavedName(new_name.to_string()));
        }
        self.items[at].name = new_name.to_string();
        Ok(true)
    }

    /// Removes a search. Returns whether it existed.
    pub fn remove(&mut self, name: &str) -> bool {
        match self.position(name) {
            Some(at) => {
                self.items.remove(at);
                true
            }
            None => false,
        }
    }

    /// The searches as JSON, to store.
    pub fn to_json(&self) -> Result<String> {
        let file = File {
            version: VERSION,
            searches: self.items.clone(),
        };
        Ok(serde_json::to_string_pretty(&file)?)
    }

    /// Reads the searches from JSON. Unknown fields are ignored, and repeated names keep the first search.
    pub fn from_json(json: &str) -> Result<SavedSearches> {
        let file: File = serde_json::from_str(json)?;
        let mut list = SavedSearches::new();
        for search in file.searches {
            let mut query = search.query;
            query.text = crate::query::clamp_text(&query.text).to_string();
            // A repeated or empty name in a stored file is skipped, not treated as an error.
            let _ = list.add(&search.name, query);
        }
        Ok(list)
    }

    fn position(&self, name: &str) -> Option<usize> {
        let wanted = fold(name);
        self.items.iter().position(|item| fold(&item.name) == wanted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_unique_without_case() {
        let mut list = SavedSearches::new();
        list.add("Exam notes", Query::text("exam")).unwrap();
        assert!(list.add("exam NOTES", Query::text("x")).is_err());
        assert!(list.add("  ", Query::text("x")).is_err());
        assert_eq!(list.get("EXAM notes").unwrap().query.text, "exam");
    }

    #[test]
    fn renames_updates_and_removes() {
        let mut list = SavedSearches::new();
        list.add("a", Query::text("one")).unwrap();
        list.add("b", Query::text("two")).unwrap();
        assert!(list.rename("a", "b").is_err());
        assert!(list.rename("a", "A").unwrap());
        assert!(!list.rename("zzz", "y").unwrap());
        assert!(list.update("A", Query::text("three")));
        assert_eq!(list.get("a").unwrap().query.text, "three");
        assert!(list.remove("b"));
        assert!(!list.remove("b"));
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn round_trips_through_json_and_ignores_damage() {
        let mut list = SavedSearches::new();
        list.add(
            "Due this week",
            Query {
                tags: vec!["todo".into()],
                ..Query::text("lab")
            },
        )
        .unwrap();
        let json = list.to_json().unwrap();
        assert_eq!(SavedSearches::from_json(&json).unwrap(), list);
        let twice = r#"{"version":1,"searches":[{"name":"x","query":{}},{"name":"X","query":{"text":"y"}}],"more":1}"#;
        let read = SavedSearches::from_json(twice).unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read.get("x").unwrap().query, Query::default());
        assert!(SavedSearches::from_json("not json").is_err());
    }
}
