//! Which apps on this machine can open a path — a session's working directory
//! from the right panel's split button, or one file from a transcript row.
//!
//! Everything here is macOS-only and says so by returning an empty list
//! elsewhere: `open(1)`, `.app` bundles and `.icns` are all one platform's,
//! and no other build has a window to draw the button in yet.

use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::{
    collections::HashMap,
    process::Command,
    sync::{LazyLock, Mutex},
};

use serde::Serialize;
use ts_rs::TS;

use crate::harness::Harness;

/// Which run of the menu an app belongs to. Not cosmetic: "open in Cursor" and
/// "open in Ghostty" are different asks, and a flat list of both reads as one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum ExternalAppKind {
    Editor,
    Terminal,
    /// Finder. Its own kind rather than an editor, because it is the entry
    /// every machine has and the one the reader falls back to.
    Files,
}

/// An installed app a path can be handed to.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ExternalApp {
    /// The bundle's absolute path, and the app's address everywhere else here.
    ///
    /// Deliberately not a bundle identifier. `open -b` hands the id to Launch
    /// Services, which picks whichever copy it has indexed — so a second
    /// install of an editor, or a stale index, silently opens the wrong one.
    /// The scan found this bundle by path; the path is what it knows.
    pub path: String,
    pub name: String,
    pub kind: ExternalAppKind,
    /// The app's own icon as a `data:` PNG, or `None` where none could be read.
    /// Absent is ordinary — a bundle can keep its icon in an asset catalog with
    /// no `.icns` beside it — so the button falls back to a glyph rather than
    /// treating this as a failure.
    pub icon: Option<String>,
}

/// One row of the curated table: the bundle's file name, what to call it, and
/// which run it sits in.
#[cfg(target_os = "macos")]
struct Known {
    /// Matched on the bundle's file name **exactly**, never as a substring.
    /// `Cloudflare WARP.app` is not `Warp.app`, and a contains-check lists it
    /// as a terminal that then ignores the directory.
    bundle: &'static str,
    name: &'static str,
    kind: ExternalAppKind,
}

#[cfg(target_os = "macos")]
const fn editor(bundle: &'static str, name: &'static str) -> Known {
    Known { bundle, name, kind: ExternalAppKind::Editor }
}

#[cfg(target_os = "macos")]
const fn terminal(bundle: &'static str, name: &'static str) -> Known {
    Known { bundle, name, kind: ExternalAppKind::Terminal }
}

/// The apps this menu knows how to hand a path to, in the order drawn.
///
/// Curated rather than discovered, and the curation *is* the guarantee: every
/// entry here takes a directory as `open -a <bundle> <dir>`, and every
/// [`ExternalAppKind::Editor`] takes a single file the same way — which is what
/// a filename in the transcript is handed to. Reading each found
/// bundle's `CFBundleDocumentTypes` for `public.folder` was the alternative and
/// it is the wrong gate — `open -a` names the app outright rather than asking
/// Launch Services to rank handlers, so it reaches apps that declare nothing
/// (MacVim declares no folder type and opens one fine). Gating on the
/// declaration would hide apps that work.
///
/// An app absent from this table costs one entry, never the list.
#[cfg(target_os = "macos")]
const KNOWN: &[Known] = &[
    editor("Visual Studio Code.app", "VS Code"),
    editor("Visual Studio Code - Insiders.app", "VS Code Insiders"),
    editor("Cursor.app", "Cursor"),
    editor("Windsurf.app", "Windsurf"),
    editor("Zed.app", "Zed"),
    editor("Zed Preview.app", "Zed Preview"),
    editor("Sublime Text.app", "Sublime Text"),
    editor("Nova.app", "Nova"),
    editor("BBEdit.app", "BBEdit"),
    editor("Xcode.app", "Xcode"),
    editor("IntelliJ IDEA.app", "IntelliJ IDEA"),
    editor("IntelliJ IDEA CE.app", "IntelliJ IDEA CE"),
    editor("WebStorm.app", "WebStorm"),
    editor("PyCharm.app", "PyCharm"),
    editor("PyCharm CE.app", "PyCharm CE"),
    editor("GoLand.app", "GoLand"),
    editor("RustRover.app", "RustRover"),
    editor("CLion.app", "CLion"),
    editor("PhpStorm.app", "PhpStorm"),
    editor("RubyMine.app", "RubyMine"),
    editor("DataGrip.app", "DataGrip"),
    editor("Android Studio.app", "Android Studio"),
    editor("VimR.app", "VimR"),
    editor("MacVim.app", "MacVim"),
    terminal("Ghostty.app", "Ghostty"),
    terminal("iTerm.app", "iTerm"),
    terminal("Warp.app", "Warp"),
    terminal("WezTerm.app", "WezTerm"),
    terminal("Terminal.app", "Terminal"),
];

/// Finder, which is in none of the scanned directories and on every mac.
#[cfg(target_os = "macos")]
const FINDER: &str = "/System/Library/CoreServices/Finder.app";

/// Where a `.app` bundle lives. One `read_dir` each and no `mdfind`: Spotlight
/// can be off or still indexing, and the common case is an app that is not
/// installed at all — where a per-app query is a spawn that answers nothing.
#[cfg(target_os = "macos")]
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        // Setapp keeps its own subfolder under /Applications.
        PathBuf::from("/Applications/Setapp"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    // Where JetBrains Toolbox and per-user installs land.
    if let Some(home) = std::env::home_dir() {
        dirs.push(home.join("Applications"));
    }
    dirs
}

/// Bundle file name to its path, for every `.app` in `dirs`.
#[cfg(target_os = "macos")]
fn installed(dirs: &[PathBuf]) -> HashMap<String, PathBuf> {
    let mut found = HashMap::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".app") {
                continue;
            }
            // First directory wins, so a machine-wide install outranks the
            // user's own copy — the order Launch Services itself prefers.
            found.entry(name).or_insert_with(|| entry.path());
        }
    }
    found
}

/// Icons cost two spawns each, so they are read once per bundle path and held
/// for the life of the process. Keyed by path, so an app that moves is read
/// again rather than drawn with the old one.
#[cfg(target_os = "macos")]
static ICONS: LazyLock<Mutex<HashMap<PathBuf, Option<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The `.icns` a bundle names as its icon.
///
/// `CFBundleIconFile` may or may not carry the extension, so both spellings are
/// tried; `AppIcon` is the fallback for a bundle that names none.
#[cfg(target_os = "macos")]
fn icns_path(bundle: &Path) -> Option<PathBuf> {
    let resources = bundle.join("Contents/Resources");

    let named = Command::new("plutil")
        .args(["-extract", "CFBundleIconFile", "raw", "-o", "-"])
        .arg(bundle.join("Contents/Info.plist"))
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|name| !name.is_empty());

    named
        .into_iter()
        .chain(std::iter::once("AppIcon".to_string()))
        .flat_map(|name| {
            let with_ext = if name.ends_with(".icns") {
                name.clone()
            } else {
                format!("{name}.icns")
            };
            [resources.join(with_ext), resources.join(name)]
        })
        .find(|path| path.is_file())
}

/// The bundle's icon as a `data:` PNG, read through `sips` — on every mac, and
/// the only thing here that turns an `.icns` into something a webview draws.
#[cfg(target_os = "macos")]
fn read_icon(bundle: &Path) -> Option<String> {
    if let Ok(cache) = ICONS.lock() {
        if let Some(hit) = cache.get(bundle) {
            return hit.clone();
        }
    }

    let icon = icns_path(bundle).and_then(|icns| {
        // A temp file rather than stdout: `sips` writes the paths it worked on
        // to stdout and only ever writes the image to a path.
        let out = std::env::temp_dir().join(format!("dray-appicon-{}.png", uuid::Uuid::now_v7()));
        let ok = Command::new("sips")
            .args(["-s", "format", "png", "-Z", "64"])
            .arg(&icns)
            .arg("--out")
            .arg(&out)
            .output()
            .is_ok_and(|done| done.status.success());

        let bytes = ok.then(|| std::fs::read(&out).ok()).flatten();
        let _ = std::fs::remove_file(&out);

        bytes.map(|bytes| {
            use base64::Engine as _;
            format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )
        })
    });

    if let Ok(mut cache) = ICONS.lock() {
        cache.insert(bundle.to_path_buf(), icon.clone());
    }
    icon
}

/// Every known app in `installed`, in [`KNOWN`]'s order, then Finder — with no
/// icons yet. Split from [`detect`] so the order can be pinned by a test that
/// spawns nothing.
///
/// Finder sits at the end rather than the front on purpose: it is the entry
/// every machine has, so leading with it puts the least specific answer where
/// the eye lands first.
#[cfg(target_os = "macos")]
fn resolve(installed: &HashMap<String, PathBuf>, finder: &Path) -> Vec<ExternalApp> {
    let mut apps: Vec<ExternalApp> = KNOWN
        .iter()
        .filter_map(|known| {
            let path = installed.get(known.bundle)?;
            Some(ExternalApp {
                path: path.to_string_lossy().into_owned(),
                name: known.name.to_string(),
                kind: known.kind,
                icon: None,
            })
        })
        .collect();

    if finder.is_dir() {
        apps.push(ExternalApp {
            path: finder.to_string_lossy().into_owned(),
            name: "Finder".to_string(),
            kind: ExternalAppKind::Files,
            icon: None,
        });
    }

    apps
}

#[cfg(target_os = "macos")]
fn detect() -> Vec<ExternalApp> {
    let mut apps = resolve(&installed(&search_dirs()), Path::new(FINDER));
    for app in &mut apps {
        app.icon = read_icon(Path::new(&app.path));
    }
    apps
}

/// The apps that can open a path on this machine.
///
/// Re-scanned on every call rather than held for the process: the walk is a
/// handful of `read_dir`s, and only the icons are dear enough to cache — so an
/// editor installed while Dray is running shows up the next time the panel
/// asks, instead of needing a restart the way the slash-command cache does.
#[cfg_attr(feature = "desktop", tauri::command)]
#[cfg(windows)]
pub async fn list_open_apps() -> Vec<ExternalApp> {
    windows_apps()
}

#[cfg_attr(feature = "desktop", tauri::command)]
#[cfg(target_os = "macos")]
pub async fn list_open_apps() -> Vec<ExternalApp> {
    tokio::task::spawn_blocking(detect)
        .await
        .unwrap_or_default()
}

#[cfg_attr(feature = "desktop", tauri::command)]
#[cfg(not(any(windows, target_os = "macos")))]
pub async fn list_open_apps() -> Vec<ExternalApp> {
    Vec::new()
}

/// Hands `path` to the app at `app_path`.
///
/// `open -a <bundle> <path>` and not `open -b <id>`, for [`ExternalApp::path`]'s
/// reason. A directory or a file alike: `open -a` names the app outright, and
/// Launch Services hands it whichever the path is. Nothing here reaches a
/// shell, so injection is not the risk — but a path whose name opens with `-`
/// parses as a flag, which `--` ends.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn open_in_app(app_path: String, path: String, line: Option<u32>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let allowed = windows_apps().into_iter().any(|app| app.path == app_path);
        if !allowed {
            return Err("This application is no longer installed.".into());
        }
        let executable = Path::new(&app_path).file_name().and_then(|s| s.to_str()).unwrap_or_default().to_ascii_lowercase();
        let mut command = std::process::Command::new(&app_path);
        let directory = Path::new(&path).is_dir();
        // A terminal opens in a directory; handed a file, it opens at the one
        // holding it. Passing the file itself to cmd's `cd` or PowerShell's
        // `Set-Location` fails outright, and `wt -d <file>` is not a directory.
        let start = if directory {
            Some(path.as_str())
        } else {
            Path::new(&path).parent().and_then(|p| p.to_str()).filter(|p| !p.is_empty())
        };
        if executable == "wt.exe" {
            if let Some(start) = start {
                command.args(["-d", start]);
            }
        } else if is_windows_console_host(&executable) {
            // The console opens in the checkout the reader picked, so a `cd`
            // typed at its prompt is already in the right tree.
            if let Some(start) = start {
                command.current_dir(start);
            }
            match executable.as_str() {
                "powershell.exe" | "pwsh.exe" => {
                    if let Some(start) = start {
                        command.args(["-NoLogo", "-NoExit", "-Command"]);
                        command.arg(format!("Set-Location -LiteralPath '{}'", start.replace('\'', "''")));
                    }
                }
                "cmd.exe" => {
                    if let Some(start) = start {
                        command.args(["/K", "cd", "/d"]);
                        command.arg(start);
                    }
                }
                // Git Bash opens at its current directory; `--login` gives it
                // the reader's usual PATH.
                "bash.exe" => { command.args(["--login", "-i"]); }
                _ => { command.arg(&path); }
            }
        } else if is_windows_gui_terminal(&executable) {
            if let Some(start) = start {
                command.current_dir(start);
            }
        } else if let Some(args) = line.filter(|_| !directory).and_then(|line| windows_line_args(&executable, &path, line)) {
            command.args(args);
        } else {
            if directory {
                command.current_dir(&path);
            }
            command.arg(&path);
        }
        use std::os::windows::process::CommandExt;
        command.creation_flags(if is_windows_console_host(&executable) { 0x00000010 } else { 0x08000000 });
        return command.spawn().map(|_| ()).map_err(|e| format!("could not open the application: {e}"));
    }
    #[cfg(not(windows))]
    {
    let _ = line;
    let out = tokio::process::Command::new("open")
        .arg("-a")
        .arg(&app_path)
        .arg("--")
        .arg(&path)
        .output()
        .await
        .map_err(|err| format!("could not run open: {err}"))?;

    if out.status.success() {
        return Ok(());
    }

    // `open`'s own sentence names the cure — a moved bundle, a directory that
    // is gone — where the exit code names nothing.
    Err(crate::git::stderr_or(&out, || format!("could not open {path}")))
    }
}

#[cfg(windows)]
fn windows_apps() -> Vec<ExternalApp> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
    let programs = std::env::var_os("ProgramFiles").map(PathBuf::from).unwrap_or_default();
    let programs_x86 = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from).unwrap_or_default();
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let mut candidates = vec![
        (system.join("explorer.exe"), "File Explorer", ExternalAppKind::Files),
        (local.join(r"Programs\Microsoft VS Code\Code.exe"), "Visual Studio Code", ExternalAppKind::Editor),
        (programs.join(r"Microsoft VS Code\Code.exe"), "Visual Studio Code", ExternalAppKind::Editor),
        (local.join(r"Programs\Microsoft VS Code Insiders\Code - Insiders.exe"), "VS Code Insiders", ExternalAppKind::Editor),
        (local.join(r"Programs\cursor\Cursor.exe"), "Cursor", ExternalAppKind::Editor),
        (local.join(r"Programs\Windsurf\Windsurf.exe"), "Windsurf", ExternalAppKind::Editor),
        (local.join(r"Programs\Zed\zed.exe"), "Zed", ExternalAppKind::Editor),
        (programs.join(r"Sublime Text\sublime_text.exe"), "Sublime Text", ExternalAppKind::Editor),
        (programs.join(r"Sublime Text 3\sublime_text.exe"), "Sublime Text", ExternalAppKind::Editor),
        (programs.join(r"Notepad++\notepad++.exe"), "Notepad++", ExternalAppKind::Editor),
        (programs_x86.join(r"Notepad++\notepad++.exe"), "Notepad++", ExternalAppKind::Editor),
    ];
    // wt's execution alias is installed with Windows Terminal under this user's account.
    candidates.push((local.join(r"Microsoft\WindowsApps\wt.exe"), "Windows Terminal", ExternalAppKind::Terminal));
    candidates.push((programs.join(r"Windows Terminal\wt.exe"), "Windows Terminal", ExternalAppKind::Terminal));
    candidates.push((programs.join(r"PowerShell\7\pwsh.exe"), "PowerShell 7", ExternalAppKind::Terminal));
    candidates.push((system.join(r"System32\WindowsPowerShell\v1.0\powershell.exe"), "Windows PowerShell", ExternalAppKind::Terminal));
    candidates.push((system.join(r"System32\cmd.exe"), "Command Prompt", ExternalAppKind::Terminal));
    candidates.push((programs.join(r"Git\bin\bash.exe"), "Git Bash", ExternalAppKind::Terminal));
    candidates.push((local.join(r"Programs\Alacritty\alacritty.exe"), "Alacritty", ExternalAppKind::Terminal));
    candidates.push((programs.join(r"Alacritty\alacritty.exe"), "Alacritty", ExternalAppKind::Terminal));
    candidates.push((programs.join(r"WezTerm\wezterm-gui.exe"), "WezTerm", ExternalAppKind::Terminal));
    candidates.push((local.join(r"Programs\WezTerm\wezterm-gui.exe"), "WezTerm", ExternalAppKind::Terminal));
    let mut apps: Vec<ExternalApp> = candidates
        .into_iter()
        .filter(|(path, _, _)| path.is_file())
        .map(|(path, name, kind)| ExternalApp {
            path: path.to_string_lossy().into_owned(),
            name: name.to_string(),
            kind,
            icon: None,
        })
        .collect();
    // Toolbox keeps each product behind a channel and version directory, so
    // these are found by walking rather than by one guessed path.
    apps.extend(jetbrains_apps(&local).into_iter().filter(|(path, _)| path.is_file()).map(|(path, name)| ExternalApp {
        path: path.to_string_lossy().into_owned(),
        name,
        kind: ExternalAppKind::Editor,
        icon: None,
    }));
    // One entry per name: a per-user install and a machine-wide one of the
    // same editor would otherwise both sit in the picker.
    let mut names = std::collections::HashSet::new();
    apps.retain(|app| names.insert(app.name.clone()));
    apps
}

/// The launchers JetBrains Toolbox installed for this user, newest channel and
/// version per product. The product directory's own name is the label the
/// reader sees in the picker.
#[cfg(windows)]
fn jetbrains_apps(local: &Path) -> Vec<(PathBuf, String)> {
    let newest_dir = |dir: &Path| -> Option<PathBuf> {
        std::fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .max_by_key(|path| path.metadata().and_then(|meta| meta.modified()).ok())
    };
    let Ok(products) = std::fs::read_dir(local.join(r"JetBrains\Toolbox\apps")) else {
        return Vec::new();
    };
    products
        .flatten()
        .filter_map(|product| {
            let version = newest_dir(&newest_dir(&product.path())?)?;
            let exe = std::fs::read_dir(version.join("bin"))
                .ok()?
                .flatten()
                .map(|entry| entry.path())
                .find(|path| {
                    let name = path.file_name().and_then(|name| name.to_str()).map(str::to_ascii_lowercase);
                    name.is_some_and(|name| name.ends_with(".exe") && windows_line_args(&name, "", 0).is_some())
                })?;
            Some((exe, product.file_name().to_string_lossy().into_owned()))
        })
        .collect()
}

/// The console hosts that need their own window when opened from a GUI app.
#[cfg(windows)]
fn is_windows_console_host(executable: &str) -> bool {
    matches!(executable, "powershell.exe" | "pwsh.exe" | "cmd.exe" | "bash.exe")
}

/// Terminals that draw their own window and take the directory as a working
/// directory rather than as a command to run.
#[cfg(windows)]
fn is_windows_gui_terminal(executable: &str) -> bool {
    matches!(executable, "alacritty.exe" | "wezterm-gui.exe")
}

/// How to ask a Windows editor for a file at a line. `None` where the editor has
/// no documented argv for it, which opens the file at its first line instead.
#[cfg(windows)]
fn windows_line_args(executable: &str, path: &str, line: u32) -> Option<Vec<String>> {
    match executable {
        // The same flag `code --goto` gives every VS Code fork.
        "code.exe" | "code - insiders.exe" | "cursor.exe" | "windsurf.exe" => {
            Some(vec!["--goto".into(), format!("{path}:{line}")])
        }
        // Zed and Sublime accept the `path:line` form as their file argument.
        "zed.exe" | "subl.exe" | "sublime_text.exe" => Some(vec![format!("{path}:{line}")]),
        "notepad++.exe" => Some(vec![format!("-n{line}"), path.into()]),
        // JetBrains launchers, including Toolbox's per-product names.
        "idea64.exe" | "webstorm64.exe" | "pycharm64.exe" | "goland64.exe" | "rider64.exe"
        | "clion64.exe" | "phpstorm64.exe" | "rubymine64.exe" | "datagrip64.exe"
        | "rustrover64.exe" | "studio64.exe" => {
            Some(vec!["--line".into(), line.to_string(), path.into()])
        }
        _ => None,
    }
}

/// Writes the modifier that opens Dray Island (`control`, `option`, `command`)
/// into the island's own preferences, which it reads at every tap, and starts it
/// to match — or quits it, for `off`.
///
/// Its own defaults domain rather than `settings.json`, since the island is the
/// one that reads it. `open` without `-n` is a no-op for an island already up,
/// and it outlives Dray on purpose: it talks to the background server, which
/// does too — so the launch also pings it, and an island left on a binary an
/// update replaced restarts onto the new one. A build with no island inside it
/// (`tauri dev`) only writes the pick.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn configure_island(key: String) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Dray Island is available on macOS only.".into());
    }
    use tokio::process::Command;
    if !matches!(key.as_str(), "control" | "option" | "command" | "off") {
        return Err(format!("unknown island key {key}"));
    }
    async fn run(cmd: &mut Command) -> Result<std::process::Output, String> {
        cmd.output().await.map_err(|err| format!("could not configure the island: {err}"))
    }
    run(Command::new("defaults").args(["write", "com.yogesh.dray.island", "island.key", "-string", &key])).await?;
    if key == "off" {
        // Exit 1 is "nothing running", which is what was asked for.
        run(Command::new("pkill").args(["-x", "Dray Island"])).await?;
        return Ok(());
    }
    let Some(app) = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.parent()?.join("Helpers/Dray Island.app")))
        .filter(|app| app.exists())
    else {
        return Ok(());
    };
    let mut open = Command::new("open");
    open.arg("-g");
    // The island finds its server through the home, so a moved one must ride along.
    if let Some(home) = crate::store::home_override() {
        open.arg("--env").arg(format!("DRAY_HOME={}", home.display()));
    }
    let out = run(open.arg(&app)).await?;
    if out.status.success() {
        run(Command::new("notifyutil").args(["-p", "com.yogesh.dray.island.update"])).await?;
        return Ok(());
    }
    Err(crate::git::stderr_or(&out, || "could not start Dray Island".into()))
}

/// The session Dray's window has open, which the island opens on when tapped
/// over a frontmost Dray. Held here since the island asks through the server,
/// and the server can only ask the app's Rust side.
static APP_SELECTION: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// The frontend reports its selection on every change; `None` is no session open.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_app_selection(session_id: Option<String>) {
    *APP_SELECTION.lock().unwrap_or_else(|e| e.into_inner()) = session_id;
}

pub fn app_selection() -> Option<String> {
    APP_SELECTION.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Whether Dray Island is running, asked at each permission or question so a
/// island the reader quit never swallows the banner that would have replaced it.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn island_running() -> bool {
    tokio::process::Command::new("pgrep")
        .args(["-x", "Dray Island"])
        .output()
        .await
        .is_ok_and(|out| out.status.success())
}

/// Hands a finished session to Dray Island, which shows it in place of the
/// banner. A Darwin notification carries no payload, so each session is an
/// empty file named for it in `island_done_dir`: the island deletes only the
/// files it read, where a shared list read and then cleared would drop one
/// written between the two.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn island_done(session_id: String) -> Result<(), String> {
    // The id names a file, so nothing that could step out of the directory.
    if session_id.is_empty() || !session_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("not a session id".into());
    }
    let dir = island_done_dir().ok_or("no home directory")?;
    tokio::fs::create_dir_all(&dir).await.map_err(|err| format!("could not reach the island: {err}"))?;
    tokio::fs::write(dir.join(&session_id), b"").await.map_err(|err| format!("could not reach the island: {err}"))?;
    tokio::process::Command::new("notifyutil").args(["-p", "com.yogesh.dray.island.done"]).output().await.ok();
    Ok(())
}

/// The island's inbox for finished sessions; `Delegate.doneDir` in the island names it too.
fn island_done_dir() -> Option<std::path::PathBuf> {
    Some(std::env::home_dir()?.join("Library/Caches/com.yogesh.dray.island/done"))
}

/// The island preferences Settings draws. The island's own right-click menu
/// writes the first two as well, so they are read back rather than kept here,
/// and `captureTaken` is the island's alone: the chord it could not register.
const ISLAND_PREFS: [&str; 5] = ["island.placement", "island.mode", "island.tap", "island.captureKey", "island.captureTaken"];

fn island_pref_valid(name: &str, value: &str) -> bool {
    match name {
        "island.placement" => matches!(value, "notch" | "bottom"),
        "island.mode" => matches!(value, "compact" | "expanded"),
        "island.tap" => matches!(value, "single" | "double"),
        // A Carbon key code and modifier mask, or none.
        "island.captureKey" => {
            value == "none" || matches!(value.split_once(' '), Some((k, m)) if k.parse::<u32>().is_ok() && m.parse::<u32>().is_ok())
        }
        _ => false,
    }
}

/// The island's stored picks, by name; an absent one is the island's default.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn island_prefs() -> std::collections::HashMap<String, String> {
    let reads = ISLAND_PREFS.map(|name| async move {
        let out = tokio::process::Command::new("defaults")
            .args(["read", "com.yogesh.dray.island", name])
            .output()
            .await
            .ok()
            .filter(|out| out.status.success())?;
        Some((name.to_string(), String::from_utf8_lossy(&out.stdout).trim().to_string()))
    });
    futures_util::future::join_all(reads).await.into_iter().flatten().collect()
}

/// Writes one island pick and tells a running island to read it again, through a
/// Darwin notification: it caches the picks, and holds its capture key.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn set_island_pref(name: String, value: String) -> Result<(), String> {
    use tokio::process::Command;
    if !island_pref_valid(&name, &value) {
        return Err(format!("not an island setting: {name} = {value}"));
    }
    let out = Command::new("defaults")
        .args(["write", "com.yogesh.dray.island", &name, "-string", &value])
        .output()
        .await
        .map_err(|err| format!("could not save the island setting: {err}"))?;
    if !out.status.success() {
        return Err(crate::git::stderr_or(&out, || "could not save the island setting".into()));
    }
    // An island that is not running reads the file when it starts. Position and
    // layout are only judged on screen, so those open the panel to show them.
    let ping = match name.as_str() {
        "island.placement" | "island.mode" => "com.yogesh.dray.island.show",
        _ => "com.yogesh.dray.island.prefs",
    };
    Command::new("notifyutil").args(["-p", ping]).output().await.ok();
    Ok(())
}

#[cfg(test)]
mod island_pref_tests {
    use super::island_pref_valid;

    #[test]
    fn takes_only_what_the_island_can_read() {
        assert!(island_pref_valid("island.placement", "bottom"));
        assert!(island_pref_valid("island.captureKey", "19 768"));
        assert!(island_pref_valid("island.captureKey", "none"));
        assert!(!island_pref_valid("island.captureKey", "19"));
        assert!(!island_pref_valid("island.mode", "voice"));
        assert!(!island_pref_valid("island.tap", "triple"));
        assert!(!island_pref_valid("island.key", "control"));
    }
}

/// Terminal.app, and never the terminal the reader picked in the panel beside
/// this.
///
/// Measured, because `open` reports nothing either way: handed a `.command`
/// file, Terminal.app runs it, while Ghostty and Warp accept the open, exit 0
/// and run nothing at all. Ghostty wants `open -na <bundle> --args -e <cmd>`
/// and every other terminal its own argv, so honouring the pick means a second
/// table — and the [`KNOWN`] one above promises only `open -a <bundle> <dir>`,
/// which is a different shape from this. A button that silently does nothing
/// on two of the five terminals that table lists is worse than one that always
/// works, the same reading `pick_file_opener` takes with Finder.
///
/// Every mac has it, so there is no case where this resolves to nothing.
#[cfg(target_os = "macos")]
const TERMINAL: &str = "/System/Applications/Utilities/Terminal.app";

/// Opens a terminal at `cwd` running the harness's login command.
///
/// No shell string crosses the bridge: the caller names a [`Harness`] and the
/// command is composed here, from the resolved binary and
/// [`Harness::login_args`]. Same reading `permissions.rs` takes — the rule
/// never leaves Rust, so nothing the frontend holds can widen it.
///
/// The mechanism is a throwaway `.command` script rather than
/// `osascript -e 'tell application "Terminal" to do script …'`, which needs
/// macOS Automation permission: that prompts, can be denied, and a denial is
/// silent. A `.command` file needs no permission at all.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn open_login_terminal(harness: Harness, cwd: String) -> Result<(), String> {
    let binary = crate::binpath::agent_binary(harness).await;
    let mut command = sh_quote(&binary.to_string_lossy());
    for arg in harness.login_args() {
        command.push(' ');
        command.push_str(arg);
    }

    run_in_terminal(&command, &cwd).await
}

/// Runs one shell line in Terminal.app at `cwd`.
///
/// **The caller owns what is in that line**, and every one of them composes it
/// from a closed set — this harness's [`Harness::login_args`], or an
/// [`crate::accounts::AuthOption`] whose command is a literal in that table,
/// or an agent's own updater from `agent_updates::update_args`.
/// Nothing a frontend typed may reach here: the string is written into a shell
/// script, so the safety is in where it came from and not in any escaping this
/// could do to it.
pub(crate) async fn run_in_terminal(command: &str, cwd: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let bash = std::env::var_os("DRAY_BASH_PATH").map(PathBuf::from)
            .or_else(|| std::env::var_os("ProgramFiles").map(PathBuf::from).map(|p| p.join(r"Git\bin\bash.exe")).filter(|p| p.is_file()))
            .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from).map(|p| p.join(r"Programs\Git\bin\bash.exe")).filter(|p| p.is_file()))
            .or_else(|| std::env::home_dir().map(|p| p.join(r"scoop\apps\git\current\bin\bash.exe")).filter(|p| p.is_file()))
            .ok_or("Install Git for Windows to open agent sign-in and update commands.")?;
        let mut terminal = std::process::Command::new(bash);
        terminal.args(["--login", "-c", &format!("{command}; status=$?; printf '\\nPress Enter to close...'; read -r; exit \"$status\"")]);
        if !cwd.is_empty() { terminal.current_dir(cwd); }
        use std::os::windows::process::CommandExt;
        terminal.creation_flags(0x00000010);
        return terminal.spawn().map(|_| ()).map_err(|e| format!("could not open the terminal: {e}"));
    }
    #[cfg(not(windows))]
    {
    if !cfg!(target_os = "macos") {
        return Err("Opening a terminal is macOS only. Copy the command instead.".to_string());
    }

    // Terminal runs a `.command` from the reader's home, not from the script's
    // own directory, so the `cd` is what puts the login in the session's tree.
    // Omitted where there is no directory to name — the Accounts tab is reached
    // with no session selected — since `cd ''` fails and would take the command
    // with it. Self-delete last: a reader who closes the window mid-login leaks
    // one file into a temp dir macOS reaps on its own.
    let enter = if cwd.is_empty() {
        String::new()
    } else {
        format!("cd {} || exit 1\n", sh_quote(cwd))
    };
    let script = format!("#!/bin/sh\n{enter}{command}\nrm -f -- \"$0\"\n");

    let path = std::env::temp_dir().join(format!("dray-login-{}.command", uuid::Uuid::now_v7()));
    write_script(&path, &script)
        .map_err(|err| format!("could not write the login script: {err}"))?;

    let opened = open_in_app(TERMINAL.to_string(), path.to_string_lossy().into_owned(), None).await;
    if opened.is_err() {
        let _ = std::fs::remove_file(&path);
    }
    opened
    }
}

/// Writes the script at `0700` on the *create*, never by a `chmod` after.
///
/// Same reading the tracker key's own write records (`issues.rs`): `fs::write`
/// creates at the process umask, so any other order leaves a window where the
/// file is world-readable — and this one is also world-*executable*, which is a
/// file Terminal will run. `create_new` beside it because a leftover from a
/// crashed write could be somebody else's at whatever mode they chose. `0700`
/// is what makes it executable at all, which `.command` needs.
#[cfg(target_os = "macos")]
fn write_script(path: &Path, body: &str) -> std::io::Result<()> {
    use std::io::Write;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o700);

    options.open(path)?.write_all(body.as_bytes())
}

/// Quotes one word for `/bin/sh`.
///
/// The cwd is a real path from the index and can hold a space, a quote or a
/// dollar sign, and it is being written into a file that gets executed — so
/// single quotes, with the only character they cannot carry spliced in from
/// outside them.
pub(crate) fn sh_quote(word: &str) -> String {
    #[cfg(windows)]
    let normalized = if word.as_bytes().get(1) == Some(&b':') && !word.contains(';') {
        format!("/{}{}", word[..1].to_ascii_lowercase(), word[2..].replace('\\', "/"))
    } else { word.to_string() };
    #[cfg(windows)]
    let word = normalized.as_str();
    format!("'{}'", word.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The quoted word is written into a file that gets executed, so a cwd
    /// holding a quote must stay one argument rather than becoming a command.
    #[test]
    fn sh_quote_contains_a_quote() {
        assert_eq!(sh_quote("/tmp/plain"), "'/tmp/plain'");
        assert_eq!(sh_quote("/tmp/my project"), "'/tmp/my project'");
        assert_eq!(sh_quote("/tmp/$HOME"), "'/tmp/$HOME'");
        assert_eq!(sh_quote("/tmp/it's"), r"'/tmp/it'\''s'");
        assert_eq!(
            sh_quote("/tmp/a'; rm -rf /; echo '"),
            r"'/tmp/a'\''; rm -rf /; echo '\'''"
        );
    }

    /// The table is matched on exact file names, so an extension-less entry is
    /// one that can never be found and nothing else would say so.
    #[cfg(target_os = "macos")]
    #[test]
    fn every_known_bundle_names_an_app() {
        for known in KNOWN {
            assert!(
                known.bundle.ends_with(".app"),
                "{} is not a bundle name",
                known.bundle
            );
            assert!(!known.name.is_empty());
        }
    }

    /// Two entries resolving to one bundle would draw the same app twice.
    #[cfg(target_os = "macos")]
    #[test]
    fn known_bundles_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for known in KNOWN {
            assert!(seen.insert(known.bundle), "{} listed twice", known.bundle);
        }
    }

    #[cfg(target_os = "macos")]
    fn bundle(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    /// One scan over a directory of fake bundles pins the three things worth
    /// pinning: the match is exact (`Cloudflare WARP.app` is not `Warp.app`,
    /// and a substring match would list it as a terminal that ignores the
    /// directory it is handed), the order is the table's, and Finder comes
    /// last. Icons are not read, so nothing spawns.
    #[cfg(target_os = "macos")]
    #[test]
    fn resolves_in_table_order_with_finder_last() {
        let tmp = std::env::temp_dir().join(format!("dray-apps-{}", uuid::Uuid::now_v7()));
        let apps_dir = bundle(&tmp, "Applications");
        // Deliberately created in the order that would be wrong if read_dir
        // order leaked through.
        bundle(&apps_dir, "Ghostty.app");
        bundle(&apps_dir, "Cloudflare WARP.app");
        bundle(&apps_dir, "Cursor.app");
        bundle(&apps_dir, "Not An App");
        let finder = bundle(&tmp, "Finder.app");

        let found = resolve(&installed(&[apps_dir]), &finder);
        let names: Vec<&str> = found.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, ["Cursor", "Ghostty", "Finder"]);
        assert_eq!(found[2].kind, ExternalAppKind::Files);

        std::fs::remove_dir_all(&tmp).unwrap();
    }

    /// A bundle present in two searched directories resolves to the first —
    /// the machine-wide install over the user's own copy, matching Launch
    /// Services. A `HashMap` insert in the other order would silently flip it.
    #[cfg(target_os = "macos")]
    #[test]
    fn first_directory_wins() {
        let tmp = std::env::temp_dir().join(format!("dray-apps-{}", uuid::Uuid::now_v7()));
        let system = bundle(&tmp, "Applications");
        let user = bundle(&tmp, "home/Applications");
        let expected = bundle(&system, "Zed.app");
        bundle(&user, "Zed.app");

        let found = installed(&[system, user]);
        assert_eq!(found["Zed.app"], expected);

        std::fs::remove_dir_all(&tmp).unwrap();
    }

    /// What this machine actually resolves, printed rather than asserted:
    /// which apps are installed is a fact about the machine, so there is no
    /// count to pin. Kept because detection failing silently — an empty menu —
    /// is the one failure here that looks exactly like "nothing is installed".
    ///
    /// `cargo test -p dray --lib apps -- --ignored --nocapture`
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "reports what is installed; asserts nothing"]
    fn report_detected_apps() {
        report();
    }

    #[cfg(target_os = "macos")]
    fn report() {
        for app in detect() {
            println!(
                "{:?}\t{}\t{}\ticon={}",
                app.kind,
                app.name,
                app.path,
                app.icon.map_or("none".into(), |icon| format!("{}b", icon.len()))
            );
        }
    }
}
