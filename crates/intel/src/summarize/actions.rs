//! Tasks and decisions found in a transcript, as suggestions for the person to accept.
//!
//! This is plain pattern matching, with no model. A sentence is a task when it makes a commitment, such
//! as "I'll", "we need to", "Maria will", or "remember to". It is a decision when it records a choice,
//! such as "we decided" or "let's go with".
//!
//! A question, a hedge ("maybe", "if"), and a negation ("no need to") are skipped. The matching misses
//! what is said in other words, and it sometimes lists what is not a task. That is why the interface shows
//! these as suggestions and adds nothing without a click.

use serde::{Deserialize, Serialize};

use crate::text::{split_sentences, words, Word};
use crate::transcribe::Transcript;

/// What the sentence records.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionKind {
    /// Something someone is to do.
    Task,
    /// A choice the group made.
    Decision,
}

/// A task or decision, and where it was said.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionItem {
    /// Whether it is a task or a decision.
    pub kind: ActionKind,
    /// The sentence as transcribed.
    pub text: String,
    /// The transcript segment it came from.
    pub segment: usize,
    /// When that segment starts, in milliseconds, so the interface can link to the moment.
    pub start_ms: u64,
    /// The person named as responsible, such as "Maria". Absent when the speaker takes it on, or no one is named.
    pub owner: Option<String>,
    /// The deadline as said, such as "by Friday" or "next week". The interface parses it.
    pub due: Option<String>,
}

// Each list is one string with its items between bars, so a list of phrases stays compact.
const TASK: &str = "i will|i'll|we will|we'll|let's|need to|needs to|have to|has to|make sure|remember to|\
    don't forget|action item|to do|todo|follow up|i'm going to|i am going to|we're going to|we are going to";
const DECISION: &str = "we decided|we've decided|we have decided|we agreed|we've agreed|we have agreed|decision|\
    we're going with|we are going with|let's go with|we'll go with|we will go with|the plan is|we chose|\
    we picked|we settled on";
/// Words that make a sentence a hedge or a denial.
const SKIP: &str = "maybe|might|perhaps|if|whether|could|no need to|don't need to|do not need to|\
    doesn't need to|won't need to|didn't|wouldn't";
const WEEKDAYS: &str = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const MONTHS: &str = "january|february|march|april|may|june|july|august|september|october|november|december|\
    jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const NAMED_DAYS: &str = "tomorrow|tonight|today|eod|eow";
const PERIODS: &str = "week|month|year|quarter|morning|afternoon|evening";
const DEADLINE_STARTS: &str = "by|before|until|due|on|this|next";
/// Capitalized words that can come before "will" or "to" without being a person's name.
const NOT_NAMES: &str = "I|We|You|They|He|She|It|Let|And|But|So|Then|Everyone|Someone|Nobody|Anyone|Everybody|\
    Somebody|Who|That|This|There|What|Which|Remember|Need|Needs|Want|Wants|Try|Plan|Plans|Have|Has|Going|\
    Ready|Able|Time|Reminder|Do|Not|Please|Don't";

fn listed(list: &str, item: &str) -> bool {
    list.split('|').any(|entry| entry == item)
}

/// Finds the tasks and decisions in a transcript, in the order they were said.
pub fn find_action_items(transcript: &Transcript) -> Vec<ActionItem> {
    let mut found = Vec::new();
    for (segment, piece) in transcript.segments.iter().enumerate() {
        for range in split_sentences(&piece.text) {
            let sentence = &piece.text[range];
            let Some(kind) = classify(sentence) else {
                continue;
            };
            let tokens = words(sentence);
            found.push(ActionItem {
                kind,
                text: sentence.replace(['\n', '\r'], " "),
                segment,
                start_ms: piece.start_ms,
                owner: named_doer(sentence, &tokens),
                due: due_of(sentence, &tokens),
            });
        }
    }
    found
}

/// A sentence in lowercase words with single spaces and one space at each end, for whole-phrase matching.
fn padded(sentence: &str) -> String {
    let spaced: String = sentence
        .to_lowercase()
        .replace('\u{2019}', "'")
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '\'' { c } else { ' ' })
        .collect();
    format!(" {} ", spaced.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn has_phrase(padded: &str, phrases: &str) -> bool {
    phrases.split('|').any(|p| padded.contains(&format!(" {p} ")))
}

fn classify(sentence: &str) -> Option<ActionKind> {
    if sentence.trim_end().ends_with('?') {
        return None;
    }
    let text = padded(sentence);
    // A decision may mention an "if" and still be a decision, so it is checked before the hedges.
    if has_phrase(&text, DECISION) {
        return Some(ActionKind::Decision);
    }
    if has_phrase(&text, SKIP) {
        return None;
    }
    let tokens = words(sentence);
    (has_phrase(&text, TASK) || named_doer(sentence, &tokens).is_some()).then_some(ActionKind::Task)
}

/// "Maria will ...", or "Maria to ..." at the start of a list item: the capitalized name before the verb.
fn named_doer(sentence: &str, tokens: &[Word]) -> Option<String> {
    for (i, pair) in tokens.windows(2).enumerate() {
        let original = &sentence[pair[0].range.clone()];
        let capitalized = original.chars().next().is_some_and(char::is_uppercase)
            && original.chars().skip(1).all(char::is_lowercase)
            && original.chars().count() > 1;
        let after = tokens.get(i + 2).map_or("", |w| w.lower.as_str());
        let verb = match pair[1].lower.as_str() {
            "will" => !["be", "not", "have", "also"].contains(&after),
            "should" | "needs" | "has" => true,
            "to" => i == 0,
            _ => false,
        };
        if capitalized && verb && !listed(NOT_NAMES, original) {
            return Some(original.to_owned());
        }
    }
    None
}

/// The first deadline phrase, as the sentence says it.
fn due_of(sentence: &str, tokens: &[Word]) -> Option<String> {
    for (i, token) in tokens.iter().enumerate() {
        let starter = listed(DEADLINE_STARTS, &token.lower);
        let mut at = if starter { i + 1 } else { i };
        if starter && tokens.get(at).is_some_and(|t| t.lower == "the") {
            at += 1;
        }
        let reach = date_reach(tokens.get(at..).unwrap_or_default());
        let standalone = listed(NAMED_DAYS, &token.lower) || token.lower == "end";
        if reach > 0 && (starter || standalone) {
            let last = &tokens[at + reach - 1];
            return Some(sentence[token.range.start..last.range.end].to_owned());
        }
    }
    None
}

/// How many words from the start form a date: "friday", "march 3", "end of the day", "next week".
fn date_reach(tokens: &[Word]) -> usize {
    let lower = |k: usize| tokens.get(k).map_or("", |w| w.lower.as_str());
    if lower(0) == "end" {
        let at = if lower(2) == "the" { 3 } else { 2 };
        let closes = lower(1) == "of" && ["day", "week", "month", "year", "quarter"].contains(&lower(at));
        return if closes { at + 1 } else { 0 };
    }
    if listed(MONTHS, lower(0)) && lower(1).chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return 2;
    }
    let first = lower(0);
    let single = listed(WEEKDAYS, first) || listed(MONTHS, first) || listed(NAMED_DAYS, first);
    usize::from(single || listed(PERIODS, first))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcribe::{Device, Segment};

    fn transcript(lines: &[&str]) -> Transcript {
        Transcript {
            language: None,
            device: Device::Cpu,
            segments: lines
                .iter()
                .enumerate()
                .map(|(i, text)| Segment {
                    start_ms: i as u64 * 10_000,
                    end_ms: i as u64 * 10_000 + 9_000,
                    text: (*text).to_owned(),
                })
                .collect(),
        }
    }

    fn texts(items: &[ActionItem]) -> Vec<(&str, ActionKind)> {
        items.iter().map(|i| (i.text.as_str(), i.kind)).collect()
    }

    #[test]
    fn commitments_and_decisions_are_found_with_their_moments() {
        let items = find_action_items(&transcript(&[
            "Thanks for coming. We decided to ship the beta in March.",
            "I'll ask the security team about the library tomorrow.",
            "Let's go with option B for the export.",
        ]));
        assert_eq!(
            texts(&items),
            [
                ("We decided to ship the beta in March.", ActionKind::Decision),
                (
                    "I'll ask the security team about the library tomorrow.",
                    ActionKind::Task
                ),
                ("Let's go with option B for the export.", ActionKind::Decision),
            ]
        );
        assert_eq!((items[0].segment, items[1].start_ms, items[2].segment), (0, 10_000, 2));
    }

    #[test]
    fn owners_and_deadlines_are_read_from_the_sentence() {
        let items = find_action_items(&transcript(&[
            "Maria will draft the search design by Friday.",
            "Priya to book the beta testers.",
            "We need to update the schedule before March 3 for sure.",
            "Remember to send the notes at the end of the day.",
            "Dev should check the budget next week.",
            "Sync will be out of scope. We'll ship it by the end of the month.",
        ]));
        let shape: Vec<(Option<&str>, Option<&str>)> =
            items.iter().map(|i| (i.owner.as_deref(), i.due.as_deref())).collect();
        assert_eq!(
            shape,
            [
                (Some("Maria"), Some("by Friday")),
                (Some("Priya"), None),
                (None, Some("before March 3")),
                (None, Some("end of the day")),
                (Some("Dev"), Some("next week")),
                (None, Some("by the end of the month")),
            ]
        );
    }

    #[test]
    fn questions_hedges_and_denials_are_not_tasks() {
        let items = find_action_items(&transcript(&[
            "Do we need to ship in March?",
            "Maybe we should follow up with legal.",
            "If we have to move it, we will say so.",
            "There is no need to rewrite the parser.",
            "We could go with the old design.",
            "The weather was nice and the coffee was good.",
        ]));
        assert!(items.is_empty(), "{items:?}");
    }

    #[test]
    fn nothing_in_nothing_out() {
        assert!(find_action_items(&transcript(&[])).is_empty());
        assert!(find_action_items(&transcript(&["", "   "])).is_empty());
    }
}
