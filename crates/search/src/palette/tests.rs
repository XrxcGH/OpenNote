use super::*;

fn command(id: &str, category: &str, title: &str) -> Command {
    Command {
        id: id.into(),
        title: title.into(),
        category: category.into(),
        keywords: Vec::new(),
        shortcut: None,
        enabled: true,
    }
}

fn palette() -> Palette {
    let mut delete = command("page.delete", "Page", "Delete page");
    delete.keywords = vec!["remove".into(), "trash".into()];
    let mut new = command("page.new", "File", "New page");
    new.shortcut = Some("Ctrl+N".into());
    let mut paste = command("edit.paste", "Edit", "Paste as plain text");
    paste.enabled = false;
    Palette::new(vec![
        new,
        delete,
        paste,
        command("section.new", "File", "New section"),
        command("notebook.new", "File", "New notebook"),
        command("search.open", "Search", "Search all notebooks"),
        command("edit.undo", "Edit", "Undo"),
        command("tag.rename", "Tags", "Rename tag"),
    ])
}

fn ids(hits: &[PaletteHit]) -> Vec<&str> {
    hits.iter().map(|hit| hit.id.as_str()).collect()
}

fn sorted(hits: &[PaletteHit]) -> Vec<&str> {
    let mut found = ids(hits);
    found.sort_unstable();
    found
}

fn find(query: &str) -> Vec<PaletteHit> {
    palette().find(query, &PaletteContext::default())
}

#[test]
fn an_empty_query_lists_recent_then_most_used_then_the_rest() {
    let context = PaletteContext {
        recent: vec!["tag.rename".into(), "edit.undo".into()],
        uses: HashMap::from([("section.new".to_string(), 9), ("notebook.new".to_string(), 3)]),
        limit: 0,
    };
    let hits = palette().find("  ", &context);
    assert_eq!(
        ids(&hits),
        [
            "tag.rename",
            "edit.undo",
            "section.new",
            "notebook.new",
            "page.new",
            "page.delete",
            "search.open",
            "edit.paste"
        ],
        "a command that cannot run comes last"
    );
    assert_eq!(hits[0].recent, Some(0));
    assert_eq!(hits[0].kind, None);
}

#[test]
fn typing_matches_the_title_by_prefix_and_by_initials() {
    assert_eq!(sorted(&find("new")[..3]), ["notebook.new", "page.new", "section.new"]);
    assert_eq!(find("new pa")[0].id, "page.new");
    assert_eq!(find("np")[0].id, "page.new", "the first letters of the words");
    assert_eq!(find("undo")[0].kind, Some(MatchKind::Exact));
}

#[test]
fn the_category_counts_as_part_of_the_name() {
    let hits = find("file new");
    assert_eq!(sorted(&hits[..3]), ["notebook.new", "page.new", "section.new"]);
    let page = hits.iter().find(|hit| hit.id == "page.new").unwrap();
    assert_eq!(page.category_highlights, vec![0..4]);
    assert_eq!(page.title_highlights, vec![0..3]);
}

#[test]
fn a_keyword_finds_a_command_but_never_beats_the_same_match_in_a_title() {
    let hits = find("remove");
    assert_eq!(hits[0].id, "page.delete");
    assert_eq!(hits[0].matched_on, MatchedOn::Keyword { word: "remove".into() });
    assert!(hits[0].title_highlights.is_empty());
    let mut commands = vec![command("a", "X", "Remove tag"), command("b", "X", "Delete page")];
    commands[1].keywords = vec!["remove".into()];
    let hits = Palette::new(commands).find("remove", &PaletteContext::default());
    assert_eq!(ids(&hits), ["a", "b"]);
}

#[test]
fn a_command_that_cannot_run_shows_after_every_command_that_can() {
    let hits = find("paste");
    assert_eq!(ids(&hits), ["edit.paste"]);
    assert!(!hits[0].enabled);
    let hits = find("p");
    let first_disabled = hits.iter().position(|hit| !hit.enabled).unwrap();
    assert!(first_disabled > 0);
    assert!(hits[first_disabled..].iter().all(|hit| !hit.enabled));
}

#[test]
fn habits_break_ties_but_never_beat_a_better_kind_of_match() {
    let context = PaletteContext {
        recent: vec!["section.new".into()],
        uses: HashMap::from([("notebook.new".to_string(), 40)]),
        limit: 0,
    };
    let hits = palette().find("new", &context);
    let at = |id: &str| hits.iter().position(|hit| hit.id == id).unwrap();
    assert!(at("section.new") < at("notebook.new"));
    let commands = vec![command("a", "X", "Name page"), command("b", "X", "Rename tag")];
    let context = PaletteContext {
        uses: HashMap::from([("b".to_string(), 1000)]),
        ..PaletteContext::default()
    };
    let hits = Palette::new(commands).find("name", &context);
    assert_eq!(ids(&hits), ["a", "b"]);
}

#[test]
fn a_small_slip_still_finds_the_command() {
    assert_eq!(find("renmae")[0].id, "tag.rename");
    assert_eq!(find("renmae")[0].kind, Some(MatchKind::Typo));
    assert!(find("zzzzzz").is_empty());
}

#[test]
fn the_limit_cuts_the_list_and_bad_commands_are_left_out() {
    let context = PaletteContext {
        limit: 2,
        ..PaletteContext::default()
    };
    assert_eq!(palette().find("", &context).len(), 2);
    let palette = Palette::new(vec![
        command("", "X", "No id"),
        command("a", "X", "  "),
        command("b", "X", "Fine"),
        command("b", "X", "Repeated id"),
    ]);
    assert_eq!(palette.len(), 1);
    assert_eq!(palette.find("", &PaletteContext::default())[0].title, "Fine");
}

#[test]
fn a_command_reads_from_json_with_defaults() {
    let command: Command = serde_json::from_str(r#"{"id":"a","title":"A","category":"B"}"#).unwrap();
    assert!(command.enabled && command.keywords.is_empty() && command.shortcut.is_none());
}
