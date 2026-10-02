use std::path::PathBuf;

use opennote_core::format::page_json::read_page;
use opennote_core::format::segment::decode_segment;
use opennote_core::format::tree_json::{read_notebook, read_section};
use opennote_core::model::validate::validate_page;
use opennote_core::Limits;

use super::*;

fn files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        for entry in std::fs::read_dir(&next).unwrap().flatten() {
            if entry.path().is_dir() {
                pending.push(entry.path());
            } else {
                out.push(entry.path());
            }
        }
    }
    out.sort();
    out
}

fn generate(pages: usize, seed: u64) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    run(&GenerateArgs {
        pages,
        seed,
        one_section: false,
        dir: dir.path().to_path_buf(),
    })
    .unwrap();
    dir
}

#[test]
fn the_same_seed_makes_the_same_notebook() {
    let (a, b) = (generate(6, 7), generate(6, 7));
    let (fa, fb) = (files(a.path()), files(b.path()));
    assert_eq!(fa.len(), fb.len());
    for (x, y) in fa.iter().zip(&fb) {
        assert_eq!(x.strip_prefix(a.path()).unwrap(), y.strip_prefix(b.path()).unwrap());
        assert_eq!(std::fs::read(x).unwrap(), std::fs::read(y).unwrap(), "{}", x.display());
    }
}

#[test]
fn the_notebook_reads_back_and_validates() {
    let dir = generate(8, 3);
    let limits = Limits::default();
    assert!(is_notebook(dir.path()));
    read_notebook(&std::fs::read(dir.path().join("notebook.json")).unwrap(), &limits).unwrap();
    let mut pages = 0;
    for path in files(dir.path()) {
        match path.file_name().unwrap().to_str().unwrap() {
            "section.json" => {
                read_section(&std::fs::read(&path).unwrap(), &limits).unwrap();
            }
            "page.json" => {
                let page = read_page(&std::fs::read(&path).unwrap(), &limits).unwrap().page;
                assert!(!page.format.access.is_read_only());
                assert!(validate_page(&page, &limits).is_valid());
                for segment in page.ink.segments() {
                    let bytes = std::fs::read(path.with_file_name("ink").join(format!("{}.onk", segment.id))).unwrap();
                    let decoded = decode_segment(&bytes, segment, page.id, &limits).unwrap();
                    assert!(decoded.footer_ok && decoded.damaged.is_empty());
                }
                pages += 1;
            }
            _ => {}
        }
    }
    assert_eq!(pages, 8 + 30, "the pages and the Trash items");
}

#[test]
fn a_folder_with_files_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("keep.txt"), "mine").unwrap();
    let args = GenerateArgs {
        pages: 1,
        seed: 1,
        one_section: true,
        dir: dir.path().to_path_buf(),
    };
    assert!(run(&args).is_err());
}

#[test]
fn synthetic_strokes_look_like_handwriting() {
    let mut rng = Rng::new(5);
    for pen in [SURFACE_PEN, WACOM, FINE_TILT] {
        let points = stroke_points(&mut rng, &pen, (100.0, 100.0), 80);
        assert!(points.windows(2).all(|w| w[1].t >= w[0].t), "time never goes back");
        assert!(points[0].t < 10);
        assert!(points.iter().all(|p| p.pressure > 0 && p.tilt_x.abs() <= 9_000));
        let travel = f64::from((points[79].x - points[0].x).abs() + (points[79].y - points[0].y).abs()) / 64.0;
        assert!(travel > 1.0 && travel < 200.0, "{travel}");
    }
}

#[test]
fn recordings_of_the_corpus_replace_synthetic_strokes() {
    let dir = tempfile::tempdir().unwrap();
    let surface = r#"{"profile": "surface_pen", "device": "test", "strokes": [
        {"points": [[10, 20, 0.5, 30, -10, 0], [12, 22, 1.5, 31, -10, 4.2], [15, 21, 0.25, 31, -11, 8.4]]},
        {"points": [[0, 0, 0.1, 0, 0, 0]]},
        {"points": [[5, 5, 0.3, 20, 0, 0], [6, 5, 0.3, 20, 0, 4]]}
    ]}"#;
    std::fs::write(dir.path().join("a.pen.json"), surface).unwrap();
    std::fs::write(
        dir.path().join("b.pen.json"),
        r#"{"profile": "wacom", "strokes": [{"points": [[0, 0, 1, 0, 0, 0], [1, 1, 1, 0, 0, 1]]}]}"#,
    )
    .unwrap();
    std::fs::write(dir.path().join("broken.pen.json"), "not json").unwrap();
    std::fs::write(dir.path().join("notes.txt"), "ignored").unwrap();

    let corpus = Corpus::load(dir.path(), "surface_pen");
    assert_eq!(
        corpus.len(),
        2,
        "the one-point stroke and the other profile's file are left out"
    );
    assert_eq!(Corpus::load(dir.path(), "wacom").len(), 1);
    assert!(Corpus::load(dir.path(), "fine_tilt").is_empty());
    assert!(Corpus::load(&dir.path().join("missing"), "surface_pen").is_empty());

    let mut rng = Rng::new(3);
    for _ in 0..10 {
        let points = corpus.stroke(&mut rng, (100.0, 200.0));
        assert_eq!(
            (points[0].x, points[0].y),
            (6_400, 12_800),
            "a stroke starts where it is asked to"
        );
        assert!(points.windows(2).all(|w| w[1].t >= w[0].t));
    }
    let first = Corpus::load(dir.path(), "surface_pen").stroke(&mut Rng::new(1), (0.0, 0.0));
    let again = Corpus::load(dir.path(), "surface_pen").stroke(&mut Rng::new(1), (0.0, 0.0));
    assert_eq!(first, again, "the same seed picks the same stroke");
}
