//! The lines a writer prints: `READY`, `ACK <page> <n>`, `SAVE <page> <step>`, and `TREE <op> <node> ...`.

use std::collections::BTreeMap;

/// What the parent read from one writer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Markers {
    /// Whether the writer finished recovering and started editing.
    pub ready: bool,
    /// Each page's highest acknowledged step.
    pub acks: BTreeMap<String, u64>,
    /// Save steps, in order.
    pub saves: Vec<(String, String)>,
    /// Tree changes that returned, in order, each as its words after `TREE`.
    pub tree: Vec<Vec<String>>,
    /// Lines that matched nothing.
    pub other: Vec<String>,
}

/// The kind of a line, for the parent's kill timing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// `READY`.
    Ready,
    /// `ACK`.
    Ack,
    /// `SAVE`.
    Save,
    /// `TREE`.
    Tree,
    /// Anything else.
    Other,
}

impl Markers {
    /// Takes in one line, and says what kind it was.
    pub fn take(&mut self, line: &str) -> Kind {
        let words: Vec<&str> = line.split_whitespace().collect();
        match words.as_slice() {
            ["READY"] => {
                self.ready = true;
                Kind::Ready
            }
            ["ACK", page, n] => match n.parse::<u64>() {
                Ok(n) => {
                    let entry = self.acks.entry((*page).to_owned()).or_default();
                    *entry = (*entry).max(n);
                    Kind::Ack
                }
                Err(_) => self.other(line),
            },
            ["SAVE", page, step] => {
                self.saves.push(((*page).to_owned(), (*step).to_owned()));
                Kind::Save
            }
            ["TREE", rest @ ..] if !rest.is_empty() => {
                self.tree.push(rest.iter().map(|w| (*w).to_owned()).collect());
                Kind::Tree
            }
            _ => self.other(line),
        }
    }

    fn other(&mut self, line: &str) -> Kind {
        self.other.push(line.to_owned());
        Kind::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_kind_of_line() {
        let mut markers = Markers::default();
        assert_eq!(markers.take("READY"), Kind::Ready);
        assert_eq!(markers.take("ACK p1 5"), Kind::Ack);
        assert_eq!(markers.take("ACK p1 3"), Kind::Ack);
        assert_eq!(markers.take("SAVE p1 page"), Kind::Save);
        assert_eq!(markers.take("TREE create 01abc"), Kind::Tree);
        assert_eq!(markers.take("ACK p1 x"), Kind::Other);
        assert_eq!(markers.take("hello"), Kind::Other);
        assert!(markers.ready);
        assert_eq!(markers.acks.get("p1"), Some(&5));
        assert_eq!(markers.saves, [("p1".to_owned(), "page".to_owned())]);
        assert_eq!(markers.tree, [vec!["create".to_owned(), "01abc".to_owned()]]);
        assert_eq!(markers.other.len(), 2);
    }
}
