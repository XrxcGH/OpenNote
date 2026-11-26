//! The runtime packs the code studio can download (ADR 0070, DESIGN 2.1 and 4.7). Every file has its exact size and
//! SHA-256, measured from the pinned version on jsDelivr, so the bytes cannot change under the checksum. A pack is a
//! [`ModelSpec`] of kind `runtime`, so the model downloader fetches it with all its rules. The Pyodide packages come
//! from `pyodide-packages.json`, which `generate-pyodide.mjs` writes from Pyodide's lock file: the SHA-256 is the
//! lock file's, and the size is the one the script measured.

use std::sync::OnceLock;

use serde::Deserialize;

use crate::intel::models::{Digest, ModelSpec, Part};

pub const PYODIDE_VERSION: &str = "314.0.7";
pub const CLANG_VERSION: &str = "22.0.0-git20542-10";
pub const RUBY_VERSION: &str = "2.10.1";

/// The only addresses a pack comes from: one exact version of each package.
pub const HOSTS: &[&str] = &[
    "https://cdn.jsdelivr.net/npm/pyodide@314.0.7/",
    "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/",
    "https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/",
    "https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.10.1/",
];

/// One pack: its spec for the downloader, and what the download dialog shows besides the size.
#[derive(Debug)]
pub struct Pack {
    pub spec: &'static ModelSpec,
    pub version: &'static str,
    pub license: &'static str,
    /// The other packs it needs: a Pyodide package's dependencies, as pack IDs.
    pub depends: &'static [&'static str],
    /// Listed even when nothing of it is on disk. A Pyodide package shows once some of it is.
    pub always_listed: bool,
}

/// A list of packs. The app uses [`all`]; tests use their own.
pub type Catalog = fn() -> Box<dyn Iterator<Item = &'static Pack>>;

macro_rules! pack_file {
    ($dir:literal, $host:literal, $file:literal, $size:literal, $sha:literal) => {
        Part {
            file: concat!($dir, "/", $file),
            size: $size,
            digest: Digest::Sha256($sha),
            url: concat!($host, $file),
        }
    };
}

/// Full Python: CPython 3.14.2 built for WebAssembly. The loader comes first, as the file a worker opens.
const PYODIDE: ModelSpec = ModelSpec {
    id: "pyodide",
    kind: "runtime",
    name: "Python (full)",
    detail: "CPython 3.14.2 with the whole standard library, through Pyodide.",
    parts: &[
        pack_file!(
            "pyodide",
            "https://cdn.jsdelivr.net/npm/pyodide@314.0.7/",
            "pyodide.mjs",
            17_931,
            "6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109"
        ),
        pack_file!(
            "pyodide",
            "https://cdn.jsdelivr.net/npm/pyodide@314.0.7/",
            "pyodide.asm.mjs",
            1_250_344,
            "f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635"
        ),
        pack_file!(
            "pyodide",
            "https://cdn.jsdelivr.net/npm/pyodide@314.0.7/",
            "pyodide.asm.wasm",
            9_598_218,
            "cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6"
        ),
        pack_file!(
            "pyodide",
            "https://cdn.jsdelivr.net/npm/pyodide@314.0.7/",
            "python_stdlib.zip",
            2_545_637,
            "fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a"
        ),
        pack_file!(
            "pyodide",
            "https://cdn.jsdelivr.net/npm/pyodide@314.0.7/",
            "pyodide-lock.json",
            119_077,
            "5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010"
        ),
    ],
};

/// C and C++: clang and lld 22 for `wasm32-wasip1`, with the C and C++ standard libraries in the resources.
const CLANG: ModelSpec = ModelSpec {
    id: "clang",
    kind: "runtime",
    name: "C and C++",
    detail: "Clang and lld 22 with the C and C++ standard libraries, through YoWASP.",
    parts: &[
        pack_file!(
            "clang",
            "https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/gen/",
            "bundle.js",
            253_926,
            "c7ce70fb627eedc9bd6159928743da85eac7b4729aa2e776ae3771ae76c91dd6"
        ),
        pack_file!(
            "clang",
            "https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/gen/",
            "llvm.core.wasm",
            75_532_134,
            "24fbed474c7b5b4968fd73fc4827440b93fb351c1b6264516130300eff3e7bf5"
        ),
        pack_file!(
            "clang",
            "https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/gen/",
            "llvm.core2.wasm",
            37_626,
            "960c326eb9b5db7aedbc169540421587a2d3f3ff987e93d6ad5b4da43430ffd4"
        ),
        pack_file!(
            "clang",
            "https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/gen/",
            "llvm.core3.wasm",
            5_458,
            "63680c043192abac4700bbda6a78e4c19b139fa086b1e872d1c6915d37a428a8"
        ),
        pack_file!(
            "clang",
            "https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/gen/",
            "llvm.core4.wasm",
            787,
            "f544dc9cc46f88a0f22d1b839a4fb0853dce2d6e231d880bd19754c59a5a234d"
        ),
        pack_file!(
            "clang",
            "https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/gen/",
            "llvm-resources.tar",
            29_665_280,
            "79eef0c336fe55cf03ff8f5b42b784c8168f929a3603138b2c6301f4601e4c86"
        ),
    ],
};

/// Ruby 3.4 with its standard library, through ruby.wasm.
const RUBY: ModelSpec = ModelSpec {
    id: "ruby",
    kind: "runtime",
    name: "Ruby",
    detail: "Ruby 3.4 with its standard library, through ruby.wasm.",
    parts: &[pack_file!(
        "ruby",
        "https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.10.1/dist/",
        "ruby+stdlib.wasm",
        30_635_497,
        "4b814fc9d13505ea5b4c1f3bd3a7cc7ccca137f551196b9b21f0a7caf9cc5878"
    )],
};

/// The packs every build lists. webR is left out (code D4: R runs from an installed R only), and the code tools
/// pack of ADR 0074 joins when its lane lands.
static CORE: [Pack; 3] = [
    Pack {
        spec: &PYODIDE,
        version: PYODIDE_VERSION,
        license: "MPL-2.0",
        depends: &[],
        always_listed: true,
    },
    Pack {
        spec: &CLANG,
        version: CLANG_VERSION,
        license: "ISC; LLVM: Apache-2.0 WITH LLVM-exception",
        depends: &[],
        always_listed: true,
    },
    Pack {
        spec: &RUBY,
        version: RUBY_VERSION,
        license: "MIT; Ruby: BSD-2-Clause or Ruby",
        depends: &[],
        always_listed: true,
    },
];

/// One row of `pyodide-packages.json`.
#[derive(Deserialize)]
struct Row {
    /// The lock file's key: the normalized name, which `depends` uses too.
    id: String,
    name: String,
    version: String,
    file: String,
    size: u64,
    sha256: String,
    depends: Vec<String>,
}

#[derive(Deserialize)]
struct Generated {
    version: String,
    base: String,
    packages: Vec<Row>,
}

/// Whether a name from the generated file is safe as one path segment and one address segment.
pub fn plain_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'+' | b'-'))
}

fn leak(text: String) -> &'static str {
    Box::leak(text.into_boxed_str())
}

/// The Pyodide packages, read once from the generated file. A row that breaks a rule is left out, and a test
/// proves no row does.
fn packages() -> &'static [Pack] {
    static PACKAGES: OnceLock<Vec<Pack>> = OnceLock::new();
    PACKAGES.get_or_init(|| {
        let Ok(generated) = serde_json::from_str::<Generated>(include_str!("pyodide-packages.json")) else {
            return Vec::new();
        };
        if generated.version != PYODIDE_VERSION || !HOSTS.contains(&generated.base.as_str()) {
            return Vec::new();
        }
        let base = leak(generated.base);
        generated
            .packages
            .into_iter()
            .filter(|row| {
                plain_file_name(&row.file)
                    && plain_file_name(&row.id)
                    && row.size > 0
                    && row.sha256.len() == 64
                    && row.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            })
            .map(|row| {
                let parts: &'static [Part] = Box::leak(Box::new([Part {
                    file: leak(format!("pyodide/{}", row.file)),
                    size: row.size,
                    digest: Digest::Sha256(leak(row.sha256)),
                    url: leak(format!("{base}{}", row.file)),
                }]));
                let depends: Vec<&'static str> =
                    row.depends.iter().map(|name| leak(format!("pyodide:{name}"))).collect();
                Pack {
                    spec: Box::leak(Box::new(ModelSpec {
                        id: leak(format!("pyodide:{}", row.id)),
                        kind: "runtime",
                        name: leak(row.name),
                        detail: "A Python package for full Python.",
                        parts,
                    })),
                    version: leak(row.version),
                    license: "",
                    depends: Box::leak(depends.into_boxed_slice()),
                    always_listed: false,
                }
            })
            .collect()
    })
}

/// Every pack: the core packs first, then the Pyodide packages.
pub fn all() -> Box<dyn Iterator<Item = &'static Pack>> {
    Box::new(CORE.iter().chain(packages()))
}

/// The pack with this ID.
pub fn find(catalog: Catalog, id: &str) -> Option<&'static Pack> {
    catalog().find(|pack| pack.spec.id == id)
}

/// The catalog file a path under the packs folder names, if any. Only exact catalog paths match.
pub fn part_at(catalog: Catalog, path: &str) -> Option<&'static Part> {
    catalog()
        .flat_map(|pack| pack.spec.parts.iter())
        .find(|part| part.file == path)
}
