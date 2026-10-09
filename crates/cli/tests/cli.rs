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
    let exported = run(&env, &["export", "s-cells", "--out", &out], "");
    assert_eq!(exported.code, 0, "{}", exported.err);
    assert!(folder.path().join("Mitochondria.md").is_file());
    assert!(folder.path().join("Ribosomes.md").is_file());
    let twice = run(&env, &["export", "s-cells", "--out", &out], "");
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
        ["list_notebooks", "search", "read_page", "create_page", "append_to_page"]
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
