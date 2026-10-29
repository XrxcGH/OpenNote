//! The command palette (Ctrl+Shift+P): find any action by typing a few letters of its name.
//!
//! The palette holds a list of [`Command`]s that the interface registers, one for every action in the app. A
//! typed query matches a command's title, then its category and title together, then its keywords, with the
//! rules of [`crate::fuzzy`]. So `np` and `new pa` find "New page", `file new` finds it through its category, and
//! `remove` finds "Delete page" through a keyword. A command that cannot run now still appears, after the ones
//! that can, and says so, so the person learns that it exists and sees why it does nothing.
//!
//! An empty query lists the commands used lately, then the most used, then the rest by category. The palette
//! never runs anything. It answers with command IDs, and the interface runs the one the person picks and tells
//! the palette's owner to record the use.

use std::collections::HashMap;
use std::ops::Range;

use serde::{Deserialize, Serialize};

use crate::fuzzy::{fuzzy_match_strict, fuzzy_match_typo, FuzzyMatch, Haystack, MatchKind, Needle};
use crate::text::fold;

/// How many results a find returns when the context does not say.
pub const DEFAULT_LIMIT: usize = 50;
/// How many recent commands get a boost.
const RECENT_BOOSTED: usize = 10;
/// The most a command gains from being used often.
const MOST_FROM_USES: u32 = 24;
/// What a match through the category loses against one in the title alone.
const CATEGORY_PENALTY: u32 = 40;

/// An action the palette can offer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    /// A stable name that the interface runs, such as `page.new`. It never changes between versions.
    pub id: String,
    /// What the person reads, such as "New page".
    pub title: String,
    /// The area of the app, such as "File" or "Insert". It is part of what a query matches.
    pub category: String,
    /// Other words for the action, such as "remove" for "Delete page". They match with a lower score.
    #[serde(default)]
    pub keywords: Vec<String>,
    /// The shortcut as shown, such as "Ctrl+N", if the command has one.
    #[serde(default)]
    pub shortcut: Option<String>,
    /// Whether the command can run now. A command that cannot still shows, last, and says why not.
    #[serde(default = "enabled")]
    pub enabled: bool,
}

fn enabled() -> bool {
    true
}

/// What the palette knows about the person's habits.
#[derive(Clone, Debug, Default)]
pub struct PaletteContext {
    /// The commands run lately, latest first.
    pub recent: Vec<String>,
    /// How many times each command ran.
    pub uses: HashMap<String, u32>,
    /// The most results. Zero means [`DEFAULT_LIMIT`].
    pub limit: usize,
}

/// Where a command matched.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MatchedOn {
    /// The query is empty, so the command is listed by use.
    Nothing,
    /// The title, or the category and title together.
    Title,
    /// A keyword, which the interface may show beside the title.
    Keyword {
        /// The keyword.
        word: String,
    },
}

/// A command that matched.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteHit {
    /// The command's ID.
    pub id: String,
    /// Its title.
    pub title: String,
    /// Its category.
    pub category: String,
    /// Its shortcut, if it has one.
    pub shortcut: Option<String>,
    /// Whether it can run now.
    pub enabled: bool,
    /// How the query matched, or `None` for an empty query.
    pub kind: Option<MatchKind>,
    /// Where it matched.
    pub matched_on: MatchedOn,
    /// How well. Larger is better, and only the order means anything.
    pub score: u32,
    /// The byte ranges of the title to highlight.
    pub title_highlights: Vec<Range<usize>>,
    /// The byte ranges of the category to highlight.
    pub category_highlights: Vec<Range<usize>>,
    /// Where the command is in the recent list, 0 for the latest.
    pub recent: Option<usize>,
}

struct Prepared {
    command: Command,
    title: Haystack,
    /// "Category title", so a query can name both.
    combined: Haystack,
    /// Bytes of the combined text that belong to the category and the space after it.
    split: usize,
    keywords: Vec<Haystack>,
    /// The folded category and title, for putting equal scores in a steady order.
    order: String,
}

/// The commands, ready to match.
#[derive(Default)]
pub struct Palette {
    entries: Vec<Prepared>,
}

impl Palette {
    /// A palette over some commands. A command with an empty ID or title is left out, and so is a repeated ID.
    pub fn new(commands: Vec<Command>) -> Palette {
        let mut seen = std::collections::HashSet::new();
        let entries = commands
            .into_iter()
            .filter(|command| !command.id.is_empty() && !command.title.trim().is_empty())
            .filter(|command| seen.insert(command.id.clone()))
            .map(prepare)
            .collect();
        Palette { entries }
    }

    /// How many commands the palette holds.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the palette holds no commands.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Answers a query, best first.
    pub fn find(&self, query: &str, context: &PaletteContext) -> Vec<PaletteHit> {
        let limit = if context.limit == 0 {
            DEFAULT_LIMIT
        } else {
            context.limit
        };
        let mut hits = match Needle::new(query) {
            Some(needle) => self.matches(&needle, context),
            None => self.listed(context),
        };
        hits.truncate(limit);
        hits
    }

    /// The commands for an empty query: the recent ones, the most used, then the rest by category.
    fn listed(&self, context: &PaletteContext) -> Vec<PaletteHit> {
        let recent: HashMap<&str, usize> = context
            .recent
            .iter()
            .enumerate()
            .map(|(rank, id)| (id.as_str(), rank))
            .collect();
        let mut order: Vec<&Prepared> = self.entries.iter().collect();
        order.sort_by(|a, b| {
            let (x, y) = (a.command.id.as_str(), b.command.id.as_str());
            b.command
                .enabled
                .cmp(&a.command.enabled)
                .then(
                    recent
                        .get(x)
                        .unwrap_or(&usize::MAX)
                        .cmp(recent.get(y).unwrap_or(&usize::MAX)),
                )
                .then(uses(context, y).cmp(&uses(context, x)))
                .then_with(|| a.order.cmp(&b.order))
                .then_with(|| x.cmp(y))
        });
        order
            .into_iter()
            .map(|found| hit(found, None, MatchedOn::Nothing, 0, Vec::new(), Vec::new(), &recent))
            .collect()
    }

    fn matches(&self, needle: &Needle, context: &PaletteContext) -> Vec<PaletteHit> {
        let recent: HashMap<&str, usize> = context
            .recent
            .iter()
            .enumerate()
            .map(|(rank, id)| (id.as_str(), rank))
            .collect();
        let mut found: Vec<(u32, &Prepared, Found)> = Vec::new();
        for prepared in &self.entries {
            if let Some(matched) = best(needle, prepared, false) {
                found.push((boosted(prepared, &matched, &recent, context), prepared, matched));
            }
        }
        // A typo is the last resort, so it waits until nothing better than scattered letters has matched.
        if found
            .iter()
            .all(|(_, _, matched)| matched.kind == MatchKind::Subsequence)
        {
            for prepared in &self.entries {
                if let Some(matched) = best(needle, prepared, true) {
                    found.push((boosted(prepared, &matched, &recent, context), prepared, matched));
                }
            }
        }
        // A command that cannot run now comes after every command that can.
        found.sort_by(|(a, x, _), (b, y, _)| {
            y.command
                .enabled
                .cmp(&x.command.enabled)
                .then(b.cmp(a))
                .then_with(|| x.order.cmp(&y.order))
                .then_with(|| x.command.id.cmp(&y.command.id))
        });
        found
            .into_iter()
            .map(|(score, prepared, matched)| {
                let (title, category) = (matched.title, matched.category);
                hit(
                    prepared,
                    Some(matched.kind),
                    matched.on,
                    score,
                    title,
                    category,
                    &recent,
                )
            })
            .collect()
    }
}

fn prepare(command: Command) -> Prepared {
    let combined = format!("{} {}", command.category, command.title);
    let split = command.category.len() + 1;
    Prepared {
        title: Haystack::new(&command.title),
        combined: Haystack::new(&combined),
        split,
        keywords: command.keywords.iter().map(|word| Haystack::new(word)).collect(),
        order: fold(&combined),
        command,
    }
}

/// A match and where it was.
struct Found {
    kind: MatchKind,
    /// The score before boosts.
    score: u32,
    on: MatchedOn,
    title: Vec<Range<usize>>,
    category: Vec<Range<usize>>,
}

/// The best way a query matches a command: its title, then its category and title, then a keyword.
fn best(needle: &Needle, prepared: &Prepared, typo: bool) -> Option<Found> {
    let run = |hay: &Haystack| {
        if typo {
            fuzzy_match_typo(needle, hay)
        } else {
            fuzzy_match_strict(needle, hay)
        }
    };
    if let Some(matched) = run(&prepared.title) {
        return Some(found(matched, 0, MatchedOn::Title, |ranges| (ranges, Vec::new())));
    }
    if let Some(matched) = run(&prepared.combined) {
        let split = prepared.split;
        return Some(found(matched, CATEGORY_PENALTY, MatchedOn::Title, |ranges| {
            let (category, title): (Vec<_>, Vec<_>) = ranges.into_iter().partition(|range| range.start < split);
            let title = title
                .into_iter()
                .map(|range| range.start - split..range.end - split)
                .collect();
            (title, category)
        }));
    }
    prepared
        .keywords
        .iter()
        .zip(&prepared.command.keywords)
        .filter_map(|(hay, word)| run(hay).map(|matched| (matched, word)))
        .max_by_key(|(matched, _)| matched.score)
        .map(|(matched, word)| {
            let on = MatchedOn::Keyword { word: word.clone() };
            // A keyword is a guess at what the person means, so it never beats the same match in the title.
            let mut keyword = found(matched, 0, on, |_| (Vec::new(), Vec::new()));
            keyword.score /= 2;
            keyword
        })
}

type Split = (Vec<Range<usize>>, Vec<Range<usize>>);

fn found(matched: FuzzyMatch, penalty: u32, on: MatchedOn, split: impl FnOnce(Vec<Range<usize>>) -> Split) -> Found {
    let (title, category) = split(matched.ranges);
    Found {
        kind: matched.kind,
        score: matched.score.saturating_sub(penalty),
        on,
        title,
        category,
    }
}

fn uses(context: &PaletteContext, id: &str) -> u32 {
    context.uses.get(id).copied().unwrap_or(0)
}

/// A match score with the boosts for habits and the penalty for a command that cannot run.
fn boosted(prepared: &Prepared, matched: &Found, recent: &HashMap<&str, usize>, context: &PaletteContext) -> u32 {
    let id = prepared.command.id.as_str();
    let from_recent = recent
        .get(id)
        .map_or(0, |rank| RECENT_BOOSTED.saturating_sub(*rank) as u32 * 3);
    matched.score + from_recent + uses(context, id).min(MOST_FROM_USES)
}

fn hit(
    prepared: &Prepared,
    kind: Option<MatchKind>,
    matched_on: MatchedOn,
    score: u32,
    title_highlights: Vec<Range<usize>>,
    category_highlights: Vec<Range<usize>>,
    recent: &HashMap<&str, usize>,
) -> PaletteHit {
    let command = &prepared.command;
    PaletteHit {
        id: command.id.clone(),
        title: command.title.clone(),
        category: command.category.clone(),
        shortcut: command.shortcut.clone(),
        enabled: command.enabled,
        kind,
        matched_on,
        score,
        title_highlights,
        category_highlights,
        recent: recent.get(command.id.as_str()).copied(),
    }
}

#[cfg(test)]
mod tests;
