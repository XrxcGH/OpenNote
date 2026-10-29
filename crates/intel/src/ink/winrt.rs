//! The Windows handwriting recognizer, on top of Windows.UI.Input.Inking.Analysis.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use windows::core::Interface;
use windows::Foundation::Point;
use windows::UI::Input::Inking::Analysis::{
    IInkAnalysisNode, InkAnalysisInkWord, InkAnalysisLine, InkAnalysisNodeKind, InkAnalysisStrokeKind, InkAnalyzer,
};
use windows::UI::Input::Inking::{
    InkRecognizerContainer, InkStroke as WinStroke, InkStrokeBuilder, InkStrokeContainer,
};
use windows_collections::IIterable;

use super::{validate_all, InkLine, InkOptions, InkPoint, InkRecognition, InkRecognizer, InkStroke, InkWord};
use super::{StrokeKey, StrokeKind};
use crate::error::IntelError;
use crate::geometry::Rect;

/// The Ink Analysis API corrupts the heap when two analyzers run at once in one process, which
/// a test run with several threads showed. Every call takes this lock, so calls run one at a time.
static ANALYSIS: Mutex<()> = Mutex::new(());

/// Windows stroke ID to the stroke's position in the caller's list and the caller's key.
type StrokeIds = HashMap<u32, (usize, StrokeKey)>;

/// Handwriting recognition through the Windows Ink Analysis API. It reads in the languages the
/// person has handwriting recognition installed for.
#[derive(Debug, Default)]
pub struct WindowsInk;

impl WindowsInk {
    /// Creates the recognizer. Each call makes its own analyzer, so calls never share state.
    pub fn new() -> WindowsInk {
        WindowsInk
    }
}

impl InkRecognizer for WindowsInk {
    /// Ink Analysis reads words with the handwriting recognizers installed in Windows, one per language.
    fn check_ready(&self) -> Result<(), IntelError> {
        if InkRecognizerContainer::new()?.GetRecognizers()?.Size()? == 0 {
            return Err(IntelError::LanguageUnavailable(
                "handwriting in any language on this computer".to_owned(),
            ));
        }
        Ok(())
    }

    fn recognize(&self, strokes: &[InkStroke], options: &InkOptions) -> Result<InkRecognition, IntelError> {
        validate_all(strokes)?;
        if strokes.is_empty() {
            return Ok(InkRecognition::default());
        }
        let _one_at_a_time = ANALYSIS.lock().unwrap_or_else(PoisonError::into_inner);
        let analyzer = InkAnalyzer::new()?;
        let keys = add_strokes(&analyzer, strokes, options.kind)?;
        analyzer.AnalyzeAsync()?.join()?;
        collect_lines(&analyzer, &keys)
    }
}

/// Builds Windows strokes, adds them to the analyzer, and returns each Windows ID with the caller's
/// position and key for that stroke.
fn add_strokes(analyzer: &InkAnalyzer, strokes: &[InkStroke], kind: StrokeKind) -> Result<StrokeIds, IntelError> {
    let builder = InkStrokeBuilder::new()?;
    // A stroke gets its ID from the container that holds it, and the container keeps insertion order.
    let container = InkStrokeContainer::new()?;
    for stroke in strokes {
        container.AddStroke(&build_stroke(&builder, stroke)?)?;
    }
    let added = container.GetStrokes()?;
    let mut keys = StrokeIds::with_capacity(strokes.len());
    for (index, (win_stroke, stroke)) in added.into_iter().zip(strokes).enumerate() {
        let id = win_stroke.Id()?;
        analyzer.AddDataForStroke(&win_stroke)?;
        if kind == StrokeKind::Writing {
            analyzer.SetStrokeDataKind(id, InkAnalysisStrokeKind::Writing)?;
        }
        keys.insert(id, (index, stroke.key));
    }
    Ok(keys)
}

fn build_stroke(builder: &InkStrokeBuilder, stroke: &InkStroke) -> Result<WinStroke, IntelError> {
    let mut points: Vec<Point> = stroke
        .points
        .iter()
        .map(|&InkPoint { x, y }| Point { X: x, Y: y })
        .collect();
    if points.len() == 1 {
        // A dot has no direction, so give it a hair of length.
        points.push(Point {
            X: points[0].X + 0.01,
            Y: points[0].Y,
        });
    }
    Ok(builder.CreateStroke(&IIterable::<Point>::from(points))?)
}

fn collect_lines(analyzer: &InkAnalyzer, keys: &StrokeIds) -> Result<InkRecognition, IntelError> {
    let root = analyzer.AnalysisRoot()?;
    let mut lines = Vec::new();
    for node in root.FindNodes(InkAnalysisNodeKind::Line)? {
        let line: InkAnalysisLine = node.cast()?;
        let mut words = Vec::new();
        for child in line.Children()? {
            if child.Kind()? == InkAnalysisNodeKind::InkWord {
                words.push(convert_word(&child, keys)?);
            }
        }
        if !words.is_empty() {
            lines.push(InkLine {
                text: line.RecognizedText()?.to_string(),
                bounds: to_rect(line.BoundingRect()?),
                words,
            });
        }
    }
    Ok(InkRecognition { lines })
}

fn convert_word(node: &IInkAnalysisNode, keys: &StrokeIds) -> Result<InkWord, IntelError> {
    let word: InkAnalysisInkWord = node.cast()?;
    let text = word.RecognizedText()?.to_string();
    let mut alternates = Vec::new();
    for alternate in word.TextAlternates()? {
        let alternate = alternate.to_string();
        if alternate != text && !alternates.contains(&alternate) {
            alternates.push(alternate);
        }
    }
    // The analyzer lists strokes in its own order, so put them back in the order the caller gave.
    let mut found: Vec<(usize, StrokeKey)> = word
        .GetStrokeIds()?
        .into_iter()
        .filter_map(|id| keys.get(&id).copied())
        .collect();
    found.sort_by_key(|&(index, _)| index);
    let strokes = found.into_iter().map(|(_, key)| key).collect();
    Ok(InkWord {
        text,
        alternates,
        strokes,
        bounds: to_rect(word.BoundingRect()?),
    })
}

fn to_rect(r: windows::Foundation::Rect) -> Rect {
    Rect {
        x: r.X,
        y: r.Y,
        width: r.Width,
        height: r.Height,
    }
}
