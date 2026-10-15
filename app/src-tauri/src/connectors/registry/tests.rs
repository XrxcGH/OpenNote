//! Checks on the catalog: complete entries, pinned hosts, and a sentence in the strings for every name.

use std::collections::BTreeSet;

use super::*;

fn host_of(url: &str) -> &str {
    url.strip_prefix("https://")
        .expect("an https address")
        .split(['/', '?'])
        .next()
        .unwrap_or_default()
}

#[test]
fn ids_are_unique_and_every_entry_is_complete() {
    let ids: BTreeSet<_> = CONNECTORS.iter().map(|def| def.id).collect();
    assert_eq!(ids.len(), CONNECTORS.len());
    for def in CONNECTORS {
        assert!(
            !def.name.is_empty() && !def.features.is_empty() && !def.access.is_empty(),
            "{}",
            def.id
        );
        assert!(def.id.chars().all(|c| c.is_ascii_lowercase()), "{}", def.id);
    }
}

#[test]
fn every_oauth_endpoint_is_https_on_a_pinned_host() {
    for def in CONNECTORS {
        let Auth::OAuth(oauth) = def.auth else { continue };
        let mut urls = vec![oauth.authorize_url, oauth.token_url];
        match oauth.revoke {
            Revoke::Form { url, .. } | Revoke::BearerPost { url } | Revoke::BearerDelete { url } => urls.push(url),
            Revoke::None => {}
        }
        if let AccountFrom::Call { url, .. } = oauth.account {
            urls.push(url);
        }
        for url in urls {
            assert!(
                def.hosts.contains(&host_of(url)),
                "{}: {url} is not on a pinned host",
                def.id
            );
        }
    }
}

#[test]
fn hosts_are_plain_names() {
    for def in CONNECTORS {
        for host in def.hosts {
            assert!(host
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-'));
            assert!(host.contains('.'), "{host}");
        }
    }
}

#[test]
fn school_connectors_have_no_fixed_host_and_the_others_have_some() {
    for def in CONNECTORS {
        let school = def.kind() == AuthKind::TokenAndUrl;
        assert_eq!(def.hosts.is_empty(), school, "{}", def.id);
    }
}

#[test]
fn fixed_ports_are_distinct_and_unprivileged() {
    let ports: Vec<u16> = CONNECTORS
        .iter()
        .filter_map(|def| match def.auth {
            Auth::OAuth(OAuthDef {
                redirect: Redirect::FixedPort(port),
                ..
            }) => Some(port),
            _ => None,
        })
        .collect();
    assert_eq!(ports.iter().collect::<BTreeSet<_>>().len(), ports.len());
    assert!(ports.iter().all(|port| *port >= 1024));
}

#[test]
fn the_big_two_let_the_port_vary_as_rfc_8252_asks() {
    for id in ["microsoft", "google"] {
        let Some(ConnectorDef {
            auth: Auth::OAuth(oauth),
            ..
        }) = find(id)
        else {
            panic!("{id} is OAuth");
        };
        assert_eq!(oauth.redirect, Redirect::AnyPort);
        assert!(oauth.pkce);
    }
}

#[test]
fn the_listed_services_are_all_there() {
    let ids: Vec<_> = CONNECTORS.iter().map(|def| def.id).collect();
    for id in [
        "microsoft",
        "google",
        "slack",
        "dropbox",
        "box",
        "vimeo",
        "readwise",
        "canvas",
        "moodle",
        "webdav",
    ] {
        assert!(ids.contains(&id), "{id}");
    }
}

#[test]
fn every_capability_has_a_sentence_in_the_interface_strings() {
    let strings = include_str!("../../../../src/strings/en/connectors.ts");
    for def in CONNECTORS {
        for access in def.access {
            assert!(
                strings.contains(&format!("{}:", access.capability)),
                "strings/en/connectors.ts has no sentence for {}",
                access.capability
            );
        }
        assert!(strings.contains(&format!("{}:", def.id)), "no strings for {}", def.id);
        for feature in def.features {
            assert!(
                strings.contains(&format!("{feature}:")),
                "no feature name for {feature}"
            );
        }
    }
}
