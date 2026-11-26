//! TrueType copies of the bundled fonts, for embedding in Word files.
//!
//! The app bundles its fonts as WOFF2, and Word embeds only TrueType or OpenType files (ECMA-376 Part 1,
//! 17.8.3). `crates/interop/fonts/make_sfnt_copies.py` decompresses the Latin subset (Basic Latin and Latin-1)
//! of each face into `crates/interop/fonts/`. OpenNote Sans and Literata are variable fonts: each slope is one
//! file that holds the weight axis, so they have no separate bold faces. `app/bundle-budget.json` caps the
//! total (`wordEmbedFontsKb`).
//!
//! The Word writer takes these faces through `docx::bundled_embeds` when the export dialog's "Embed bundled
//! fonts" switch is on.

/// One face of a bundled family as a TrueType file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BundledFace {
    /// The family name, as documents and the file's name table spell it.
    pub family: &'static str,
    /// Whether the face is bold.
    pub bold: bool,
    /// Whether the face is italic.
    pub italic: bool,
    /// The TrueType file.
    pub bytes: &'static [u8],
}

macro_rules! face {
    ($family:literal, $bold:literal, $italic:literal, $file:literal) => {
        BundledFace {
            family: $family,
            bold: $bold,
            italic: $italic,
            bytes: include_bytes!(concat!("../fonts/", $file, ".ttf")),
        }
    };
}

/// Every face, by family, then regular, italic, bold, bold italic.
pub const FACES: [BundledFace; 16] = [
    face!("OpenNote Sans", false, false, "opennote-sans-regular"),
    face!("OpenNote Sans", false, true, "opennote-sans-italic"),
    face!("Literata", false, false, "literata-regular"),
    face!("Literata", false, true, "literata-italic"),
    face!(
        "Atkinson Hyperlegible Mono",
        false,
        false,
        "atkinson-hyperlegible-mono-regular"
    ),
    face!(
        "Atkinson Hyperlegible Mono",
        false,
        true,
        "atkinson-hyperlegible-mono-italic"
    ),
    face!(
        "Atkinson Hyperlegible Mono",
        true,
        false,
        "atkinson-hyperlegible-mono-bold"
    ),
    face!(
        "Atkinson Hyperlegible Mono",
        true,
        true,
        "atkinson-hyperlegible-mono-bold-italic"
    ),
    face!("Carlito", false, false, "carlito-regular"),
    face!("Carlito", false, true, "carlito-italic"),
    face!("Carlito", true, false, "carlito-bold"),
    face!("Carlito", true, true, "carlito-bold-italic"),
    face!("Caladea", false, false, "caladea-regular"),
    face!("Caladea", false, true, "caladea-italic"),
    face!("Caladea", true, false, "caladea-bold"),
    face!("Caladea", true, true, "caladea-bold-italic"),
];

/// The faces of one family, or none when the family is not bundled.
pub fn faces_of(family: &str) -> impl Iterator<Item = &'static BundledFace> + '_ {
    FACES.iter().filter(move |face| face.family == family)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The five bundled families (DESIGN 6.6; `THIRD_PARTY_NOTICES.md`, Fonts).
    const FAMILIES: [&str; 5] = [
        "OpenNote Sans",
        "Literata",
        "Atkinson Hyperlegible Mono",
        "Carlito",
        "Caladea",
    ];

    fn u16_at(bytes: &[u8], at: usize) -> usize {
        u16::from_be_bytes([bytes[at], bytes[at + 1]]) as usize
    }

    fn u32_at(bytes: &[u8], at: usize) -> usize {
        u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as usize
    }

    /// The offset of a table, from the sfnt table directory (OpenType spec, "Organization of an OpenType Font").
    fn table(bytes: &[u8], tag: &[u8; 4]) -> Option<usize> {
        (0..u16_at(bytes, 4))
            .map(|i| 12 + i * 16)
            .find(|record| &bytes[*record..*record + 4] == tag)
            .map(|record| u32_at(bytes, record + 8))
    }

    /// Name ID 1 (font family) of the Windows Unicode record (OpenType spec, "name" table, platform 3,
    /// encoding 1, UTF-16BE).
    fn family_name(bytes: &[u8]) -> String {
        let name = table(bytes, b"name").expect("a name table");
        let count = u16_at(bytes, name + 2);
        let strings = name + u16_at(bytes, name + 4);
        for i in 0..count {
            let record = name + 6 + i * 12;
            let (platform, encoding, id) = (
                u16_at(bytes, record),
                u16_at(bytes, record + 2),
                u16_at(bytes, record + 6),
            );
            if platform == 3 && encoding == 1 && id == 1 {
                let (length, offset) = (u16_at(bytes, record + 8), u16_at(bytes, record + 10));
                let units: Vec<u16> = bytes[strings + offset..strings + offset + length]
                    .chunks(2)
                    .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                    .collect();
                return String::from_utf16(&units).expect("UTF-16");
            }
        }
        panic!("no Windows family name");
    }

    #[test]
    fn every_bundled_family_has_a_regular_and_an_italic_face() {
        for family in FAMILIES {
            let styles: Vec<(bool, bool)> = faces_of(family).map(|f| (f.bold, f.italic)).collect();
            assert!(styles.contains(&(false, false)), "{family} regular");
            assert!(styles.contains(&(false, true)), "{family} italic");
        }
        assert!(FACES.iter().all(|face| FAMILIES.contains(&face.family)));
        assert_eq!(faces_of("Calibri").count(), 0);
    }

    #[test]
    fn every_face_is_a_truetype_file_that_names_its_family() {
        for face in FACES {
            // sfnt version 1.0 marks TrueType outlines; WOFF2 files start with "wOF2".
            assert_eq!(&face.bytes[0..4], &[0, 1, 0, 0], "{} is not TrueType", face.family);
            assert_eq!(family_name(face.bytes), face.family);
        }
    }

    #[test]
    fn every_face_matches_its_style_and_allows_embedding() {
        for face in FACES {
            let os2 = table(face.bytes, b"OS/2").expect("an OS/2 table");
            // OS/2: usWeightClass at 4, fsType at 8, fsSelection at 62 (bit 0 italic, bit 5 bold).
            let weight = u16_at(face.bytes, os2 + 4);
            let fs_type = u16_at(face.bytes, os2 + 8);
            let selection = u16_at(face.bytes, os2 + 62);
            let label = format!("{} bold={} italic={}", face.family, face.bold, face.italic);
            assert_eq!(weight, if face.bold { 700 } else { 400 }, "{label}");
            assert_eq!(selection & 1 == 1, face.italic, "{label}");
            assert_eq!(selection & 0x20 == 0x20, face.bold, "{label}");
            // Bit 1 alone is "restricted license embedding" (OpenType spec, OS/2 fsType).
            assert_ne!(fs_type & 0x000F, 0x0002, "{label}");
        }
    }

    #[test]
    fn the_copies_stay_under_their_byte_budget() {
        let budget: serde_json::Value =
            serde_json::from_str(include_str!("../../../app/bundle-budget.json")).expect("budget JSON");
        let limit = budget["wordEmbedFontsKb"].as_u64().expect("wordEmbedFontsKb") as usize * 1024;
        let total: usize = FACES.iter().map(|face| face.bytes.len()).sum();
        assert!(total <= limit, "{total} bytes over {limit}");
    }
}
