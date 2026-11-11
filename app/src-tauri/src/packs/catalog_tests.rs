//! The catalog's known answers: measured sizes, published checksums, pinned addresses, and the CSP.

use base64::Engine as _;

use super::{catalog, serve};
use crate::intel::models::Digest;

/// Sizes from DESIGN 2.1 (measured from the package files), and the SHA-256 jsDelivr publishes for each file.
const MEASURED: &[(&str, u64, &str)] = &[
    (
        "pyodide/pyodide.asm.wasm",
        9_598_218,
        "zDbjyrBP38mmP/E+tS6uK5Eb9GwCXMeygfOUvT3h1eY=",
    ),
    (
        "pyodide/python_stdlib.zip",
        2_545_637,
        "+hlX5XdwaPxPdDf5bYYK4vvpwZcyugbITgBOwW3X3Xo=",
    ),
    (
        "pyodide/pyodide.asm.mjs",
        1_250_344,
        "983I7OgGeM63EvjmXr5tOoMgOhgMOZhl9JYSoFFpNjU=",
    ),
    (
        "pyodide/pyodide.mjs",
        17_931,
        "bx1g979Sm+swDw9HmDySHTmCNjZAuiCvDjjv3dvGYQk=",
    ),
    (
        "pyodide/pyodide-lock.json",
        119_077,
        "XcL8EZEIvBSMdFfchudnW1yH4cr9QgucNMHq73s2wBA=",
    ),
    (
        "clang/llvm.core.wasm",
        75_532_134,
        "JPvtR0x7W0lo/XP8SCdEC5P7NRwbYmRRYTAwDv8+e/U=",
    ),
    (
        "clang/llvm.core2.wasm",
        37_626,
        "lgwybrm123rtvBaVQEIVh6LT8/+YfpPWrVtNpDQw/9Q=",
    ),
    (
        "clang/llvm.core3.wasm",
        5_458,
        "Y2gMBDGSq6xHALvaanjkwZsTn6CGsehy0caRXTekKKg=",
    ),
    (
        "clang/llvm.core4.wasm",
        787,
        "9UTcnMRviKDyLRuDmk+whT3OLW4jHYgL0ZdUxZpaI00=",
    ),
    (
        "clang/llvm-resources.tar",
        29_665_280,
        "ee7wwzb+Vc8D/49bQreEyBaPkpo2AxOLLGMB9GAeTIY=",
    ),
    (
        "clang/bundle.js",
        253_926,
        "x85w+2J+7cm9YVmSh0PaherHtHKaoud2rjdxrnbJHdY=",
    ),
];

/// The size and SHA-256 of one catalog file.
fn measured(path: &str) -> (u64, &'static str) {
    let part = catalog::part_at(catalog::all, path).unwrap_or_else(|| panic!("{path} is in the catalog"));
    match part.digest {
        Digest::Sha256(hex) => (part.size, hex),
        Digest::GitBlob(_) => panic!("{path} has a SHA-256"),
    }
}

/// jsDelivr publishes the SHA-256 of every file of a package version in base64 (data.jsdelivr.com, `hash`).
fn base64_to_hex(text: &str) -> String {
    let bytes = base64::engine::general_purpose::STANDARD.decode(text).unwrap();
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn catalog_sizes_and_digests_match_the_measured_values() {
    for (path, size, hash) in MEASURED {
        assert_eq!(measured(path), (*size, base64_to_hex(hash).as_str()), "{path}");
    }
    // DESIGN 2.1 gives these totals: about 105 MB for clang and about 13.4 MB for Pyodide.
    let total = |id: &str| catalog::find(catalog::all, id).unwrap().spec.size();
    assert_eq!(total("clang"), 105_495_211);
    assert_eq!(total("pyodide"), 13_531_207);
    assert_eq!(measured("ruby/ruby+stdlib.wasm").0, 30_635_497);
}

#[test]
fn every_pack_address_is_pinned_and_every_file_is_plain() {
    let mut files = Vec::new();
    for pack in catalog::all() {
        assert_eq!(pack.spec.kind, "runtime");
        assert!(!pack.spec.parts.is_empty(), "{}", pack.spec.id);
        for part in pack.spec.parts {
            assert!(
                catalog::HOSTS.iter().any(|host| part.url.starts_with(host)),
                "{}",
                part.url
            );
            assert!(
                part.url.ends_with(part.file.rsplit('/').next().unwrap()),
                "{}",
                part.url
            );
            assert!(serve::plain_path(&format!("/{}", part.file)).is_some(), "{}", part.file);
            assert!(part.size > 0);
            assert!(matches!(part.digest, Digest::Sha256(hex) if hex.len() == 64));
            files.push(part.file);
        }
    }
    let total = files.len();
    files.sort_unstable();
    files.dedup();
    assert_eq!(files.len(), total, "no two packs write the same file");
    // Every host names one exact version.
    for host in catalog::HOSTS {
        assert!(host.contains("@") || host.contains("/v314.0.7/"), "{host}");
    }
}

#[test]
fn the_pyodide_packages_come_from_the_lock_file_with_measured_sizes() {
    let packages: Vec<_> = catalog::all()
        .filter(|pack| pack.spec.id.starts_with("pyodide:"))
        .collect();
    // DESIGN 2.1: 357 packages in Pyodide 314.0.7's lock file.
    assert_eq!(packages.len(), 357);
    let numpy = catalog::find(catalog::all, "pyodide:numpy").unwrap();
    assert_eq!(numpy.version, "2.4.6");
    let part = &numpy.spec.parts[0];
    // The lock file's entry for numpy.
    assert_eq!(
        part.digest,
        Digest::Sha256("a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf")
    );
    assert_eq!(
        part.url,
        "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
    );
    // Every dependency is a pack of its own.
    for pack in &packages {
        for dependency in pack.depends {
            assert!(catalog::find(catalog::all, dependency).is_some(), "{dependency}");
        }
    }
    for name in ["pandas", "matplotlib", "scipy", "sympy", "pytest", "jedi"] {
        assert!(
            catalog::find(catalog::all, &format!("pyodide:{name}")).is_some(),
            "{name}"
        );
    }
}

#[test]
fn content_types_let_workers_compile_as_bytes_arrive() {
    assert_eq!(serve::content_type("clang/llvm.core.wasm"), "application/wasm");
    assert_eq!(serve::content_type("pyodide/pyodide.mjs"), "text/javascript");
    assert_eq!(serve::content_type("pyodide/pyodide-lock.json"), "application/json");
    assert_eq!(serve::content_type("pyodide/x.whl"), "application/zip");
}

/// The sources of one CSP directive in tauri.conf.json.
fn csp_sources(directive: &str) -> Vec<String> {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json is JSON");
    let csp = config["app"]["security"]["csp"].as_str().expect("a CSP string");
    csp.split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix(directive))
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

#[test]
fn the_csp_lets_workers_fetch_packs_and_adds_nothing_else() {
    let expected = [
        "ipc:",
        "http://ipc.localhost",
        "'self'",
        "opennote-asset:",
        "http://opennote-asset.localhost",
        "opennote-pack:",
        "http://opennote-pack.localhost",
    ];
    assert_eq!(csp_sources("connect-src "), expected);
}
