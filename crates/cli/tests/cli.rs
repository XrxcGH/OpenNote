//! The `opennote` tool and its MCP server against a test API server with notes in memory: asking for access the
//! first time, each command, refusals, a revoked key, and the MCP protocol with its permission refusals.

use std::sync::Arc;

use opennote_api::{client::Endpoint, testing::TestApi, Access, Decision, Scope};
use opennote_cli::{
    store::{assistant_token, MemorySecrets, Secrets, CLI_TOKEN},
    Env,
};
use serde_json::{json, Value};

struct Run {
    code: i32,
    out: String,
    err: String,
}

fn env(test: &TestApi, secrets: &Arc<MemorySecrets>) -> Env {
    Env {
        endpoint: Some(Endpoint::Tcp(test.port)),
        proof_key: Some(test.api.proof_key()),
        secrets: secrets.clone(),
    }
}

fn run(env: &Env, args: &[&str], stdin: &str) -> Run {
    let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let code = opennote_cli::run(&args, env, &mut stdin.as_bytes(), &mut out, &mut err);
    Run {
        code,
        out: String::from_utf8(out).expect("utf-8"),
        err: String::from_utf8(err).expect("utf-8"),
    }
}

fn allow(access: Access, notebooks: Scope) -> Decision {
    Decision::Allow {
        access: Some(access),
        notebooks: Some(notebooks),
        always: false,
    }
}

const YES_ONCE: Decision = Decision::Allow {
    access: None,
    notebooks: None,
    always: false,
};

#[test]
fn the_first_command_asks_for_access_and_keeps_the_key() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = env(&test, &secrets);
    test.approver
        .answer(allow(Access::Read, Scope::Notebooks(vec!["nb-bio".into()])));
    let first = run(&env, &["notebooks"], "");
    assert_eq!(first.code, 0, "{}", first.err);
    assert!(first.err.contains("Answer in the OpenNote window"));
    assert!(first.out.contains("Biology") && first.out.contains("s-cells  Cells"));
    assert!(first.out.contains("Diary (locked)"));
    assert!(!first.out.contains("Work"));
    assert!(secrets.get(CLI_TOKEN).is_some_and(|token| token.starts_with("onapi_")));

    let again = run(&env, &["read", "p-mito"], "");
    assert_eq!(again.code, 0, "{}", again.err);
    assert!(again.out.contains("The powerhouse of the cell."));
    assert_eq!(test.approver.asked().len(), 1, "the key is reused");
}

#[test]
fn a_declined_request_changes_nothing_and_says_so() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let result = run(&env(&test, &secrets), &["search", "cell"], "");
    assert_eq!(result.code, 4);
    assert!(result.err.contains("didn't give access"));
    assert!(secrets.get(CLI_TOKEN).is_none());
}

#[test]
fn search_new_append_daily_and_export_go_through_the_grant() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = env(&test, &secrets);
    test.approver.answer(allow(Access::ReadWrite, Scope::All));

    let found = run(&env, &["--json", "search", "mitochondria"], "");
    assert_eq!(found.code, 0, "{}", found.err);
    let hits: Value = serde_json::from_str(&found.out).expect("json");
    let ids: Vec<&str> = hits["hits"]
        .as_array()
        .expect("hits")
        .iter()
        .filter_map(|hit| hit["page"]["id"].as_str())
        .collect();
    assert!(ids.contains(&"p-mito") && !ids.contains(&"p-secret"), "{ids:?}");

    test.approver.answer(YES_ONCE);
    let added = run(&env, &["new", "s-cells", "Ribosomes", "Make", "proteins."], "");
    assert_eq!(added.code, 0, "{}", added.err);
    assert!(added.out.contains("Added \u{201c}Ribosomes\u{201d}"));

    test.approver.answer(YES_ONCE);
    let appended = run(&env, &["append", "p-mito"], "From a pipe.\n");
    assert_eq!(appended.code, 0, "{}", appended.err);
    assert!(test.backend.markdown("p-mito").expect("text").contains("From a pipe."));
    assert_eq!(test.backend.history("p-mito"), ["Changed via opennote command"]);

    test.approver.answer(YES_ONCE);
    let daily = run(&env, &["daily", "Called", "the", "lab."], "");
    assert_eq!(daily.code, 0, "{}", daily.err);

    let folder = tempfile::tempdir().expect("a folder");
    let out = folder.path().display().to_string();
    let outside = run(&env, &["export", "s-cells", "--out", &out], "");
    assert_eq!(outside.code, 2, "a folder outside the write root is refused");
    assert!(outside.err.contains("--write-root"), "{}", outside.err);
    let exported = run(&env, &["export", "s-cells", "--out", &out, "--write-root", &out], "");
    assert_eq!(exported.code, 0, "{}", exported.err);
    assert!(folder.path().join("Mitochondria.md").is_file());
    assert!(folder.path().join("Ribosomes.md").is_file());
    let twice = run(&env, &["export", "s-cells", "--out", &out, "--write-root", &out], "");
    assert_eq!(twice.code, 0, "{}", twice.err);
    assert!(folder.path().join("Mitochondria (2).md").is_file(), "never overwrites");
}

#[test]
fn refusals_come_back_as_plain_words_and_exit_codes() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = env(&test, &secrets);
    test.approver
        .answer(allow(Access::Read, Scope::Notebooks(vec!["nb-bio".into()])));
    let write = run(&env, &["append", "p-mito", "x"], "");
    assert_eq!(write.code, 4);
    assert!(write.err.contains("doesn't include that"), "{}", write.err);
    let locked = run(&env, &["read", "p-secret"], "");
    assert_eq!(locked.code, 4);
    assert!(locked.err.contains("locked"), "{}", locked.err);
    let elsewhere = run(&env, &["read", "p-standup"], "");
    assert_eq!(elsewhere.code, 4);
    let backup = run(&env, &["backup"], "");
    assert_eq!(backup.code, 4);
}

#[test]
fn bad_arguments_never_reach_opennote() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = env(&test, &secrets);
    for args in [
        &["read", "../etc"][..],
        &["append", "p-mito"],
        &["new", "s-cells"],
        &["frobnicate"],
        &["search"],
    ] {
        let result = run(&env, args, "");
        assert_eq!(result.code, 2, "{args:?}: {}", result.err);
    }
    // A refused or missing file never becomes an empty page.
    for args in [
        &["new", "s-cells", "Gone", "--file", "no-such-file.txt"][..],
        &["new", "s-cells", "Outside", "--file", r"C:\Windows\win.ini"],
    ] {
        let result = run(&env, args, "");
        assert_ne!(result.code, 0, "{args:?}");
        assert!(!result.err.is_empty(), "{args:?} says why");
        assert!(
            !result.err.contains(r"\\?\"),
            "{args:?} names a path plainly: {}",
            result.err
        );
    }
    assert!(test.approver.asked().is_empty());
    let help = run(&env, &["--help"], "");
    assert_eq!(help.code, 0);
    assert!(help.out.contains("Usage: opennote"));
}

#[test]
fn a_revoked_key_is_forgotten_and_an_impostor_gets_nothing() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = env(&test, &secrets);
    test.approver.answer(allow(Access::Read, Scope::All));
    assert_eq!(run(&env, &["notebooks"], "").code, 0);
    let id = test.api.grants.apps()[0].id.clone();
    test.api.grants.revoke(&id).expect("revoked");
    let after = run(&env, &["notebooks"], "");
    assert_eq!(after.code, 4);
    assert!(secrets.get(CLI_TOKEN).is_none());

    let impostor = Env {
        proof_key: Some(vec![7; 32]),
        ..env.clone()
    };
    secrets.put(CLI_TOKEN, "onapi_0123456789abcdef_".to_owned().as_str());
    let refused = run(&impostor, &["notebooks"], "");
    assert_eq!(refused.code, 3);
    assert!(refused.err.contains("isn't OpenNote"));

    let nothing = Env { endpoint: None, ..env };
    assert_eq!(run(&nothing, &["notebooks"], "").code, 3);
}

/// Runs the MCP server over the lines and returns each answer.
fn mcp(env: &Env, lines: &[Value]) -> Vec<Value> {
    let input: String = lines.iter().map(|line| format!("{line}\n")).collect();
    let result = run(env, &["mcp", "--name", "Claude Desktop"], &input);
    assert_eq!(result.code, 0, "{}", result.err);
    result
        .out
        .lines()
        .map(|line| serde_json::from_str(line).expect("a JSON line"))
        .collect()
}

fn call(id: u64, name: &str, arguments: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": name, "arguments": arguments } })
}

#[test]
fn mcp_initializes_lists_tools_and_answers_calls() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = env(&test, &secrets);
    test.approver
        .answer(allow(Access::Read, Scope::Notebooks(vec!["nb-bio".into()])));
    let answers = mcp(
        &env,
        &[
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": { "protocolVersion": "2025-03-26", "capabilities": {},
                            "clientInfo": { "name": "test", "version": "1" } }
            }),
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
            call(3, "search", json!({ "query": "mitochondria" })),
            call(4, "read_page", json!({ "page_id": "p-mito" })),
            json!({ "jsonrpc": "2.0", "id": 5, "method": "nope" }),
            call(6, "no_such_tool", json!({})),
        ],
    );
    assert_eq!(answers.len(), 6, "the notification gets no answer");
    assert_eq!(answers[0]["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(answers[0]["result"]["serverInfo"]["name"], "opennote");
    let names: Vec<&str> = answers[1]["result"]["tools"]
        .as_array()
        .expect("tools")
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert_eq!(
        names,
        [
            "list_commands",
            "list_notebooks",
            "list_pages",
            "read_page",
            "inspect_page",
            "render_page",
            "search",
            "create_page",
            "append_to_page",
            "append_to_daily_note"
        ]
    );
    assert_eq!(answers[2]["result"]["isError"], false);
    assert!(answers[2]["result"]["content"][0]["text"]
        .as_str()
        .expect("text")
        .contains("p-mito"));
    assert!(!answers[2]["result"]["content"][0]["text"]
        .as_str()
        .expect("text")
        .contains("p-secret"));
    assert!(answers[3]["result"]["content"][0]["text"]
        .as_str()
        .expect("text")
        .contains("powerhouse"));
    assert_eq!(answers[4]["error"]["code"], -32601);
    assert_eq!(answers[5]["error"]["code"], -32602);
    assert!(
        secrets.get(&assistant_token("Claude Desktop")).is_some(),
        "the assistant has its own key"
    );
    assert!(secrets.get(CLI_TOKEN).is_none());
    let asked = test.approver.asked();
    assert_eq!(asked[0].app_name, "Claude Desktop");
    let log = test.api.log.recent(20);
    assert!(log
        .iter()
        .any(|entry| entry.name == "Claude Desktop" && entry.action == "search"));
    assert!(log
        .iter()
        .any(|entry| entry.name == "Claude Desktop" && entry.action == "page.read"));
}

#[test]
fn mcp_writes_are_refused_without_access_or_approval() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = env(&test, &secrets);
    test.approver
        .answer(allow(Access::Read, Scope::Notebooks(vec!["nb-bio".into()])));
    let answers = mcp(
        &env,
        &[
            call(
                1,
                "create_page",
                json!({ "section_id": "s-cells", "title": "From the assistant" }),
            ),
            call(2, "read_page", json!({ "page_id": "p-secret" })),
            call(3, "read_page", json!({ "page_id": "../../x" })),
        ],
    );
    assert_eq!(answers[0]["result"]["isError"], true);
    assert!(answers[0]["result"]["content"][0]["text"]
        .as_str()
        .expect("text")
        .contains("doesn't include that"));
    assert_eq!(answers[1]["result"]["isError"], true);
    assert!(answers[1]["result"]["content"][0]["text"]
        .as_str()
        .expect("text")
        .contains("locked"));
    assert_eq!(answers[2]["result"]["isError"], true);
    assert_eq!(test.backend.page_count(), 3, "nothing was added");

    // With read and write, the person still answers each change; here they say no, then yes.
    let writer = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = Env {
        endpoint: Some(Endpoint::Tcp(writer.port)),
        proof_key: Some(writer.api.proof_key()),
        secrets: secrets.clone(),
    };
    writer.approver.answer(allow(Access::ReadWrite, Scope::All));
    writer.approver.answer(Decision::Deny);
    writer.approver.answer(YES_ONCE);
    let answers = mcp(
        &env,
        &[
            call(1, "append_to_page", json!({ "page_id": "p-mito", "markdown": "No." })),
            call(2, "append_to_page", json!({ "page_id": "p-mito", "markdown": "Yes." })),
        ],
    );
    assert_eq!(answers[0]["result"]["isError"], true);
    assert!(answers[0]["result"]["content"][0]["text"]
        .as_str()
        .expect("text")
        .contains("didn't allow"));
    assert_eq!(answers[1]["result"]["isError"], false);
    let text = writer.backend.markdown("p-mito").expect("text");
    assert!(text.contains("Yes.") && !text.contains("No."));
    assert_eq!(writer.backend.history("p-mito"), ["Changed via Claude Desktop"]);
}

#[test]
fn mcp_refuses_what_isnt_a_request() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = env(&test, &secrets);
    let result = run(&env, &["mcp"], "not json\n[1,2]\n{\"id\":1,\"method\":\"ping\"}\n");
    let answers: Vec<Value> = result
        .out
        .lines()
        .map(|line| serde_json::from_str(line).expect("json"))
        .collect();
    assert_eq!(answers[0]["error"]["code"], -32700);
    assert_eq!(answers[1]["error"]["code"], -32600);
    assert_eq!(answers[2]["error"]["code"], -32600, "jsonrpc 2.0 is required");
    assert!(
        test.approver.asked().is_empty(),
        "nothing asks the person before a tool call"
    );
}

#[test]
fn read_back_tools_and_authors_let_an_agent_check_its_own_work() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = env(&test, &secrets);
    test.approver.answer(allow(Access::ReadWrite, Scope::All));
    test.approver.answer(YES_ONCE);
    let input: String = [
        call(
            1,
            "append_to_page",
            json!({ "page_id": "p-mito", "markdown": "## Cristae" }),
        ),
        call(2, "inspect_page", json!({ "page_id": "p-mito" })),
        call(3, "render_page", json!({ "page_id": "p-mito" })),
        call(4, "list_commands", json!({})),
        call(5, "inspect_page", json!({ "page_id": "p-mito", "unknown": 1 })),
    ]
    .iter()
    .map(|line| format!("{line}\n"))
    .collect();
    let result = run(
        &env,
        &["mcp", "--name", "Claude Desktop", "--author", "Claude (copyedit)"],
        &input,
    );
    assert_eq!(result.code, 0, "{}", result.err);
    let answers: Vec<Value> = result
        .out
        .lines()
        .map(|line| serde_json::from_str(line).expect("json"))
        .collect();
    assert_eq!(answers[0]["result"]["isError"], false, "{}", answers[0]);
    assert_eq!(
        test.backend.history("p-mito"),
        ["Changed via Claude Desktop (Claude (copyedit))"]
    );
    let inspected = answers[1]["result"]["content"][0]["text"].as_str().expect("text");
    assert!(
        inspected.contains("## Cristae") && inspected.contains("Claude (copyedit)"),
        "{inspected}"
    );
    assert_eq!(answers[2]["result"]["content"][0]["type"], "image");
    assert_eq!(answers[2]["result"]["content"][0]["mimeType"], "image/png");
    assert!(answers[3]["result"]["content"][0]["text"]
        .as_str()
        .expect("text")
        .contains("page.inspect"));
    assert_eq!(answers[4]["result"]["isError"], true);
    assert!(answers[4]["result"]["content"][0]["text"]
        .as_str()
        .expect("text")
        .starts_with("unknown:"));

    // The same from the command line, which asks for its own access.
    test.approver.answer(allow(Access::Read, Scope::All));
    let folder = tempfile::tempdir().expect("a folder");
    let picture = folder.path().join("mito.png");
    let picture_arg = picture.display().to_string();
    let root = folder.path().display().to_string();
    let rendered = run(
        &env,
        &["render", "p-mito", "--out", &picture_arg, "--write-root", &root],
        "",
    );
    assert_eq!(rendered.code, 0, "{}", rendered.err);
    assert!(std::fs::read(&picture).expect("saved").starts_with(b"\x89PNG"));
    let inspected = run(&env, &["inspect", "p-mito"], "");
    assert_eq!(inspected.code, 0, "{}", inspected.err);
    assert!(inspected.out.contains("## Cristae"));
    let listed = run(&env, &["commands"], "");
    assert_eq!(listed.code, 0, "{}", listed.err);
    assert!(listed.out.contains("inspect") && listed.out.contains("render"));
    let device = run(&env, &["render", "p-mito", "--out", "NUL.png"], "");
    assert_eq!(device.code, 2, "{}", device.err);
}

#[test]
fn hostile_params_never_panic_in_the_mcp_server() {
    let test = TestApi::start();
    let secrets = Arc::new(MemorySecrets::default());
    let env = env(&test, &secrets);
    test.approver.answer(allow(Access::ReadWrite, Scope::All));
    let junk = [
        Value::Null,
        json!(true),
        json!(-1),
        json!(u64::MAX),
        json!(""),
        json!("../../x"),
        json!("\u{0}"),
        json!("x".repeat(5_000)),
        json!([]),
        json!({ "a": [1] }),
    ];
    let mut lines = Vec::new();
    let mut id = 0;
    let tools = opennote_cli::mcp::tools();
    for tool in tools.as_array().expect("tools") {
        let name = tool["name"].as_str().expect("a name");
        for property in tool["inputSchema"]["properties"]
            .as_object()
            .expect("properties")
            .keys()
        {
            for value in &junk {
                id += 1;
                lines.push(call(id, name, json!({ property: value })));
            }
        }
        for arguments in [json!(null), json!([]), json!("x"), json!(7)] {
            id += 1;
            lines.push(json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call",
                               "params": { "name": name, "arguments": arguments } }));
        }
    }
    for message in [
        json!({ "jsonrpc": "2.0", "id": [1], "method": "tools/call" }),
        json!({ "jsonrpc": "2.0", "id": 1, "method": 5 }),
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": "x" }),
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "x".repeat(10_000) } }),
    ] {
        lines.push(message);
    }
    let input: String = lines.iter().map(|line| format!("{line}\n")).collect();
    let result = run(&env, &["mcp"], &input);
    assert_eq!(result.code, 0, "{}", result.err);
    let answers = result.out.lines().count();
    assert_eq!(answers, lines.len(), "every request got exactly one answer");
    assert!(result.out.len() < 2_000_000, "no answer echoes junk back at length");
    assert_eq!(
        test.backend.markdown("p-secret").as_deref(),
        Some("A secret about mitochondria.")
    );
}
