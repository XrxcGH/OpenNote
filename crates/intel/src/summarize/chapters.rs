//! Chapters for a transcript: where the talk changes topic, and a title for each stretch.
//!
//! A topic change is where the words on one side of a point stop resembling the words on the other.
//! For each gap between segments, the code compares the terms of the few segments before it with the few
//! after it, using cosine similarity. It then looks for gaps where the similarity drops lower than the
//! gaps around it. This is the TextTiling method.
//!
//! The deepest drops that leave each chapter long enough become the chapter breaks. A chapter's title is
//! its best keywords.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::analysis::Analysis;
use super::keywords;
use super::{check_size, KeywordOptions};
use crate::error::IntelError;
use crate::geometry::Language;
use crate::transcribe::Transcript;

/// How to cut a transcript into chapters.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChapterOptions {
    /// The most chapters to make.
    pub max_chapters: usize,
    /// The shortest chapter, in milliseconds.
    pub min_chapter_ms: u64,
    /// The language of the talk, or `None` to detect it.
    pub language: Option<Language>,
}

impl Default for ChapterOptions {
    fn default() -> Self {
        ChapterOptions {
            max_chapters: 12,
            min_chapter_ms: 60_000,
            language: None,
        }
    }
}

/// One stretch of a talk on one topic.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    /// When it starts, in milliseconds from the start of the recording.
    pub start_ms: u64,
    /// When it ends.
    pub end_ms: u64,
    /// The first transcript segment in it.
    pub first_segment: usize,
    /// The last transcript segment in it.
    pub last_segment: usize,
    /// A title made of its best keywords, or empty when the chapter has none. The interface picks its
    /// own words, such as "Part 2", for an empty title.
    pub title: String,
    /// Up to five keywords, best first.
    pub keywords: Vec<String>,
}

/// Cuts a transcript into chapters, in time order, that cover it from the first segment to the last.
pub fn make_chapters(transcript: &Transcript, options: &ChapterOptions) -> Result<Vec<Chapter>, IntelError> {
    let segments = &transcript.segments;
    if segments.is_empty() || options.max_chapters == 0 {
        return Ok(Vec::new());
    }
    let texts: Vec<&str> = segments.iter().map(|s| s.text.as_str()).collect();
    check_size(&texts.join("\n"))?;
    let vectors = segment_vectors(&texts, options.language.as_ref());
    let starts: Vec<u64> = segments.iter().map(|s| s.start_ms).collect();
    let end_ms = segments.last().map_or(0, |s| s.end_ms.max(s.start_ms));
    let breaks = if segments.len() < 6 {
        Vec::new()
    } else {
        choose_breaks(&depths(&vectors), &starts, end_ms, options)
    };
    let mut edges = vec![0];
    edges.extend(breaks.iter().map(|gap| gap + 1));
    edges.push(segments.len());
    let chapters = edges
        .windows(2)
        .map(|pair| {
            let (first, last) = (pair[0], pair[1] - 1);
            let text = texts[first..=last].join("\n");
            let found = title_words(&text, options.language.as_ref());
            Chapter {
                start_ms: starts[first],
                end_ms: if last + 1 < segments.len() {
                    starts[last + 1]
                } else {
                    end_ms
                },
                first_segment: first,
                last_segment: last,
                title: title_from(&found),
                keywords: found,
            }
        })
        .collect();
    Ok(chapters)
}

/// A dip shallower than this is ordinary change of wording, not a change of topic.
const MIN_DEPTH: f32 = 0.25;

type Vector = HashMap<u32, f32>;

/// The content terms of each segment with their counts, numbered across the whole talk.
fn segment_vectors(texts: &[&str], language: Option<&Language>) -> Vec<Vector> {
    let joined = texts.join("\n");
    let analysis = Analysis::new(&joined, language);
    let mut offsets = Vec::with_capacity(texts.len());
    let mut at = 0;
    for text in texts {
        offsets.push(at);
        at += text.len() + 1;
    }
    let mut ids: HashMap<&str, u32> = HashMap::new();
    let mut vectors: Vec<Vector> = vec![Vector::new(); texts.len()];
    let mut segment = 0;
    for (index, word) in analysis.words.iter().enumerate() {
        while segment + 1 < texts.len() && offsets[segment + 1] <= word.range.start {
            segment += 1;
        }
        if analysis.is_content(word) {
            let next = ids.len() as u32;
            let id = *ids.entry(analysis.key(index)).or_insert(next);
            *vectors[segment].entry(id).or_insert(0.0) += 1.0;
        }
    }
    vectors
}

fn add_into(total: &mut Vector, part: &Vector) {
    for (&term, &count) in part {
        *total.entry(term).or_insert(0.0) += count;
    }
}

/// The cosine of the angle between two term vectors. When either side has no terms the result is 1,
/// because silence is no evidence of a change of topic.
fn cosine(a: &Vector, b: &Vector) -> f32 {
    let norm = |v: &Vector| v.values().map(|x| x * x).sum::<f32>().sqrt();
    let (na, nb) = (norm(a), norm(b));
    if na == 0.0 || nb == 0.0 {
        return 1.0;
    }
    let dot: f32 = a.iter().filter_map(|(t, x)| b.get(t).map(|y| x * y)).sum();
    dot / (na * nb)
}

/// How sharply the similarity dips at each gap between segment `g` and `g + 1`.
///
/// A gap too near either end of the talk has too little text on one side to compare. It has no similarity
/// and no dip, and the dips of the gaps inside are measured against the gaps inside only.
fn depths(vectors: &[Vector]) -> Vec<f32> {
    let n = vectors.len();
    let window = (n / 12).clamp(2, 6);
    let (first, last) = (window - 1, n - window - 1);
    let similarity: Vec<f32> = (first..=last)
        .map(|g| {
            let (mut left, mut right) = (Vector::new(), Vector::new());
            vectors[g + 1 - window..=g].iter().for_each(|v| add_into(&mut left, v));
            vectors[g + 1..=g + window].iter().for_each(|v| add_into(&mut right, v));
            cosine(&left, &right)
        })
        .collect();
    (0..n - 1)
        .map(|g| {
            if g < first || g > last {
                return 0.0;
            }
            let at = g - first;
            let climb = |steps: &mut dyn Iterator<Item = usize>| {
                let mut peak = similarity[at];
                for k in steps {
                    if similarity[k] < peak {
                        break;
                    }
                    peak = similarity[k];
                }
                peak - similarity[at]
            };
            climb(&mut (0..at).rev()) + climb(&mut (at + 1..similarity.len()))
        })
        .collect()
}

/// The gaps to break at: the deepest dips that leave every chapter long enough.
fn choose_breaks(depth: &[f32], starts: &[u64], end_ms: u64, options: &ChapterOptions) -> Vec<usize> {
    let mean = depth.iter().sum::<f32>() / depth.len() as f32;
    let spread = (depth.iter().map(|d| (d - mean).powi(2)).sum::<f32>() / depth.len() as f32).sqrt();
    let cutoff = (mean + spread).max(MIN_DEPTH);
    let mut candidates: Vec<usize> = (0..depth.len())
        .filter(|&g| {
            depth[g] > cutoff
                && (g == 0 || depth[g] >= depth[g - 1])
                && depth.get(g + 1).is_none_or(|next| depth[g] >= *next)
        })
        .collect();
    candidates.sort_by(|&a, &b| depth[b].total_cmp(&depth[a]).then(a.cmp(&b)));
    let mut chosen: Vec<usize> = Vec::new();
    let first = starts[0];
    for gap in candidates {
        if chosen.len() + 1 >= options.max_chapters {
            break;
        }
        let at = starts[gap + 1];
        let room =
            at.saturating_sub(first) >= options.min_chapter_ms && end_ms.saturating_sub(at) >= options.min_chapter_ms;
        let apart = chosen
            .iter()
            .all(|&other| starts[other + 1].abs_diff(at) >= options.min_chapter_ms);
        if room && apart {
            chosen.push(gap);
        }
    }
    chosen.sort_unstable();
    chosen
}

fn title_words(text: &str, language: Option<&Language>) -> Vec<String> {
    let analysis = Analysis::new(text, language);
    let options = KeywordOptions {
        max_keywords: 5,
        max_words: 2,
        language: language.cloned(),
    };
    keywords::extract(&analysis, &options)
        .into_iter()
        .map(|k| k.text)
        .collect()
}

/// The first two keywords joined with "and", starting with a capital.
fn title_from(found: &[String]) -> String {
    let joined = found.iter().take(2).cloned().collect::<Vec<_>>().join(" and ");
    let mut chars = joined.chars();
    chars
        .next()
        .map(|c| c.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcribe::{Device, Segment};

    const PHOTOSYNTHESIS: [&str; 4] = [
        "Photosynthesis turns sunlight into chemical energy inside the chloroplast.",
        "Chlorophyll absorbs the sunlight, and the chloroplast stores that energy.",
        "The light reactions in the chloroplast split water and release oxygen.",
        "Plants use the stored energy to turn carbon dioxide into glucose.",
    ];
    const DATABASES: [&str; 4] = [
        "A database index speeds up queries on a large table.",
        "The index stores sorted keys, so the database avoids scanning the table.",
        "Writing a row means the database must update every index on the table.",
        "Choose the index columns by the queries your database runs most.",
    ];

    fn talk(parts: &[(&[&str], usize)]) -> Transcript {
        let mut segments = Vec::new();
        for (lines, repeats) in parts {
            for round in 0..*repeats {
                for line in *lines {
                    let start = segments.len() as u64 * 20_000;
                    let text = if round == 0 {
                        (*line).to_owned()
                    } else {
                        format!("{line} Again.")
                    };
                    segments.push(Segment {
                        start_ms: start,
                        end_ms: start + 19_000,
                        text,
                    });
                }
            }
        }
        Transcript {
            language: None,
            device: Device::Cpu,
            segments,
        }
    }

    #[test]
    fn a_change_of_topic_becomes_a_chapter_break_with_titles_from_each_topic() {
        let chapters = make_chapters(
            &talk(&[(&PHOTOSYNTHESIS, 3), (&DATABASES, 3)]),
            &ChapterOptions::default(),
        )
        .unwrap();
        assert_eq!(chapters.len(), 2, "{chapters:?}");
        // The break falls at segment 12, where the talk changes.
        assert!((11..=13).contains(&chapters[1].first_segment), "{:?}", chapters[1]);
        assert!(
            chapters[0].title.to_lowercase().contains("chloroplast")
                || chapters[0].title.to_lowercase().contains("energy")
                || chapters[0].title.to_lowercase().contains("sunlight"),
            "{}",
            chapters[0].title
        );
        assert!(
            chapters[1].title.to_lowercase().contains("database") || chapters[1].title.to_lowercase().contains("index"),
            "{}",
            chapters[1].title
        );
        assert!(!chapters[0].keywords.is_empty());
    }

    #[test]
    fn chapters_cover_the_talk_in_order_with_no_gaps() {
        let transcript = talk(&[(&PHOTOSYNTHESIS, 3), (&DATABASES, 3), (&PHOTOSYNTHESIS, 3)]);
        let chapters = make_chapters(&transcript, &ChapterOptions::default()).unwrap();
        assert!(chapters.len() >= 3, "{}", chapters.len());
        assert_eq!(chapters[0].first_segment, 0);
        assert_eq!(chapters.last().unwrap().last_segment, transcript.segments.len() - 1);
        for pair in chapters.windows(2) {
            assert_eq!(pair[0].last_segment + 1, pair[1].first_segment);
            assert_eq!(pair[0].end_ms, pair[1].start_ms);
        }
        assert!(chapters.iter().all(|c| c.end_ms - c.start_ms >= 60_000));
    }

    #[test]
    fn limits_on_count_and_length_are_kept() {
        let transcript = talk(&[(&PHOTOSYNTHESIS, 3), (&DATABASES, 3), (&PHOTOSYNTHESIS, 3)]);
        let one = ChapterOptions {
            max_chapters: 1,
            ..Default::default()
        };
        assert_eq!(make_chapters(&transcript, &one).unwrap().len(), 1);
        let long = ChapterOptions {
            min_chapter_ms: 10 * 60_000,
            ..Default::default()
        };
        assert_eq!(
            make_chapters(&transcript, &long).unwrap().len(),
            1,
            "a 12-minute talk has no 10-minute halves"
        );
    }

    #[test]
    fn a_talk_on_one_topic_is_one_chapter() {
        let chapters = make_chapters(&talk(&[(&PHOTOSYNTHESIS, 6)]), &ChapterOptions::default()).unwrap();
        assert_eq!(chapters.len(), 1);
        assert_eq!((chapters[0].start_ms, chapters[0].end_ms), (0, 24 * 20_000 - 1_000));
    }

    #[test]
    fn short_and_empty_talks_are_handled() {
        let options = ChapterOptions::default();
        assert!(make_chapters(&talk(&[]), &options).unwrap().is_empty());
        let short = make_chapters(&talk(&[(&PHOTOSYNTHESIS, 1)]), &options).unwrap();
        assert_eq!(short.len(), 1);
        let silent = Transcript {
            language: None,
            device: Device::Cpu,
            segments: (0..10)
                .map(|i| Segment {
                    start_ms: i * 5_000,
                    end_ms: i * 5_000 + 4_000,
                    text: String::new(),
                })
                .collect(),
        };
        let chapters = make_chapters(&silent, &options).unwrap();
        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].title, "");
    }
}
