//! Tesseract's C interface, opened at run time. Each call makes its own Tesseract handle, because a handle is not
//! safe to share between threads, and frees it before it returns.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

use libloading::Library;
use opennote_intel::error::IntelError;
use opennote_intel::geometry::Language;
use opennote_intel::ocr::{OcrEngine, OcrImage, OcrOptions, OcrResult};

use super::parse::{bcp47_for, code_for, gray_pixels, parse_tsv};

/// The names the library has on the distributions OpenNote supports, newest first.
const NAMES: &[&str] = &["libtesseract.so.5", "libtesseract.so.4", "libtesseract.so"];
/// Tesseract's own page layout analysis, as its command line does by default.
const PSM_AUTO: c_int = 3;

type Handle = *mut c_void;

/// The functions OpenNote calls, copied out of the library, which stays open for the life of the app.
struct Api {
    _library: Library,
    create: unsafe extern "C" fn() -> Handle,
    delete: unsafe extern "C" fn(Handle),
    init: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    set_page_seg_mode: unsafe extern "C" fn(Handle, c_int),
    set_image: unsafe extern "C" fn(Handle, *const u8, c_int, c_int, c_int, c_int),
    tsv: unsafe extern "C" fn(Handle, c_int) -> *mut c_char,
    delete_text: unsafe extern "C" fn(*const c_char),
    languages: unsafe extern "C" fn(Handle) -> *mut *mut c_char,
    delete_text_array: unsafe extern "C" fn(*mut *mut c_char),
    end: unsafe extern "C" fn(Handle),
}

fn missing() -> IntelError {
    IntelError::Unsupported {
        feature: "Tesseract text recognition (install the tesseract-ocr package)",
    }
}

fn load() -> Option<Api> {
    // SAFETY: opening libtesseract runs only its own initializers.
    let library = NAMES.iter().find_map(|name| unsafe { Library::new(name) }.ok())?;
    // SAFETY: each symbol is the C function of that name in Tesseract's capi.h, with the signature written here,
    // which is the same in Tesseract 4 and 5. The library is kept with the pointers, so they stay valid.
    unsafe {
        Some(Api {
            create: *library.get(b"TessBaseAPICreate\0").ok()?,
            delete: *library.get(b"TessBaseAPIDelete\0").ok()?,
            init: *library.get(b"TessBaseAPIInit3\0").ok()?,
            set_page_seg_mode: *library.get(b"TessBaseAPISetPageSegMode\0").ok()?,
            set_image: *library.get(b"TessBaseAPISetImage\0").ok()?,
            tsv: *library.get(b"TessBaseAPIGetTsvText\0").ok()?,
            delete_text: *library.get(b"TessDeleteText\0").ok()?,
            languages: *library.get(b"TessBaseAPIGetAvailableLanguagesAsVector\0").ok()?,
            delete_text_array: *library.get(b"TessDeleteTextArray\0").ok()?,
            end: *library.get(b"TessBaseAPIEnd\0").ok()?,
            _library: library,
        })
    }
}

fn api() -> Result<&'static Api, IntelError> {
    static API: OnceLock<Option<Api>> = OnceLock::new();
    API.get_or_init(load).as_ref().ok_or_else(missing)
}

/// How many handles have been opened, which the tests count.
static OPENED: AtomicUsize = AtomicUsize::new(0);

/// One Tesseract handle, ended, and freed when dropped.
struct Session {
    api: &'static Api,
    handle: Handle,
}

impl Session {
    /// A handle that reads `codes`, such as `eng` or `eng+deu`, from the language folder Tesseract was built with
    /// (or `TESSDATA_PREFIX`).
    fn open(api: &'static Api, codes: &str) -> Result<Session, IntelError> {
        let codes = CString::new(codes).map_err(|_| IntelError::InvalidInput("a language code".to_owned()))?;
        // SAFETY: create has no arguments; a null handle is checked.
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err(IntelError::Engine("Tesseract couldn't start".to_owned()));
        }
        OPENED.fetch_add(1, Ordering::Relaxed);
        let session = Session { api, handle };
        // SAFETY: the handle is live, a null data path means the default folder, and the codes end with a null.
        if unsafe { (api.init)(handle, std::ptr::null(), codes.as_ptr()) } != 0 {
            return Err(IntelError::LanguageUnavailable(codes.to_string_lossy().into_owned()));
        }
        Ok(session)
    }

    fn languages(&self) -> Vec<String> {
        // SAFETY: the handle is initialized; the array ends with a null pointer and is freed with its own call.
        unsafe {
            let array = (self.api.languages)(self.handle);
            if array.is_null() {
                return Vec::new();
            }
            let mut found = Vec::new();
            let mut at = array;
            while !(*at).is_null() {
                found.push(CStr::from_ptr(*at).to_string_lossy().into_owned());
                at = at.add(1);
            }
            (self.api.delete_text_array)(array);
            found
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // SAFETY: the handle is live and is not used after this.
        unsafe {
            (self.api.end)(self.handle);
            (self.api.delete)(self.handle);
        }
    }
}

/// The codes of the installed languages. Listing needs an open handle, so it opens one with English, which every
/// distribution installs with Tesseract, or with the orientation model. Opening one loads a language's model, so
/// the list is kept: `refresh` lists again, as the settings screen's check does, to see a pack installed since.
fn installed(api: &'static Api, refresh: bool) -> Result<Vec<String>, IntelError> {
    static INSTALLED: Mutex<Option<Vec<String>>> = Mutex::new(None);
    let mut kept = INSTALLED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let (false, Some(codes)) = (refresh, kept.as_ref()) {
        return Ok(codes.clone());
    }
    let session = Session::open(api, "eng").or_else(|_| Session::open(api, "osd"))?;
    let codes = session.languages();
    *kept = Some(codes.clone());
    Ok(codes)
}

/// OCR through Tesseract.
#[derive(Debug, Default)]
pub struct TesseractOcr;

impl TesseractOcr {
    /// Creates the engine. The library is opened on the first call.
    pub fn new() -> TesseractOcr {
        TesseractOcr
    }
}

impl OcrEngine for TesseractOcr {
    fn available_languages(&self) -> Result<Vec<Language>, IntelError> {
        Ok(installed(api()?, true)?
            .iter()
            .filter_map(|code| bcp47_for(code))
            .collect())
    }

    fn recognize(&self, image: &OcrImage, options: &OcrOptions) -> Result<OcrResult, IntelError> {
        let api = api()?;
        let codes = installed(api, false)?;
        let code = match &options.language {
            Some(language) => code_for(language, &codes)
                .ok_or_else(|| IntelError::LanguageUnavailable(language.as_str().to_owned()))?,
            None => ["eng"]
                .into_iter()
                .chain(codes.iter().map(String::as_str))
                .find(|code| codes.iter().any(|known| known == code) && bcp47_for(code).is_some())
                .ok_or_else(|| IntelError::LanguageUnavailable("any language".to_owned()))?,
        };
        let language = bcp47_for(code).ok_or_else(|| IntelError::LanguageUnavailable(code.to_owned()))?;
        let session = Session::open(api, code)?;
        let gray = gray_pixels(image);
        let too_large = |_| IntelError::InvalidInput("the image is too large".to_owned());
        let width = c_int::try_from(image.width()).map_err(too_large)?;
        let height = c_int::try_from(image.height()).map_err(too_large)?;
        // SAFETY: the handle is initialized, and the buffer holds `width * height` gray bytes that outlive the
        // call to read the text, which is the last use of them.
        let text = unsafe {
            (api.set_page_seg_mode)(session.handle, PSM_AUTO);
            (api.set_image)(session.handle, gray.as_ptr(), width, height, 1, width);
            let text = (api.tsv)(session.handle, 0);
            if text.is_null() {
                return Err(IntelError::Engine("Tesseract couldn't read the picture".to_owned()));
            }
            let owned = CStr::from_ptr(text).to_string_lossy().into_owned();
            (api.delete_text)(text);
            owned
        };
        Ok(OcrResult {
            language,
            lines: parse_tsv(&text),
            angle: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use opennote_intel::ocr::PixelFormat;

    use super::*;

    /// Each picture opens one handle, for its language, once the installed list is known.
    #[test]
    fn a_picture_opens_one_tesseract_handle() {
        if api().is_err() {
            assert!(
                std::env::var_os("OPENNOTE_EXPECT_TESSERACT").is_none(),
                "Tesseract was expected on this machine"
            );
            eprintln!("skipped: no libtesseract");
            return;
        }
        let engine = TesseractOcr::new();
        // The printed line of the OCR fixtures: a binary PGM, a short header, then one byte per pixel.
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../intel/tests/fixtures/printed-line.bin"
        ))
        .unwrap();
        let header: Vec<&[u8]> = bytes.splitn(4, |b| *b == b'\n').take(3).collect();
        let size: Vec<u32> = std::str::from_utf8(header[1])
            .unwrap()
            .split(' ')
            .map(|n| n.parse().unwrap())
            .collect();
        let start = header.iter().map(|line| line.len() + 1).sum::<usize>();
        let image = OcrImage::new(size[0], size[1], PixelFormat::Gray8, bytes[start..].to_vec()).unwrap();
        engine.recognize(&image, &OcrOptions::default()).unwrap();
        let before = OPENED.load(Ordering::Relaxed);
        engine.recognize(&image, &OcrOptions::default()).unwrap();
        assert_eq!(OPENED.load(Ordering::Relaxed) - before, 1);
    }
}
