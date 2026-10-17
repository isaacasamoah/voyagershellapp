use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, env, fs, path::Path, process::Command};
use tree_sitter::{Node, Parser};

const SCHEMA: u32 = 2;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Fact {
    kind: String,
    text: String,
    line: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Topic {
    id: String,
    name: String,
    package: String,
    path: String,
    source_sha256: String,
    structure_sha256: String,
    facts: Vec<Fact>,
}

#[derive(Deserialize, Serialize)]
struct Catalogue {
    schema: u32,
    checkout: String,
    revision: String,
    working_tree_status: String,
    packages: Value,
    topics: Vec<Topic>,
    excluded: Vec<String>,
    refresh: Value,
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()?;
    ensure!(
        output.status.success(),
        "git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(output.stdout)
}

fn text<'a>(node: Node<'_>, bytes: &'a [u8]) -> &'a str {
    std::str::from_utf8(&bytes[node.byte_range()]).unwrap_or("")
}

fn normalized(node: Node<'_>, bytes: &[u8]) -> String {
    if node.child_count() == 0
        || matches!(
            node.kind(),
            "string_literal" | "raw_string_literal" | "string"
        )
    {
        return text(node, bytes).to_owned();
    }
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .filter(|n| !matches!(n.kind(), "line_comment" | "block_comment" | "comment"))
        .map(|n| normalized(n, bytes))
        .collect::<Vec<_>>()
        .join(" ")
}

fn add(facts: &mut Vec<Fact>, node: Node<'_>, kind: &str, value: String) {
    facts.push(Fact {
        kind: kind.into(),
        text: value,
        line: node.start_position().row + 1,
    });
}

fn declaration(node: Node<'_>, bytes: &[u8]) -> String {
    let body = node.child_by_field_name("body");
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .filter(|n| {
            Some(*n) != body && !matches!(n.kind(), "line_comment" | "block_comment" | "comment")
        })
        .map(|n| normalized(n, bytes))
        .collect::<Vec<_>>()
        .join(" ")
}

fn owner(node: Node<'_>, bytes: &[u8]) -> String {
    let mut parent = node.parent();
    let mut scopes = Vec::new();
    while let Some(node) = parent {
        if matches!(
            node.kind(),
            "struct_item" | "enum_item" | "impl_item" | "trait_item" | "mod_item"
        ) {
            scopes.push(declaration(node, bytes));
        }
        parent = node.parent();
    }
    scopes.reverse();
    if scopes.is_empty() {
        String::new()
    } else {
        format!("{} :: ", scopes.join(" :: "))
    }
}

fn collect(node: Node<'_>, bytes: &[u8], rust: bool, facts: &mut Vec<Fact>) {
    let kind = node.kind();
    if rust {
        match kind {
            "function_item" | "function_signature_item" => {
                let owner = node
                    .parent()
                    .and_then(|n| n.parent())
                    .filter(|n| matches!(n.kind(), "impl_item" | "trait_item"));
                let prefix = owner
                    .map(|n| format!("{} :: ", declaration(n, bytes)))
                    .unwrap_or_default();
                add(
                    facts,
                    node,
                    "function",
                    format!("{prefix}{}", declaration(node, bytes)),
                );
                return;
            }
            "struct_item" | "enum_item" | "trait_item" | "impl_item" | "mod_item" => {
                add(facts, node, kind, declaration(node, bytes));
            }
            "use_declaration" | "type_item" | "field_declaration" | "enum_variant" => {
                add(
                    facts,
                    node,
                    kind,
                    format!("{}{}", owner(node, bytes), normalized(node, bytes)),
                );
                return;
            }
            "macro_definition" | "macro_invocation" => return,
            _ => {}
        }
    } else {
        match kind {
            "function_declaration" | "generator_function_declaration" | "method_definition" => {
                add(facts, node, "function", declaration(node, bytes));
            }
            "import_statement" => {
                add(facts, node, kind, declaration(node, bytes));
            }
            "export_statement" if node.child_by_field_name("declaration").is_none() => {
                add(facts, node, kind, declaration(node, bytes));
            }
            "variable_declarator" => {
                if let (Some(name), Some(value)) = (
                    node.child_by_field_name("name"),
                    node.child_by_field_name("value"),
                ) {
                    if matches!(value.kind(), "arrow_function" | "function_expression") {
                        add(
                            facts,
                            node,
                            "function",
                            format!("{} = {}", text(name, bytes), declaration(value, bytes)),
                        );
                    }
                }
            }
            "call_expression" => {
                if let (Some(function), Some(args)) = (
                    node.child_by_field_name("function"),
                    node.child_by_field_name("arguments"),
                ) {
                    let name = text(function, bytes);
                    let mut cursor = args.walk();
                    let first = args.named_children(&mut cursor).next();
                    if let Some(first) = first.filter(|n| n.kind() == "string") {
                        if name == "require" {
                            add(facts, node, "import", text(first, bytes).into());
                        } else if name.starts_with("ipcMain.") || name.starts_with("ipcRenderer.") {
                            add(
                                facts,
                                node,
                                "ipc",
                                format!("{name}({})", text(first, bytes)),
                            );
                        } else if name == "contextBridge.exposeInMainWorld" {
                            add(facts, node, "bridge", text(first, bytes).into());
                        }
                    }
                }
            }
            "assignment_expression" => {
                if let (Some(left), Some(right)) = (
                    node.child_by_field_name("left"),
                    node.child_by_field_name("right"),
                ) {
                    let name = text(left, bytes);
                    if name == "module.exports" && right.kind() == "object" {
                        let mut cursor = right.walk();
                        for entry in right.named_children(&mut cursor) {
                            let key = entry.child_by_field_name("key").unwrap_or(entry);
                            add(facts, entry, "export", text(key, bytes).into());
                        }
                    } else if name.starts_with("exports.") || name.starts_with("module.exports.") {
                        add(facts, node, "export", name.into());
                    }
                }
            }
            _ => {}
        }
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect(child, bytes, rust, facts);
    }
}

fn extract(bytes: &[u8], rust: bool) -> Result<Vec<Fact>> {
    let mut parser = Parser::new();
    let language = if rust {
        tree_sitter_rust::LANGUAGE
    } else {
        tree_sitter_javascript::LANGUAGE
    };
    parser.set_language(&language.into())?;
    let tree = parser
        .parse(bytes, None)
        .context("parser returned no tree")?;
    ensure!(
        !tree.root_node().has_error(),
        "syntax errors: catalogue not refreshed"
    );
    let mut facts = Vec::new();
    collect(tree.root_node(), bytes, rust, &mut facts);
    facts.sort_by(|a, b| (&a.kind, &a.text, a.line).cmp(&(&b.kind, &b.text, b.line)));
    facts.dedup_by(|a, b| a.kind == b.kind && a.text == b.text);
    Ok(facts)
}

fn fingerprint(facts: &[Fact]) -> Result<String> {
    let structure: BTreeSet<_> = facts.iter().map(|f| (&f.kind, &f.text)).collect();
    Ok(hash(&serde_json::to_vec(&structure)?))
}

fn scan(root: &Path, previous: Option<&Catalogue>) -> Result<Catalogue> {
    let root = root.canonicalize()?;
    if let Some(previous) = previous {
        ensure!(
            previous.schema == SCHEMA && previous.checkout == root.to_string_lossy(),
            "cache belongs to another scanner or checkout"
        );
    }
    let revision = String::from_utf8(git(&root, &["rev-parse", "HEAD"])?)?
        .trim()
        .to_owned();
    let status = git(&root, &["status", "--porcelain=v1", "-uno"])?;
    let cargo_bytes = fs::read(root.join("Cargo.toml"))?;
    let desktop_bytes = fs::read(root.join("desktop/package.json"))?;
    let cargo: toml::Value = toml::from_str(std::str::from_utf8(&cargo_bytes)?)?;
    let desktop: Value = serde_json::from_slice(&desktop_bytes)?;
    let package = cargo["package"]["name"]
        .as_str()
        .context("missing Rust package name")?;
    let desktop_name = desktop["name"]
        .as_str()
        .context("missing desktop package name")?;
    let path_bytes = git(
        &root,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            "src",
            "desktop/src",
        ],
    )?;
    let paths = path_bytes
        .split(|byte| *byte == 0)
        .filter(|p| !p.is_empty())
        .map(|p| String::from_utf8(p.to_vec()))
        .collect::<std::result::Result<BTreeSet<_>, _>>()?;
    let mut topics = Vec::new();
    let mut excluded = Vec::new();
    let mut parsed = 0;
    let mut reused = 0;
    let mut changed = Vec::new();
    for path in paths {
        let rust = path.ends_with(".rs");
        if (!rust && !path.ends_with(".js") && !path.ends_with(".cjs"))
            || path.ends_with("/tests.rs")
        {
            excluded.push(path);
            continue;
        }
        let file = root.join(&path);
        if !file.exists() {
            continue;
        }
        ensure!(
            fs::symlink_metadata(&file)?.is_file() && file.canonicalize()?.starts_with(&root),
            "unsafe source path: {path}"
        );
        let bytes = fs::read(&file)?;
        ensure!(bytes.len() <= 2 * 1024 * 1024, "oversized source: {path}");
        std::str::from_utf8(&bytes).with_context(|| format!("non UTF-8 source: {path}"))?;
        let source_sha256 = hash(&bytes);
        let old = previous.and_then(|p| p.topics.iter().find(|t| t.path == path));
        let facts = if let Some(old) = old.filter(|t| t.source_sha256 == source_sha256) {
            reused += 1;
            old.facts.clone()
        } else {
            parsed += 1;
            extract(&bytes, rust).with_context(|| format!("parse {path}"))?
        };
        let structure_sha256 = fingerprint(&facts)?;
        if old.is_none_or(|old| old.structure_sha256 != structure_sha256) {
            changed.push(path.clone());
        }
        let name = if rust {
            path.trim_start_matches("src/")
                .trim_end_matches(".rs")
                .trim_end_matches("/mod")
                .replace('/', "::")
        } else {
            path.trim_start_matches("desktop/src/")
                .trim_end_matches(".cjs")
                .trim_end_matches(".js")
                .to_owned()
        };
        topics.push(Topic {
            id: format!("{}:{path}", if rust { "rust" } else { "javascript" }),
            name,
            package: if rust { package } else { desktop_name }.into(),
            path,
            source_sha256,
            structure_sha256,
            facts,
        });
    }
    let removed: Vec<_> = previous
        .into_iter()
        .flat_map(|p| &p.topics)
        .filter(|old| !topics.iter().any(|t| t.id == old.id))
        .map(|t| &t.path)
        .collect();
    ensure!(
        revision == String::from_utf8(git(&root, &["rev-parse", "HEAD"])?)?.trim(),
        "checkout changed during scan"
    );
    ensure!(
        status == git(&root, &["status", "--porcelain=v1", "-uno"])?,
        "working tree changed during scan"
    );
    for topic in &topics {
        ensure!(
            topic.source_sha256 == hash(&fs::read(root.join(&topic.path))?),
            "source changed during scan: {}",
            topic.path
        );
    }
    ensure!(
        path_bytes
            == git(
                &root,
                &[
                    "ls-files",
                    "-z",
                    "--cached",
                    "--others",
                    "--exclude-standard",
                    "--",
                    "src",
                    "desktop/src"
                ]
            )?,
        "source file list changed during scan"
    );
    ensure!(
        cargo_bytes == fs::read(root.join("Cargo.toml"))?
            && desktop_bytes == fs::read(root.join("desktop/package.json"))?,
        "manifests changed during scan"
    );
    let packages = json!({"rust": {"manifest": "Cargo.toml", "name": package, "dependencies": cargo.get("dependencies")}, "javascript": {"manifest": "desktop/package.json", "name": desktop_name, "main": desktop.get("main"), "dependencies": desktop.get("dependencies"), "devDependencies": desktop.get("devDependencies")}});
    let packages_changed = previous.is_none_or(|p| p.packages != packages);
    Ok(Catalogue {
        schema: SCHEMA,
        checkout: root.to_string_lossy().into_owned(),
        revision,
        working_tree_status: String::from_utf8(status)?,
        packages,
        topics,
        excluded,
        refresh: json!({"parsed": parsed, "reused": reused, "structure_changed": changed, "removed": removed, "packages_changed": packages_changed}),
    })
}

fn main() -> Result<()> {
    let args: Vec<_> = env::args().skip(1).collect();
    ensure!(
        (1..=2).contains(&args.len()),
        "usage: topic_scan REPOSITORY [PREVIOUS_CATALOGUE]"
    );
    let previous = args
        .get(1)
        .map(|path| -> Result<Catalogue> { Ok(serde_json::from_slice(&fs::read(path)?)?) })
        .transpose()?;
    let result = scan(Path::new(&args[0]), previous.as_ref())?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rust_body_and_formatting_do_not_change_structure_but_interface_does() -> Result<()> {
        let before = fingerprint(&extract(b"pub fn send(id: u64) -> bool { true }", true)?)?;
        let body = fingerprint(&extract(
            b"// moved\npub fn send ( id:u64 )->bool { false }",
            true,
        )?)?;
        let interface = fingerprint(&extract(b"pub fn send(id: &str) -> bool { true }", true)?)?;
        assert_eq!(before, body);
        assert_ne!(before, interface);
        Ok(())
    }

    #[test]
    fn ipc_channel_and_dependency_changes_are_structural() -> Result<()> {
        let before = fingerprint(&extract(
            b"const x=require('./control'); ipcMain.handle('send',()=>1);",
            false,
        )?)?;
        let body = fingerprint(&extract(
            b"const x=require('./control'); ipcMain.handle('send',()=>2);",
            false,
        )?)?;
        let channel = fingerprint(&extract(
            b"const x=require('./control'); ipcMain.handle('steer',()=>2);",
            false,
        )?)?;
        let dependency = fingerprint(&extract(
            b"const x=require('./native'); ipcMain.handle('send',()=>2);",
            false,
        )?)?;
        assert_eq!(before, body);
        assert_ne!(before, channel);
        assert_ne!(before, dependency);
        Ok(())
    }

    #[test]
    fn invalid_source_does_not_become_an_empty_topic() {
        assert!(extract(b"pub fn broken( {", true).is_err());
    }

    #[test]
    fn moving_a_field_between_types_changes_structure() -> Result<()> {
        let before = fingerprint(&extract(b"struct A { id: u64 } struct B {}", true)?)?;
        let after = fingerprint(&extract(b"struct A {} struct B { id: u64 }", true)?)?;
        assert_ne!(before, after);
        Ok(())
    }

    #[test]
    fn arrow_parameters_are_structural_but_exported_function_bodies_are_not() -> Result<()> {
        let before = fingerprint(&extract(
            b"const send=(id)=>1; export function get(id){return 1}",
            false,
        )?)?;
        let body = fingerprint(&extract(
            b"const send=(id)=>2; export function get(id){return 2}",
            false,
        )?)?;
        let interface = fingerprint(&extract(
            b"const send=(id,mode)=>2; export function get(id){return 2}",
            false,
        )?)?;
        assert_eq!(before, body);
        assert_ne!(before, interface);
        Ok(())
    }
}
