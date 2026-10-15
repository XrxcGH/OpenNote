use sha2::{Digest, Sha256};

use super::*;
use crate::convert::MemoryPcm;
use crate::positions::PositionMap;

fn white(width: u32, height: u32, strokes: Vec<SceneStroke>) -> Scene {
    let rgba = vec![255u8; width as usize * height as usize * 4];
    Scene::from_rgba(width, height, &rgba, strokes).expect("a scene")
}

fn line() -> SceneStroke {
    SceneStroke {
        color: [20, 40, 200, 255],
        width: 4.0,
        points: vec![
            ScenePoint { x: 8.0, y: 8.0, t_ns: 200_000_000 },
            ScenePoint { x: 56.0, y: 8.0, t_ns: 400_000_000 },
            ScenePoint { x: 56.0, y: 40.0, t_ns: 600_000_000 },
        ],
    }
}

fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Default)]
struct Collect {
    frames: Vec<(u64, String)>,
    samples: usize,
    finished: bool,
}

impl VideoSink for Collect {
    fn frame(&mut self, bgra: &[u8], at_ns: u64) -> Result<()> {
        self.frames.push((at_ns, hash(bgra)));
        Ok(())
    }
    fn audio(&mut self, samples: &[i16], _at_ns: u64) -> Result<()> {
        self.samples += samples.len();
        Ok(())
    }
    fn finish(&mut self) -> Result<()> {
        self.finished = true;
        Ok(())
    }
}

#[test]
fn ink_appears_when_it_was_drawn() {
    let scene = white(64, 48, vec![line()]);
    let mut renderer = Renderer::new(&scene);
    let before = hash(renderer.frame(100_000_000));
    assert_eq!(before, hash(&scene.base));
    let middle = hash(renderer.frame(450_000_000));
    assert_ne!(middle, before);
    let after = renderer.frame(2_000_000_000).to_vec();
    // The pen's ring is gone by then, so the frame is the canvas.
    assert_ne!(hash(&after), middle);
    // A pixel on the second segment is blue, and a pixel off the line is still the page.
    let at = |x: usize, y: usize| &after[(y * 64 + x) * 4..(y * 64 + x) * 4 + 4];
    assert_eq!(at(56, 30), &[200, 40, 20, 255]);
    assert_eq!(at(30, 30), &[255, 255, 255, 255]);
}

#[test]
fn the_golden_frame_is_the_same_on_every_machine() {
    let scene = white(64, 48, vec![line()]);
    let mut renderer = Renderer::new(&scene);
    let frame = hash(renderer.frame(2_000_000_000));
    assert_eq!(frame, GOLDEN_AFTER);
}

#[test]
fn a_pause_is_left_out_of_the_timeline() {
    let mut scene = white(64, 48, vec![line()]);
    // Audio for 0 to 300 ms and 700 to 900 ms of capture time: the stroke point at 400 ms falls in the hole.
    let map = PositionMap::from_ranges(&[(0, 300_000_000), (700_000_000, 900_000_000)]);
    scene.place(&map);
    let times: Vec<u64> = scene.strokes[0].points.iter().map(|p| p.t_ns).collect();
    assert_eq!(times, vec![200_000_000, 300_000_000, 300_000_000]);
}

#[test]
fn export_writes_every_frame_and_all_the_sound() {
    let scene = white(64, 48, vec![line()]);
    let mut pcm = MemoryPcm::new(vec![0.25; 48_000]);
    let mut sink = Collect::default();
    let mut shares = Vec::new();
    export(&scene, &mut pcm, 1_000_000_000, 10, &mut sink, &mut |share| shares.push(share)).expect("exported");
    assert_eq!(sink.frames.len(), 10);
    assert_eq!(sink.frames[0].0, 0);
    assert_eq!(sink.frames[9].0, 900_000_000);
    assert_eq!(sink.samples, 48_000);
    assert!(sink.finished);
    assert_eq!(shares.last(), Some(&1.0));
    // The frame at 0 is the bare page and the last one has all the ink.
    assert_eq!(sink.frames[0].1, hash(&scene.base));
    assert_ne!(sink.frames[9].1, sink.frames[0].1);
}

#[test]
fn a_picture_of_the_wrong_size_is_refused() {
    assert!(Scene::from_rgba(4, 4, &[0; 10], Vec::new()).is_err());
}

const GOLDEN_AFTER: &str = "c852c146547cb2464b1363217876145cdce672a6d122808a4c789ed70c925f63";
