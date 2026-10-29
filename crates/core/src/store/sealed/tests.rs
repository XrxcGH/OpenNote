#![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing, clippy::panic)]

use std::path::PathBuf;
use std::sync::Arc;

use super::*;
use crate::testing::mem_fs::MemFs;
use serde_json::json;

const SECRET_TEXT: &[u8] = b"The combination is 42-17-8";
const PAGE: &str = "01J0000000000000000000PAGE";

/// A passphrase made fresh for each run, so no passphrase is written into the tests.
fn pw() -> &'static str {
    static PW: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    PW.get_or_init(|| {
        let mut raw = [0u8; 12];
        getrandom::fill(&mut raw).expect("random");
        raw.iter().map(|b| format!("{b:02x}")).collect()
    })
}

fn p(s: &str) -> PathBuf {
    PathBuf::from(s)
}

fn page_id() -> String {
    crate::id::PageId::generate(&crate::time::SystemClock::new()).to_string()
}

/// A notebook with one plain section holding one page, its readable copy, history, and an asset.
fn plain_section(mem: &MemFs, page: &str) -> PathBuf {
    let dir = p("/nb/S1");
    mem.mkdir_all(&dir.join(page).join("assets"));
    mem.mkdir_all(&dir.join(page).join(".history"));
    mem.put(
        &dir.join("section.json"),
        format!(r#"{{"kind":"section","id":"S1","title":"Diary","pages":[{{"id":"{page}","title":"Secret plans"}}]}}"#)
            .as_bytes(),
    );
    mem.put(&dir.join(page).join("page.json"), SECRET_TEXT);
    mem.put(&dir.join(page).join("page.md"), SECRET_TEXT);
    mem.put(&dir.join(page).join(".history").join("v1.json"), SECRET_TEXT);
    mem.put(
        &dir.join(page).join("assets").join("photo.png"),
        b"PNGDATA-secret-photo",
    );
    dir
}

fn sealed_on(mem: &MemFs) -> SealedFs {
    let inner: Arc<dyn Fs> = Arc::new(mem.clone());
    SealedFs::new(inner, p("/data/journal"))
}

/// No file on the real disk holds any of these bytes.
fn assert_no_plain(mem: &MemFs, needles: &[&[u8]]) {
    for file in mem.files() {
        let bytes = mem.get(&file).unwrap_or_default();
        for needle in needles {
            assert!(
                !bytes.windows(needle.len()).any(|w| w == *needle),
                "{} holds plain text",
                file.display()
            );
        }
    }
}

#[test]
fn protecting_seals_every_file_and_drops_readable_copies_and_history() {
    let mem = MemFs::new();
    let page = page_id();
    let dir = plain_section(&mem, &page);
    let fs = sealed_on(&mem);
    fs.protect(&dir, "S1", pw()).unwrap();

    assert_no_plain(&mem, &[SECRET_TEXT, b"PNGDATA", b"Secret plans"]);
    let on_disk: Vec<String> = mem.read_dir(&dir).unwrap().into_iter().map(|e| e.name).collect();
    assert_eq!(on_disk, vec![SEALED_DIR.to_owned(), "section.json".to_owned()]);
    let public: Value = serde_json::from_slice(&mem.get(&dir.join("section.json")).unwrap()).unwrap();
    assert_eq!(public["title"], "Diary", "the title stays readable (spec 5.7)");
    assert!(public.get("pages").is_none());
    assert_eq!(public["encryption"]["cipher"], "xchacha20poly1305");
    assert!(public["encryption"].get(UNLOCKED).is_none());

    // Unlocked, the section reads as it was, without page.md and history.
    assert_eq!(fs.protection(&dir), Protection::Unlocked);
    assert_eq!(
        fs.read(&dir.join(&page).join("page.json"), 1 << 20).unwrap(),
        SECRET_TEXT
    );
    assert_eq!(
        fs.read(&dir.join(&page).join("assets").join("photo.png"), 1 << 20)
            .unwrap(),
        b"PNGDATA-secret-photo"
    );
    assert!(fs.metadata(&dir.join(&page).join("page.md")).is_err());
    assert!(fs.metadata(&dir.join(&page).join(".history")).is_err());
    let inner: Value = serde_json::from_slice(&fs.read(&dir.join("section.json"), 1 << 20).unwrap()).unwrap();
    assert_eq!(inner["pages"][0]["title"], "Secret plans");
    assert_eq!(inner["encryption"][UNLOCKED], true);
    assert!(is_unlocked(inner.get("encryption")));
}

#[test]
fn a_locked_section_shows_only_its_public_file_and_opens_only_with_its_password() {
    let mem = MemFs::new();
    let page = page_id();
    let dir = plain_section(&mem, &page);
    let fs = sealed_on(&mem);
    fs.protect(&dir, "S1", pw()).unwrap();
    fs.lock(&dir);

    assert_eq!(fs.protection(&dir), Protection::Locked);
    assert!(fs.read(&dir.join(&page).join("page.json"), 1 << 20).is_err());
    let public: Value = serde_json::from_slice(&fs.read(&dir.join("section.json"), 1 << 20).unwrap()).unwrap();
    assert!(!is_unlocked(public.get("encryption")));

    assert!(matches!(
        fs.unlock(&dir, "S1", Secret::Password("battery staple")),
        Err(ProtectError::Wrong)
    ));
    assert!(
        fs.unlock(&dir, "S2", Secret::Password(pw())).is_err(),
        "bound to the section"
    );
    assert!(matches!(
        fs.unlock(&dir, "S1", Secret::Hello(b"sig")),
        Err(ProtectError::NoSlot)
    ));
    fs.unlock(&dir, "S1", Secret::Password(pw())).unwrap();
    assert_eq!(
        fs.read(&dir.join(&page).join("page.json"), 1 << 20).unwrap(),
        SECRET_TEXT
    );
}

#[test]
fn changes_while_unlocked_are_sealed_and_survive_a_lock() {
    let mem = MemFs::new();
    let page = page_id();
    let dir = plain_section(&mem, &page);
    let fs = sealed_on(&mem);
    fs.protect(&dir, "S1", pw()).unwrap();

    let new_page = page_id();
    fs.create_dir_durable(&dir.join(format!("~moving-{new_page}"))).unwrap();
    fs.create_durable(
        &dir.join(format!("~moving-{new_page}")).join("page.json"),
        b"brand new secret",
    )
    .unwrap();
    fs.rename_dir(&dir.join(format!("~moving-{new_page}")), &dir.join(&new_page))
        .unwrap();
    fs.replace_durable(&dir.join(&page).join("page.json"), b"edited secret")
        .unwrap();
    fs.remove_dir_all(&dir.join(&page).join("assets")).unwrap();
    assert!(
        fs.create_durable(&dir.join("missing").join("x"), b"x").is_err(),
        "a parent must exist"
    );
    let listed: Vec<String> = fs.read_dir(&dir).unwrap().into_iter().map(|e| e.name).collect();
    assert!(listed.contains(&new_page) && listed.contains(&page));
    assert!(!listed.contains(&SEALED_DIR.to_owned()));
    assert_no_plain(&mem, &[b"brand new secret", b"edited secret"]);

    fs.lock(&dir);
    fs.unlock(&dir, "S1", Secret::Password(pw())).unwrap();
    assert_eq!(
        fs.read(&dir.join(&new_page).join("page.json"), 1 << 20).unwrap(),
        b"brand new secret"
    );
    assert_eq!(
        fs.read(&dir.join(&page).join("page.json"), 1 << 20).unwrap(),
        b"edited secret"
    );
    assert!(fs.metadata(&dir.join(&page).join("assets")).is_err());
    // Replaced and removed files leave no blobs behind.
    let blobs = mem.read_dir(&dir.join(SEALED_DIR)).unwrap().len();
    assert_eq!(blobs, 1 + 3, "the manifest, section.json, and the two page.json files");
}

#[test]
fn a_damaged_or_swapped_blob_never_reads_as_content() {
    let mem = MemFs::new();
    let page = page_id();
    let dir = plain_section(&mem, &page);
    let fs = sealed_on(&mem);
    fs.protect(&dir, "S1", pw()).unwrap();
    let target = dir.join(&page).join("page.json");
    let blob = {
        let st = fs.find(&dir).unwrap();
        let st = st.state();
        st.manifest.files[&format!("{page}/page.json")].blob.clone()
    };
    let path = dir.join(SEALED_DIR).join(&blob);
    let mut bytes = mem.get(&path).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    mem.put(&path, &bytes);
    assert!(fs.read(&target, 1 << 20).is_err());

    let manifest = dir.join(SEALED_DIR).join(MANIFEST);
    let mut bytes = mem.get(&manifest).unwrap();
    bytes[30] ^= 1;
    mem.put(&manifest, &bytes);
    fs.lock(&dir);
    assert!(matches!(
        fs.unlock(&dir, "S1", Secret::Password(pw())),
        Err(ProtectError::Damaged)
    ));
}

#[test]
fn journals_of_unlocked_pages_stay_in_memory_and_go_with_the_lock() {
    let mem = MemFs::new();
    let page = page_id();
    let dir = plain_section(&mem, &page);
    let fs = sealed_on(&mem);
    fs.protect(&dir, "S1", pw()).unwrap();
    let journal_dir = p("/data/journal/NB-1");
    let journal = journal_dir.join(format!("{page}-0000000000000001.wal"));
    let mut file = fs.open_append(&journal, true).unwrap();
    file.append(SECRET_TEXT).unwrap();
    file.sync().unwrap();
    assert!(!mem.exists(&journal));
    assert_eq!(fs.read(&journal, 1 << 20).unwrap(), SECRET_TEXT);
    let names: Vec<String> = fs.read_dir(&journal_dir).unwrap().into_iter().map(|e| e.name).collect();
    assert_eq!(names, vec![format!("{page}-0000000000000001.wal")]);
    assert_eq!(fs.lock_under(&p("/nb")), 1);
    assert!(fs.read(&journal, 1 << 20).is_err());
    // A tree journal, or another page's, goes to disk as always.
    mem.mkdir_all(&journal_dir);
    let tree = journal_dir.join("tree-0000000000000001.wal");
    fs.open_append(&tree, true).unwrap().append(b"x").unwrap();
    assert!(mem.exists(&tree));
}

#[test]
fn removing_protection_writes_plain_files_back() {
    let mem = MemFs::new();
    let page = page_id();
    let dir = plain_section(&mem, &page);
    let fs = sealed_on(&mem);
    fs.protect(&dir, "S1", pw()).unwrap();
    fs.unprotect(&dir).unwrap();
    assert_eq!(fs.protection(&dir), Protection::None);
    assert_eq!(mem.get(&dir.join(&page).join("page.json")).unwrap(), SECRET_TEXT);
    assert!(!mem.exists(&dir.join(SEALED_DIR).join(MANIFEST)));
    let json: Value = serde_json::from_slice(&mem.get(&dir.join("section.json")).unwrap()).unwrap();
    assert!(json.get("encryption").is_none());
    assert_eq!(json["pages"][0]["title"], "Secret plans");
}

#[test]
fn windows_hello_unlocks_with_the_signature_over_its_challenge() {
    let mem = MemFs::new();
    let page = page_id();
    let dir = plain_section(&mem, &page);
    let fs = sealed_on(&mem);
    fs.protect(&dir, "S1", pw()).unwrap();
    let challenge = [7u8; crypto::SALT];
    let signature = vec![9u8; 256];
    fs.set_slot(&dir, Secret::Hello(&signature), Some(challenge)).unwrap();
    assert_eq!(fs.hello_challenge(&dir).unwrap(), challenge.to_vec());
    fs.lock(&dir);
    assert_eq!(
        fs.hello_challenge(&dir).unwrap(),
        challenge.to_vec(),
        "readable while locked"
    );
    assert!(matches!(
        fs.unlock(&dir, "S1", Secret::Hello(&[8u8; 256])),
        Err(ProtectError::Wrong)
    ));
    fs.unlock(&dir, "S1", Secret::Hello(&signature)).unwrap();
    // The password still works, and the core's section.json writes keep the new slot.
    fs.replace_durable(
        &dir.join("section.json"),
        &fs.read(&dir.join("section.json"), 1 << 20).unwrap(),
    )
    .unwrap();
    fs.lock(&dir);
    fs.unlock(&dir, "S1", Secret::Password(pw())).unwrap();
    assert!(fs.hello_challenge(&dir).is_some());
    fs.remove_slot(&dir, "hello").unwrap();
    assert!(fs.hello_challenge(&dir).is_none());
    assert!(fs.remove_slot(&dir, "password").is_err());
}

#[test]
fn leftovers_of_a_crash_while_protecting_are_removed_at_unlock() {
    let mem = MemFs::new();
    let page = page_id();
    let dir = plain_section(&mem, &page);
    let fs = sealed_on(&mem);
    fs.protect(&dir, "S1", pw()).unwrap();
    fs.lock(&dir);
    // As if the plain files' removal had not run.
    mem.mkdir_all(&dir.join(PAGE));
    mem.put(&dir.join(PAGE).join("page.json"), SECRET_TEXT);
    mem.put(
        &dir.join(SEALED_DIR).join("0123456789abcdef0123456789abcdef"),
        b"orphan",
    );
    fs.unlock(&dir, "S1", Secret::Password(pw())).unwrap();
    assert!(!mem.exists(&dir.join(PAGE).join("page.json")));
    assert!(!mem.exists(&dir.join(SEALED_DIR).join("0123456789abcdef0123456789abcdef")));
}

#[test]
fn a_hostile_header_cost_is_refused_before_any_work() {
    let content = crypto::new_key().unwrap();
    let mut header = crypto::new_header("S1", &content, pw()).unwrap();
    header["keys"][0]["m"] = json!(4 * 1024 * 1024);
    assert!(crypto::open_slot("S1", &header, Secret::Password(pw())).is_err());
}
