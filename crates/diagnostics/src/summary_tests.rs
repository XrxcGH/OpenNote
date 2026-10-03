use super::*;

fn os() -> OsFacts {
    OsFacts {
        os: "Windows 10.0.26200 x86_64".into(),
        arch: "x86_64".into(),
        cpus: Some(16),
        memory_mb: Some(32768),
    }
}

fn facts() -> SystemFacts {
    SystemFacts {
        app_version: "1.0.0-beta.2".into(),
        channel: "beta".into(),
        webview2_version: Some("154.0.3512.22".into()),
        locale: Some("en-US".into()),
        display_scale_percent: Some(150),
        text_size_percent: Some(100),
        theme: Some("dark".into()),
        density: Some("touch".into()),
        enabled_flags: vec!["shell.customFrame".into(), "page.editor".into(), "page.editor".into()],
        notebooks: Some(NotebookCounts {
            notebooks: 3,
            sections: 12,
            pages: 340,
        }),
    }
}

fn scrubber() -> Scrubber {
    let mut scrubber = Scrubber::new();
    scrubber.add_name("jdoe");
    scrubber.add_name("JANES-LAPTOP");
    scrubber
}

fn value<'a>(summary: &'a SystemSummary, name: &str) -> Option<&'a str> {
    summary.lines.iter().find(|l| l.name == name).map(|l| l.value.as_str())
}

#[test]
fn lists_what_a_maintainer_needs_in_a_fixed_order() {
    let summary = SystemSummary::build_with(&facts(), &os(), &scrubber());
    let names: Vec<_> = summary.lines.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "OpenNote",
            "Channel",
            "Windows",
            "Processor",
            "Logical processors",
            "Memory",
            "WebView2",
            "Language",
            "Display scale",
            "Text size",
            "Theme",
            "Density",
            "Library",
            "Feature flags on"
        ]
    );
    assert_eq!(value(&summary, "OpenNote"), Some("1.0.0-beta.2"));
    assert_eq!(value(&summary, "WebView2"), Some("154.0.3512.22"));
    assert_eq!(value(&summary, "Memory"), Some("32768 MB"));
    assert_eq!(value(&summary, "Library"), Some("3 notebooks, 12 sections, 340 pages"));
    assert_eq!(
        value(&summary, "Feature flags on"),
        Some("page.editor, shell.customFrame")
    );
    assert_eq!(summary.redactions.total(), 0);
}

#[test]
fn leaves_out_what_is_not_known() {
    let summary = SystemSummary::build_with(
        &SystemFacts {
            app_version: "1.0.0".into(),
            channel: "stable".into(),
            ..SystemFacts::default()
        },
        &OsFacts {
            cpus: None,
            memory_mb: None,
            ..os()
        },
        &scrubber(),
    );
    let names: Vec<_> = summary.lines.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(names, ["OpenNote", "Channel", "Windows", "Processor"]);
}

#[test]
fn private_text_in_any_value_is_removed_and_counted() {
    let hostile = SystemFacts {
        app_version: r"C:\Users\jdoe\OpenNote\OpenNote.exe".into(),
        channel: "beta".into(),
        webview2_version: Some("154 for \"Holiday Plans\"".into()),
        locale: Some("jdoe@example.org".into()),
        theme: Some("JANES-LAPTOP theme".into()),
        density: Some("line one\nline two with tab\there".into()),
        enabled_flags: vec![r"C:\Users\jdoe".into(), "page.editor".into(), "not a flag".into()],
        ..SystemFacts::default()
    };
    let summary = SystemSummary::build_with(&hostile, &os(), &scrubber());
    let text = summary.render();
    for secret in ["jdoe", "Holiday", "JANES", "example.org", r"C:\"] {
        assert!(!text.contains(secret), "{secret:?} in {text}");
    }
    assert_eq!(value(&summary, "OpenNote"), Some("<path>"));
    assert_eq!(value(&summary, "Feature flags on"), Some("page.editor"));
    assert!(!text.contains('\t'));
    assert_eq!(text.lines().count(), summary.lines.len(), "one value is one line");
    assert!(summary.redactions.total() >= 4, "{:?}", summary.redactions);
}

#[test]
fn a_long_value_is_cut() {
    let long = SystemFacts {
        app_version: "1.0.0".into(),
        channel: "x".repeat(500),
        ..SystemFacts::default()
    };
    let summary = SystemSummary::build_with(&long, &os(), &scrubber());
    assert_eq!(value(&summary, "Channel").unwrap().chars().count(), MAX_VALUE);
}

#[test]
fn this_computer_describes_itself() {
    let here = OsFacts::detect();
    assert!(!here.os.is_empty());
    assert_eq!(here.arch, std::env::consts::ARCH);
    assert!(here.cpus.is_some_and(|n| n > 0));
    if cfg!(windows) {
        assert!(here.memory_mb.is_some_and(|mb| mb >= 256), "{here:?}");
    }
    let summary = SystemSummary::build(&facts(), &scrubber());
    assert!(value(&summary, "Windows").is_some());
}

#[test]
fn facts_read_from_the_interface_json() {
    let json = r#"{"appVersion":"1.0.0","channel":"beta","enabledFlags":["page.editor"],
                   "notebooks":{"notebooks":1,"sections":2,"pages":3}}"#;
    let parsed: SystemFacts = serde_json::from_str(json).unwrap();
    assert_eq!(parsed.notebooks.unwrap().pages, 3);
    assert_eq!(parsed.locale, None);
    assert_eq!(
        serde_json::from_str::<SystemFacts>("{}").unwrap(),
        SystemFacts::default()
    );
}
