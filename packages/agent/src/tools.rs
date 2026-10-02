//! Native read-only search, GitHub retrieval, and background processes.
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, Command},
    sync::Mutex as AsyncMutex,
};

pub fn shell(command: &str) -> Command {
    #[cfg(windows)]
    let mut c = {
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.as_std_mut().process_group(0);
    }
    c.kill_on_drop(true);
    c
}
fn schema(name: &str, description: &str, properties: Value, required: Value) -> Value {
    json!({"type":"function","name":name,"description":description,"parameters":{"type":"object","properties":properties,"required":required,"additionalProperties":false},"strict":false})
}
pub fn definitions() -> Vec<Value> {
    vec![
        schema("ls","List files in a directory.",json!({"path":{"type":"string"}}),json!(["path"])),
        schema("find","Find files matching a glob. Skips .git, node_modules, and target directories.",json!({"pattern":{"type":"string"},"path":{"type":"string"}}),json!(["pattern"])),
        schema("grep","Search UTF-8 files using a regex, returning file paths and line numbers. Results are bounded.",json!({"pattern":{"type":"string"},"path":{"type":"string"},"ignoreCase":{"type":"boolean"}}),json!(["pattern"])),
        schema("background_command","Manage long-running shell commands with start, check, input, or stop. Check drains new output. Commands are stopped when the session stops.",json!({"action":{"type":"string","enum":["start","check","input","stop"]},"command":{"type":"string"},"id":{"type":"string"},"input":{"type":"string"}}),json!(["action"])),
        schema("finder","Explore the current codebase with a dedicated read-only agent. Use for complex searches by functionality or concept.",json!({"query":{"type":"string"}}),json!(["query"])),
        schema("libarian","Research GitHub repositories with a dedicated read-only agent using the authenticated gh CLI.",json!({"query":{"type":"string"}}),json!(["query"])),
        schema("web_search","Search the web for current information using OpenAI web search. Returns source links.",json!({"query":{"type":"string"}}),json!(["query"])),
        schema("github","Read GitHub API resources with the authenticated gh CLI. Only GET is supported. Use repos/owner/repo/contents/path, repos/owner/repo/git/trees/ref?recursive=1, search/code?q=..., search/repositories?q=..., or repos/owner/repo/compare/base...head. For content responses, base64 file content is decoded automatically.",json!({"endpoint":{"type":"string"}}),json!(["endpoint"])),
        schema("ask_user","Ask the user an essential question and wait for their answer. Provide options for a choice or omit options for free text.",json!({"question":{"type":"string"},"options":{"type":"array","items":{"type":"string"}}}),json!(["question"])),
    ]
}

type Answers = HashMap<String, tokio::sync::oneshot::Sender<Value>>;
static ANSWERS: OnceLock<Mutex<Answers>> = OnceLock::new();
pub async fn question(args: &Value) -> Result<String> {
    let question = super::text(args, "question")?;
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    ANSWERS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap()
        .insert(id.clone(), tx);
    let options = args["options"].as_array().cloned().unwrap_or_default();
    super::emit(
        json!({"type":"extension_ui_request","id":id,"method":if options.is_empty(){"input"}else{"select"},"title":question,"options":options}),
    );
    let result = rx.await.context("Question was cancelled")?;
    if result["cancelled"] == true {
        return Ok("The user skipped the question.".into());
    }
    Ok(result["value"].as_str().unwrap_or_default().to_string())
}
pub fn answer(message: Value) {
    if let Some(id) = message["id"].as_str() {
        if let Some(sender) = ANSWERS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .unwrap()
            .remove(id)
        {
            let _ = sender.send(message);
        }
    }
}
pub fn cancel_questions() {
    ANSWERS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap()
        .clear();
}

fn files(path: &Path) -> impl Iterator<Item = walkdir::DirEntry> {
    walkdir::WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            ![".git", "node_modules", "target"]
                .contains(&entry.file_name().to_string_lossy().as_ref())
        })
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .take(20000)
}
pub async fn search(name: &str, args: &Value, cwd: &Path) -> Result<String> {
    let path = cwd.join(args["path"].as_str().unwrap_or("."));
    match name {
        "ls" => {
            let mut names = std::fs::read_dir(path)?
                .filter_map(Result::ok)
                .map(|entry| {
                    format!(
                        "{}{}",
                        entry.file_name().to_string_lossy(),
                        if entry.file_type().is_ok_and(|t| t.is_dir()) {
                            "/"
                        } else {
                            ""
                        }
                    )
                })
                .collect::<Vec<_>>();
            names.sort();
            Ok(names.into_iter().take(1000).collect::<Vec<_>>().join("\n"))
        }
        "find" => {
            let glob = globset::Glob::new(super::text(args, "pattern")?)?.compile_matcher();
            Ok(files(&path)
                .filter(|entry| {
                    glob.is_match(entry.path().strip_prefix(&path).unwrap_or(entry.path()))
                        || glob.is_match(entry.file_name())
                })
                .take(1000)
                .map(|entry| entry.path().display().to_string())
                .collect::<Vec<_>>()
                .join("\n"))
        }
        "grep" => {
            let regex = regex::RegexBuilder::new(super::text(args, "pattern")?)
                .case_insensitive(args["ignoreCase"].as_bool().unwrap_or(false))
                .build()?;
            let mut output = String::new();
            let mut matches = 0;
            for file in files(&path) {
                if file.metadata().is_ok_and(|m| m.len() > 1024 * 1024) {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(file.path()) else {
                    continue;
                };
                for (line, text) in text
                    .lines()
                    .enumerate()
                    .filter(|(_, line)| regex.is_match(line))
                {
                    output.push_str(&format!(
                        "{}:{}:{}\n",
                        file.path().display(),
                        line + 1,
                        text.chars().take(500).collect::<String>()
                    ));
                    matches += 1;
                    if matches >= 200 || output.len() > 40000 {
                        return Ok(output);
                    }
                }
            }
            Ok(output)
        }
        _ => bail!("unknown search tool"),
    }
}

pub async fn github(args: &Value, cwd: &Path) -> Result<String> {
    let endpoint = super::text(args, "endpoint")?;
    if !endpoint.starts_with("repos/")
        && !endpoint.starts_with("search/")
        && !endpoint.starts_with("users/")
    {
        bail!("Use a read-only GitHub repository, search, or user endpoint");
    }
    let mut c = Command::new("gh");
    #[cfg(windows)]
    c.creation_flags(0x08000000);
    let out = c
        .args([
            "api",
            "--hostname",
            "github.com",
            "--method",
            "GET",
            endpoint,
        ])
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .context("Install and authenticate gh to use GitHub research")?;
    if !out.status.success() {
        bail!(
            "GitHub request failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let body = String::from_utf8(out.stdout)?;
    if let Ok(value) = serde_json::from_str::<Value>(&body) {
        if value["encoding"] == "base64" {
            use base64::Engine;
            let content = base64::engine::general_purpose::STANDARD.decode(
                value["content"]
                    .as_str()
                    .unwrap_or_default()
                    .replace('\n', ""),
            )?;
            return Ok(String::from_utf8_lossy(&content)
                .chars()
                .take(40000)
                .collect());
        }
    }
    Ok(body.chars().take(40000).collect())
}

struct Background {
    child: Child,
    stdin: Option<ChildStdin>,
    output: Arc<Mutex<Vec<u8>>>,
    tree: Option<super::process::ProcessTree>,
}
static BACKGROUND: OnceLock<AsyncMutex<HashMap<String, Background>>> = OnceLock::new();
fn registry() -> &'static AsyncMutex<HashMap<String, Background>> {
    BACKGROUND.get_or_init(|| AsyncMutex::new(HashMap::new()))
}
async fn drain(mut reader: impl tokio::io::AsyncRead + Unpin, output: Arc<Mutex<Vec<u8>>>) {
    let mut chunk = [0u8; 4096];
    while let Ok(n) = reader.read(&mut chunk).await {
        if n == 0 {
            break;
        }
        let mut bytes = output.lock().unwrap();
        bytes.extend_from_slice(&chunk[..n]);
        if bytes.len() > 65536 {
            let excess = bytes.len() - 65536;
            bytes.drain(..excess);
        }
    }
}
pub async fn foreground(command: &str, cwd: &Path) -> Result<String> {
    let mut child = shell(command)
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    let _tree = super::process::ProcessTree::attach(&child)?;
    let output = Arc::new(Mutex::new(Vec::new()));
    let stdout = tokio::spawn(drain(
        child.stdout.take().context("missing stdout")?,
        output.clone(),
    ));
    let stderr = tokio::spawn(drain(
        child.stderr.take().context("missing stderr")?,
        output.clone(),
    ));
    let status = tokio::time::timeout(std::time::Duration::from_secs(120), child.wait())
        .await
        .context("command exceeded 120 seconds")??;
    drop(_tree);
    let _ = stdout.await;
    let _ = stderr.await;
    Ok(format!(
        "Exit status: {status}\n{}",
        String::from_utf8_lossy(&output.lock().unwrap())
    ))
}
pub async fn background(args: &Value, cwd: &Path) -> Result<String> {
    if args["action"] == "start" {
        let mut c = shell(super::text(args, "command")?);
        let mut child = c
            .current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        let tree = Some(super::process::ProcessTree::attach(&child)?);
        let output = Arc::new(Mutex::new(Vec::new()));
        tokio::spawn(drain(
            child.stdout.take().context("missing stdout")?,
            output.clone(),
        ));
        tokio::spawn(drain(
            child.stderr.take().context("missing stderr")?,
            output.clone(),
        ));
        let stdin = child.stdin.take();
        let id = uuid::Uuid::new_v4().to_string();
        registry().lock().await.insert(
            id.clone(),
            Background {
                child,
                stdin,
                output,
                tree,
            },
        );
        return Ok(format!(
            "Started background command {id}. Use check to read its output."
        ));
    }
    let mut commands = registry().lock().await;
    let id = super::text(args, "id")?;
    let command = commands
        .get_mut(id)
        .context("Unknown background command ID")?;
    match args["action"].as_str() {
        Some("input") => {
            command
                .stdin
                .as_mut()
                .context("command stdin closed")?
                .write_all(super::text(args, "input")?.as_bytes())
                .await?;
            Ok("Input sent.".into())
        }
        Some("stop") => {
            command.tree.take();
            let status = command.child.wait().await?;
            Ok(format!("Command stopped: {status}"))
        }
        Some("check") => {
            let status = command
                .child
                .try_wait()?
                .map(|s| s.to_string())
                .unwrap_or_else(|| "running".into());
            let bytes = std::mem::take(&mut *command.output.lock().unwrap());
            Ok(format!("{status}\n{}", String::from_utf8_lossy(&bytes)))
        }
        _ => bail!("Unsupported background command action"),
    }
}
pub async fn stop_background() {
    for (_, mut command) in registry().lock().await.drain() {
        command.tree.take();
        let _ = command.child.wait().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stopping_background_work_terminates_the_process() {
        let command = if cfg!(windows) {
            "Start-Sleep -Seconds 60"
        } else {
            "sleep 60"
        };
        let result = background(
            &json!({"action":"start","command":command}),
            &std::env::temp_dir(),
        )
        .await
        .unwrap();
        let id = result
            .split_whitespace()
            .nth(3)
            .unwrap()
            .trim_end_matches('.');
        let stopped = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            background(&json!({"action":"stop","id":id}), &std::env::temp_dir()),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(stopped.starts_with("Command stopped:"));
        assert!(
            !background(&json!({"action":"check","id":id}), &std::env::temp_dir())
                .await
                .unwrap()
                .starts_with("running")
        );
        stop_background().await;
    }
}

pub async fn research(
    name: &str,
    query: &str,
    token: &str,
    model: &str,
    cwd: &Path,
) -> Result<String> {
    if name == "web_search" {
        let result = super::response_recorded(
            token,
            json!({"model":model,"input":query,"tools":[{"type":"web_search"}]}),
            false,
        )
        .await?;
        return Ok(result["output"].to_string());
    }
    let definitions = if name == "finder" {
        let mut definitions = super::tools()
            .as_array()
            .unwrap()
            .iter()
            .filter(|tool| tool["name"] == "read")
            .cloned()
            .collect::<Vec<_>>();
        definitions.extend(self::definitions().into_iter().filter(|tool| {
            ["ls", "find", "grep"]
                .iter()
                .any(|allowed| tool["name"] == *allowed)
        }));
        definitions
    } else {
        self::definitions()
            .into_iter()
            .filter(|tool| tool["name"] == "github")
            .collect()
    };
    let base_prompt = if name == "finder" {
        include_str!("../FINDER.md")
    } else {
        include_str!("../LIBARIAN.md")
    };
    let prompt=format!("{base_prompt}\nUse only the tools supplied in this request. For GitHub research, the github tool provides read-only GET access to repository search, contents, trees, and comparisons.");
    let mut input = vec![json!({"role":"user","content":query})];
    for _ in 0..12 {
        let result=super::response_recorded(token,json!({"model":model,"instructions":prompt,"input":input,"tools":definitions,"include":["reasoning.encrypted_content"]}),false).await?;
        let output = result["output"]
            .as_array()
            .context("Missing research output")?;
        input.extend(output.iter().cloned());
        let calls = output
            .iter()
            .filter(|item| item["type"] == "function_call")
            .collect::<Vec<_>>();
        if super::response_finished(output) {
            return Ok(output
                .iter()
                .flat_map(|item| item["content"].as_array().into_iter().flatten())
                .filter_map(|part| part["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n"));
        }
        for call in calls {
            let name = call["name"]
                .as_str()
                .context("Missing research tool name")?;
            let args = serde_json::from_str(call["arguments"].as_str().unwrap_or("{}"))?;
            let result = match name {
                "github" => github(&args, cwd).await,
                "read" => super::execute(name, &args, cwd).await,
                "ls" | "find" | "grep" => search(name, &args, cwd).await,
                _ => Err(anyhow::anyhow!("Read-only research does not allow {name}")),
            };
            input.push(json!({"type":"function_call_output","call_id":call["call_id"],"output":result.unwrap_or_else(|e|e.to_string())}));
        }
    }
    bail!("Research reached its 12-request limit; use a more focused query")
}
