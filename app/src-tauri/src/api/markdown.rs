//! A page as Markdown, for the local API: the text blocks as they are, and a short line in italics for each part
//! that has no text of its own, such as a picture or a drawing. A block of a newer type uses its fallback Markdown.

use serde_json::Value;

/// The page JSON's blocks in page order.
fn blocks_in_order(page: &Value) -> Vec<&Value> {
    let mut blocks: Vec<&Value> = page["blocks"]
        .as_array()
        .map(|blocks| blocks.iter().collect())
        .unwrap_or_default();
    blocks.sort_by(|a, b| a["order"].as_str().unwrap_or("").cmp(b["order"].as_str().unwrap_or("")));
    blocks
}

/// One block as Markdown, or `None` when it adds nothing to read.
fn block_markdown(block: &Value) -> Option<String> {
    let data = &block["data"];
    let text = match block["type"].as_str().unwrap_or("") {
        "text" => data["markdown"].as_str().unwrap_or("").to_owned(),
        "image" => match data["alt"].as_str().filter(|alt| !alt.trim().is_empty()) {
            Some(alt) => format!("*[Picture: {}]*", alt.trim()),
            None => "*[Picture]*".to_owned(),
        },
        "file" => "*[Attached file]*".to_owned(),
        "table" => table_markdown(data)?,
        "ink" => {
            let strokes = data["strokeCount"].as_u64().unwrap_or(0);
            if strokes == 0 {
                return None;
            }
            "*[Drawing]*".to_owned()
        }
        other => match block["fallback"]["markdown"].as_str() {
            Some(fallback) => fallback.to_owned(),
            None => format!("*[{}]*", other.trim_start_matches("ext:")),
        },
    };
    let text = text.trim_end().to_owned();
    (!text.trim().is_empty()).then_some(text)
}

/// A table as a Markdown pipe table, so a reader through the API sees its cells. Without a header row, the
/// table gets an empty one, because a pipe table needs one. `None` when it has no cells.
fn table_markdown(data: &Value) -> Option<String> {
    let columns: Vec<&str> = data["columns"]
        .as_array()?
        .iter()
        .filter_map(|column| column["id"].as_str())
        .collect();
    let rows: Vec<Vec<String>> = data["rows"]
        .as_array()?
        .iter()
        .map(|row| {
            columns
                .iter()
                .map(|column| {
                    let text = row["cells"][column]["markdown"].as_str().unwrap_or("");
                    text.trim().replace('|', r"\|").replace("\r\n", "\n").replace('\n', "<br>")
                })
                .collect()
        })
        .collect();
    if columns.is_empty() || rows.is_empty() {
        return None;
    }
    let line = |cells: &[String]| format!("| {} |", cells.join(" | "));
    let mut rows = rows.into_iter();
    let header = if data["header"] == true {
        rows.next().unwrap_or_default()
    } else {
        vec![String::new(); columns.len()]
    };
    let mut lines = vec![line(&header), line(&vec!["---".to_owned(); columns.len()])];
    lines.extend(rows.map(|row| line(&row)));
    Some(lines.join("\n"))
}

/// The page's title as a heading, then its blocks.
pub fn page_markdown(title: &str, page: &Value) -> String {
    let mut parts = vec![format!("# {}", title.trim())];
    parts.extend(blocks_in_order(page).into_iter().filter_map(block_markdown));
    parts.join("\n\n")
}

/// The ID of the page's last block, for adding after it.
pub fn last_block(page: &Value) -> Option<String> {
    blocks_in_order(page)
        .into_iter()
        .rev()
        .find(|block| block["type"].as_str() != Some("ink"))
        .and_then(|block| block["id"].as_str().map(str::to_owned))
}

/// The page's tags.
pub fn tags(page: &Value) -> Vec<String> {
    page["tags"]
        .as_array()
        .map(|tags| tags.iter().filter_map(|tag| tag.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_text_and_names_the_rest() {
        let page = json!({
            "tags": ["biology"],
            "blocks": [
                { "id": "b3", "type": "image", "order": "a2", "data": { "alt": "A leaf" } },
                { "id": "b1", "type": "text", "order": "a0", "data": { "markdown": "## Light\n\nWater splits.\n" } },
                { "id": "b2", "type": "ink", "order": "a1", "data": { "role": "layer", "strokeCount": 0 } },
                { "id": "b4", "type": "ext:org.example/kanban", "order": "a3", "data": {},
                  "fallback": { "markdown": "**Kanban board**" } },
                { "id": "b5", "type": "ext:org.example/thing", "order": "a4", "data": {} },
            ]
        });
        assert_eq!(
            page_markdown("Photosynthesis", &page),
            "# Photosynthesis\n\n## Light\n\nWater splits.\n\n*[Picture: A leaf]*\n\n**Kanban board**\n\n*[org.example/thing]*"
        );
        assert_eq!(last_block(&page).as_deref(), Some("b5"));
        assert_eq!(tags(&page), ["biology"]);
    }

    #[test]
    fn tables_come_out_as_pipe_tables() {
        let cell = |text: &str| json!({ "markdown": text });
        let page = json!({ "blocks": [{ "id": "t", "type": "table", "order": "a0", "data": {
            "header": true,
            "columns": [{ "id": "c1" }, { "id": "c2" }],
            "rows": [
                { "id": "r1", "cells": { "c1": cell("Item"), "c2": cell("Cost") } },
                { "id": "r2", "cells": { "c1": cell("Pens | ink"), "c2": cell("4") } },
                { "id": "r3", "cells": { "c1": cell("Paper") } },
            ],
        } }] });
        assert_eq!(
            page_markdown("Budget", &page),
            "# Budget\n\n| Item | Cost |\n| --- | --- |\n| Pens \\| ink | 4 |\n| Paper |  |"
        );
        let plain = json!({ "blocks": [{ "id": "t", "type": "table", "order": "a0", "data": {
            "columns": [{ "id": "c1" }],
            "rows": [{ "id": "r1", "cells": { "c1": cell("a") } }],
        } }] });
        assert_eq!(page_markdown("T", &plain), "# T\n\n|  |\n| --- |\n| a |");
    }

    #[test]
    fn an_empty_page_is_its_title() {
        assert_eq!(page_markdown(" Empty ", &json!({ "blocks": [] })), "# Empty");
        assert_eq!(last_block(&json!({})), None);
    }
}
