//! `dray browser` on a server: Chrome for Testing's `chrome-headless-shell`,
//! one process per session, driven over the DevTools pipe. The verbs are
//! `automation.rs`, shared with the Mac; this module answers the functions it
//! reads and nothing else. See HEADLESS-PLAN.md.
//!
//! **The pipe, never a debugging port.** A port on localhost is open to every
//! account on the machine and a VPS is often shared, while DevTools reads
//! files and cookies and drives the page. `--remote-debugging-pipe` is fd 3
//! in and fd 4 out, NUL-delimited JSON, and only this process holds the ends.
//!
//! **Every tab arrives through `Target.attachedToTarget`.** Auto-attach is on
//! at the browser level with `flatten`, so one pipe carries every page under
//! its own CDP session, a popup included, and each is paused until its
//! domains are enabled — or its first load's events go by unseen.
//!
//! **Nothing is emitted.** A `browser_tabs` from here would reach the Mac's
//! frontend under the remote session's id, which is the key the Mac's *own*
//! tabs for that session are held under: the server's list would replace the
//! reader's strip.

#[path = "../browser/automation.rs"]
pub mod automation;
/// The reader-facing browser records its pages here too, so the URL bar's
/// suggestions and the empty state's recent list are not permanently empty.
#[cfg(windows)]
#[path = "../browser/history.rs"]
mod history;
#[path = "download.rs"]
mod download;

use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
#[cfg(unix)]
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::sync::oneshot;

/// One tab as `automation.rs` reads it.
pub struct TabInfo {
    pub id: i32,
    pub url: String,
    pub title: String,
    pub active: bool,
    pub loading: bool,
    pub discarded: bool,
}

/// One tab as the frontend's strip reads it. The Mac's CEF tabs carry more
/// (favicon, history arrows, an error line); a headless page has no favicon
/// and Dray's own pane draws none of the rest.
#[cfg(windows)]
fn tab_json(t: TabInfo) -> Value {
    json!({
        "id": t.id,
        "url": t.url,
        "title": t.title,
        "favicon": "",
        "loading": t.loading,
        "active": t.active,
        "canGoBack": false,
        "canGoForward": false,
        "error": Value::Null,
        "discarded": t.discarded,
    })
}

/// The Windows pane reads the same browser the agent drives, without a public debug port.
#[cfg(windows)]
pub async fn browser_view(session_id: String) -> Result<Value, String> {
    let tabs: Vec<Value> = tabs_of(&session_id).into_iter().map(tab_json).collect();
    let mut width = 1440;
    let mut height = 900;
    let image = if let Some(tab) = active_id(&session_id) {
        awake(tab).await?;
        touch(tab);
        if let Ok(metrics) = automation::cdp(tab, "Page.getLayoutMetrics", json!({})).await {
            width = metrics["cssLayoutViewport"]["clientWidth"].as_u64().unwrap_or(width);
            height = metrics["cssLayoutViewport"]["clientHeight"].as_u64().unwrap_or(height);
        }
        automation::cdp(tab, "Page.captureScreenshot", json!({ "format": "jpeg", "quality": 70, "captureBeyondViewport": false }))
            .await?["data"].as_str().map(str::to_string)
    } else { None };
    Ok(json!({ "tabs": tabs, "image": image, "width": width, "height": height }))
}

/// Limits page input to this session's active tab.
#[cfg(windows)]
pub async fn browser_input(session_id: String, action: Value) -> Result<Value, String> {
    match action["action"].as_str() {
        Some("pointer" | "wheel" | "text") => {
            let tab = active_id(&session_id).ok_or("no tab is open")?;
            awake(tab).await?;
            match action["action"].as_str().unwrap_or_default() {
                "pointer" => {
                    let x = action["x"].as_f64().filter(|x| x.is_finite()).ok_or("invalid pointer")?.clamp(0.0, 16384.0);
                    let y = action["y"].as_f64().filter(|y| y.is_finite()).ok_or("invalid pointer")?.clamp(0.0, 16384.0);
                    let button = match action["button"].as_str() {
                        Some("right") => "right",
                        Some("middle") => "middle",
                        _ => "left",
                    };
                    for kind in ["mousePressed", "mouseReleased"] {
                        automation::cdp(tab, "Input.dispatchMouseEvent", json!({ "type": kind, "x": x, "y": y, "button": button, "clickCount": 1 })).await?;
                    }
                }
                "wheel" => {
                    let delta = action["delta"].as_f64().filter(|x| x.is_finite()).ok_or("invalid scroll")?.clamp(-1800.0, 1800.0);
                    automation::cdp(tab, "Input.dispatchMouseEvent", json!({ "type": "mouseWheel", "x": 720, "y": 450, "deltaX": 0, "deltaY": delta })).await?;
                }
                _ => {
                    let text = action["text"].as_str().ok_or("missing text")?;
                    if text.len() > 1_000_000 { return Err("pasted text is too long".into()); }
                    automation::cdp(tab, "Input.insertText", json!({ "text": text })).await?;
                }
            }
            Ok(Value::Null)
        }
        _ => {
            let action: dray_proto::BrowserAction = serde_json::from_value(action).map_err(|e| e.to_string())?;
            automation::run(&session_id, action).await.map(|(_, result)| result)
        }
    }
}

/// The reader's tab strip and URL bar, over the browser this server owns. The
/// Mac answers these in the app because CEF draws there; on Windows Chromium
/// lives in the server, so the same commands belong here.
#[cfg(windows)]
pub async fn browser_open(session_id: String, url: String, new_tab: bool) -> Result<(), String> {
    open_url(&session_id, url, new_tab).await
}

/// The session's tabs, in strip order, shaped as the frontend's `BrowserTab`.
#[cfg(windows)]
pub fn browser_tabs(session_id: String) -> Vec<Value> {
    tabs_of(&session_id).into_iter().map(tab_json).collect()
}

#[cfg(windows)]
pub async fn browser_activate(session_id: String, id: i32) -> Result<(), String> {
    activate_tab(&session_id, id).await
}

#[cfg(windows)]
pub async fn browser_close(session_id: String, id: i32) -> Result<(), String> {
    close_tab(&session_id, id).await
}

#[cfg(windows)]
pub async fn browser_nav(session_id: String, action: String) -> Result<(), String> {
    nav(&session_id, &action).await
}

/// Moves `id` to place `to` among this session's tabs, leaving every other
/// session's where they are: `TABS` holds every session's in one list.
#[cfg(windows)]
pub fn browser_move(session_id: String, id: i32, to: usize) -> Vec<Value> {
    {
        let mut tabs = TABS.lock().unwrap();
        if let Some(from) = tabs.iter().position(|t| t.id == id && t.session == session_id) {
            let item = tabs.remove(from);
            let places: Vec<usize> = (0..tabs.len()).filter(|&i| tabs[i].session == session_id).collect();
            let at = match places.get(to) {
                Some(&i) => i,
                None => places.last().map_or(from, |&i| i + 1),
            };
            tabs.insert(at, item);
        }
    }
    browser_tabs(session_id)
}

/// The pages this session's browser visited, newest first — the same record the
/// Mac keeps beside a session's profile, written here as pages commit.
#[cfg(windows)]
pub fn browser_history(session_id: String) -> Vec<history::Visit> {
    history::list(&browser_dir(), &session_id)
}

#[cfg(windows)]
pub async fn chromium_status() -> Value { download::desktop_status().await }

#[cfg(windows)]
pub async fn chromium_download() -> Result<(), String> {
    let _ = download::binary().await;
    Ok(())
}

#[cfg(windows)]
pub async fn chromium_remove() -> Result<(), String> {
    if !CHROMES.lock().unwrap().is_empty() {
        return Err("Chromium is in use. Close its tabs and restart the server before removing it.".into());
    }
    download::remove_desktop().await
}

struct Tab {
    id: i32,
    session: String,
    /// The page target, once Chromium named one; `None` while discarded.
    target: Option<String>,
    /// The flattened CDP session the tab is driven through, from its attach.
    cdp: Option<String>,
    url: String,
    title: String,
    loading: bool,
    /// The address last filed in the session's history, so a tab reporting the
    /// same page twice — its attach, then a title change — counts one visit.
    recorded: String,
}

/// One session's Chromium.
struct Chrome {
    /// Minted per launch, so a reader outliving its process cannot touch the
    /// next one's tabs.
    generation: u64,
    out: mpsc::Sender<Vec<u8>>,
    _child: tokio::process::Child,
    /// Last driven, for the discard.
    seen: Instant,
    /// Tabs asked for and not yet attached, oldest first: an attach with no
    /// opener is the oldest of them.
    creating: VecDeque<i32>,
}

static TABS: Mutex<Vec<Tab>> = Mutex::new(Vec::new());
static ACTIVE: LazyLock<Mutex<HashMap<String, i32>>> = LazyLock::new(Default::default);
static CHROMES: LazyLock<Mutex<HashMap<String, Chrome>>> = LazyLock::new(Default::default);
static NEXT_TAB: AtomicI32 = AtomicI32::new(1);
static GENERATION: AtomicU64 = AtomicU64::new(1);
/// Ids of this module's own calls. `automation.rs` counts up from 1 under
/// the same pipe, so these start well clear of it and a reply is routed by
/// which side of the line its id falls.
const OWN: i32 = 1 << 30;
static NEXT_CALL: AtomicI32 = AtomicI32::new(OWN);
/// Each held with the generation it was written to, so a process exiting
/// fails its own calls and never a successor's.
static CALLS: LazyLock<Mutex<HashMap<i32, (u64, oneshot::Sender<Result<Value, String>>)>>> =
    LazyLock::new(Default::default);
/// One launch at a time, so two verbs arriving together start one Chromium.
static LAUNCH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
/// This machine's Chromium answered "No usable sandbox" once; see `launch`.
static NO_SANDBOX: AtomicBool = AtomicBool::new(false);

/// The Mac's `DEFAULT_VIEWPORT`, so `snapshot` and `click` read the laptop
/// layout a screenshot shows.
const WINDOW: &str = "--window-size=1440,900";
/// A session's browser unused this long is closed and its tabs kept by url.
/// The Mac's reason — one renderer reached 5.7GB in 20h — and a VPS has less.
const DISCARD_AFTER: Duration = Duration::from_secs(30 * 60);
const TIMEOUT: Duration = Duration::from_secs(30);

// --- What `dray browser` reads ----------------------------------------------

fn browser_dir() -> PathBuf {
    crate::store::home_override()
        .unwrap_or_else(|| std::env::home_dir().unwrap_or_default().join(".dray"))
        .join("browser")
}

fn tabs_of(session: &str) -> Vec<TabInfo> {
    let active = active_id(session);
    TABS.lock()
        .unwrap()
        .iter()
        .filter(|t| t.session == session)
        .map(|t| TabInfo {
            id: t.id,
            url: t.url.clone(),
            title: t.title.clone(),
            active: active == Some(t.id),
            loading: t.loading,
            discarded: t.target.is_none() && !t.loading,
        })
        .collect()
}

fn active_id(session: &str) -> Option<i32> {
    ACTIVE.lock().unwrap().get(session).copied()
}

fn set_active(session: &str, id: Option<i32>) {
    let mut active = ACTIVE.lock().unwrap();
    match id {
        Some(id) => active.insert(session.to_string(), id),
        None => active.remove(session),
    };
}

fn session_of(tab: i32) -> Option<String> {
    TABS.lock().unwrap().iter().find(|t| t.id == tab).map(|t| t.session.clone())
}

fn tab_state(tab: i32) -> Option<(String, String, bool)> {
    TABS.lock()
        .unwrap()
        .iter()
        .find(|t| t.id == tab)
        .map(|t| (t.url.clone(), t.title.clone(), t.loading))
}

fn touch(tab: i32) {
    if let Some(session) = session_of(tab) {
        if let Some(chrome) = CHROMES.lock().unwrap().get_mut(&session) {
            chrome.seen = Instant::now();
        }
    }
}

/// Reopens a discarded tab on its url under the same id, launching the
/// session's Chromium first where the discard took it, and waits for the page.
async fn awake(tab: i32) -> Result<(), String> {
    let Some((session, url, live)) = TABS
        .lock()
        .unwrap()
        .iter()
        .find(|t| t.id == tab)
        .map(|t| (t.session.clone(), t.url.clone(), t.cdp.is_some() || t.loading))
    else {
        return Err(format!("tab {tab} closed"));
    };
    if live && alive(&session) {
        return Ok(());
    }
    let url = if url.is_empty() { "about:blank".to_string() } else { url };
    create_tab(&session, &url, Some(tab)).await?;
    automation::wait_loaded(tab).await
}

fn send_cdp(tab: i32, _id: i32, mut message: Value) -> Result<(), String> {
    let (session, cdp) = TABS
        .lock()
        .unwrap()
        .iter()
        .find(|t| t.id == tab)
        .and_then(|t| Some((t.session.clone(), t.cdp.clone()?)))
        .ok_or("that tab is gone")?;
    message["sessionId"] = json!(cdp);
    write(&session, &message).map(|_| ()).map_err(|_| "that tab is gone".to_string())
}

async fn open_url(session: &str, url: String, new_tab: bool) -> Result<(), String> {
    if !new_tab {
        if let Some(tab) = active_id(session).filter(|&t| live(t)) {
            // An unreachable server still answers a page, Chromium's own
            // error page, as on the Mac; `errorText` is not a refusal.
            automation::cdp(tab, "Page.navigate", json!({ "url": url })).await?;
            return Ok(());
        }
    }
    let id = create_tab(session, &url, None).await?;
    set_active(session, Some(id));
    Ok(())
}

/// Back, forward, reload or stop, on the active tab.
async fn nav(session: &str, verb: &str) -> Result<(), String> {
    let tab = active_id(session).ok_or("no tab is open")?;
    match verb {
        "back" | "forward" => {
            let history = automation::cdp(tab, "Page.getNavigationHistory", json!({})).await?;
            let at = history["currentIndex"].as_i64().unwrap_or(0) + if verb == "back" { -1 } else { 1 };
            if let Some(entry) = usize::try_from(at).ok().and_then(|i| history["entries"].get(i)) {
                automation::cdp(tab, "Page.navigateToHistoryEntry", json!({ "entryId": entry["id"] })).await?;
            }
        }
        "stop" => {
            automation::cdp(tab, "Page.stopLoading", json!({})).await?;
        }
        "hard_reload" => {
            automation::cdp(tab, "Page.reload", json!({ "ignoreCache": true })).await?;
        }
        _ => {
            automation::cdp(tab, "Page.reload", json!({})).await?;
        }
    }
    Ok(())
}

async fn close_tab(session: &str, id: i32) -> Result<(), String> {
    let target = TABS
        .lock()
        .unwrap()
        .iter()
        .find(|t| t.id == id && t.session == session)
        .map(|t| t.target.clone())
        .ok_or_else(|| format!("no tab {id}"))?;
    remove_tab(session, id);
    if let Some(target) = target {
        let _ = call(session, None, "Target.closeTarget", json!({ "targetId": target })).await;
    }
    Ok(())
}

async fn activate_tab(session: &str, id: i32) -> Result<(), String> {
    if session_of(id).as_deref() == Some(session) {
        set_active(session, Some(id));
    }
    Ok(())
}

/// CSS `zoom` on the document. ponytail: resets on navigation, where the
/// Mac's level is kept per host; CDP exposes no browser zoom to set instead.
async fn set_zoom(tab: i32, percent: u32) -> Result<(), String> {
    let zoom = percent as f64 / 100.0;
    automation::eval(tab, &format!("document.documentElement.style.zoom = '{zoom}'; true")).await?;
    Ok(())
}

/// Nothing to bring out of hiding: focus is emulated from the attach, so
/// every page takes input as the focused one would.
async fn reveal_for_input(_tab: i32) -> Result<(), String> {
    Ok(())
}

fn relayout() -> Result<(), String> {
    Ok(())
}

/// No pane to cover. Still numbered, since a recording's number is what
/// `film` checks it is still running for.
async fn cover(_session: &str) -> u64 {
    static SHOT: AtomicU64 = AtomicU64::new(0);
    SHOT.fetch_add(1, Ordering::Relaxed) + 1
}

async fn uncover(_session: &str, _shot: u64) {}

fn emit(_event: &str, _payload: Value) {}

// --- The session's Chromium -------------------------------------------------

fn alive(session: &str) -> bool {
    CHROMES.lock().unwrap().contains_key(session)
}

fn live(tab: i32) -> bool {
    TABS.lock().unwrap().iter().any(|t| t.id == tab && t.cdp.is_some())
}

/// Writes one message to the session's Chromium and answers which launch of
/// it took the message.
fn write(session: &str, message: &Value) -> Result<u64, ()> {
    let mut bytes = serde_json::to_vec(message).map_err(|_| ())?;
    bytes.push(0);
    let chromes = CHROMES.lock().unwrap();
    let chrome = chromes.get(session).ok_or(())?;
    chrome.out.send(bytes).map_err(|_| ())?;
    Ok(chrome.generation)
}

/// One call of this module's own, answered through `CALLS`.
async fn call(session: &str, cdp: Option<&str>, method: &str, params: Value) -> Result<Value, String> {
    let id = NEXT_CALL.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    let mut message = json!({ "id": id, "method": method, "params": params });
    if let Some(cdp) = cdp {
        message["sessionId"] = json!(cdp);
    }
    // Filed before the write, under the launch it goes to, so neither a quick
    // reply nor a quick exit can land before the entry does.
    let generation = CHROMES.lock().unwrap().get(session).map(|c| c.generation);
    let Some(generation) = generation else { return Err("Chromium is not running".into()) };
    CALLS.lock().unwrap().insert(id, (generation, tx));
    if write(session, &message).is_err() {
        CALLS.lock().unwrap().remove(&id);
        return Err("Chromium is not running".into());
    }
    match tokio::time::timeout(TIMEOUT, rx).await {
        Ok(Ok(reply)) => reply,
        Ok(Err(_)) => Err("Chromium exited before answering".into()),
        Err(_) => {
            CALLS.lock().unwrap().remove(&id);
            Err(format!("{method} timed out after {}s", TIMEOUT.as_secs()))
        }
    }
}

/// A call whose answer nobody reads — sent from the reader thread, which
/// cannot wait on one.
fn fire(session: &str, cdp: &str, method: &str, params: Value) {
    let id = NEXT_CALL.fetch_add(1, Ordering::Relaxed);
    let _ = write(session, &json!({ "id": id, "sessionId": cdp, "method": method, "params": params }));
}

/// Asks the session's Chromium for a page at `url`, as tab `id` when waking a
/// discarded one. The tab is listed at once, loading, so `new_tab` finds it
/// and `wait_loaded` waits for its page; the attach fills in the rest.
async fn create_tab(session: &str, url: &str, id: Option<i32>) -> Result<i32, String> {
    chrome_for(session).await?;
    let id = id.unwrap_or_else(|| NEXT_TAB.fetch_add(1, Ordering::SeqCst));
    {
        let mut tabs = TABS.lock().unwrap();
        match tabs.iter_mut().find(|t| t.id == id) {
            Some(t) => {
                t.loading = true;
                t.target = None;
                t.cdp = None;
            }
            None => tabs.push(Tab {
                id,
                session: session.to_string(),
                target: None,
                cdp: None,
                url: url.to_string(),
                title: String::new(),
                loading: true,
                recorded: String::new(),
            }),
        }
    }
    if let Some(chrome) = CHROMES.lock().unwrap().get_mut(session) {
        chrome.creating.push_back(id);
    }
    match call(session, None, "Target.createTarget", json!({ "url": url })).await {
        Ok(reply) => {
            let target = reply["targetId"].as_str().unwrap_or_default().to_string();
            if let Some(t) = TABS.lock().unwrap().iter_mut().find(|t| t.id == id) {
                t.target.get_or_insert(target);
            }
            Ok(id)
        }
        Err(e) => {
            if let Some(chrome) = CHROMES.lock().unwrap().get_mut(session) {
                chrome.creating.retain(|&c| c != id);
            }
            if let Some(t) = TABS.lock().unwrap().iter_mut().find(|t| t.id == id) {
                t.loading = false;
            }
            Err(format!("Chromium did not open a tab: {e}"))
        }
    }
}

/// Takes a tab's entry out. The active tab passes to the last one left, the
/// Mac's rule.
fn remove_tab(session: &str, id: i32) {
    let remaining = {
        let mut tabs = TABS.lock().unwrap();
        tabs.retain(|t| t.id != id);
        tabs.iter().rev().find(|t| t.session == session).map(|t| t.id)
    };
    if active_id(session) == Some(id) {
        set_active(session, remaining);
    }
    automation::forget(id);
}

/// The session's Chromium, launched if it is not running.
async fn chrome_for(session: &str) -> Result<(), String> {
    if alive(session) {
        return Ok(());
    }
    // The id names the profile directory.
    if session.is_empty() || !session.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err(format!("{session:?} is not a session id"));
    }
    let _held = LAUNCH.lock().await;
    if alive(session) {
        return Ok(());
    }
    let exe = download::binary().await?;
    preflight(&exe).await?;
    start_sweep();
    // Chromium refuses to run as root with its sandbox, and a non-root user on
    // Ubuntu 23.10+ is refused the user namespaces it needs by AppArmor —
    // both measured on a real VPS. So the sandbox is tried where it can work
    // and dropped, once and for the life of the process, where Chromium says
    // it cannot. Without it a renderer exploit runs as this server's user,
    // which is what the agent's own shell already is.
    #[cfg(unix)]
    let root = unsafe { libc::geteuid() } == 0;
    #[cfg(not(unix))]
    let root = false;
    let sandboxed = !root && !NO_SANDBOX.load(Ordering::Relaxed);
    match launch(session, &exe, sandboxed).await {
        Err(e) if sandboxed && e.contains("No usable sandbox") => {
            eprintln!("[headless] Chromium has no usable sandbox here; running it without one");
            NO_SANDBOX.store(true, Ordering::Relaxed);
            launch(session, &exe, false).await
        }
        other => other,
    }
}

async fn launch(session: &str, exe: &Path, sandboxed: bool) -> Result<(), String> {
    let profile = browser_dir().join(session);
    std::fs::create_dir_all(&profile).map_err(|e| format!("could not create {}: {e}", profile.display()))?;
    let (to_chrome, chrome_reads) = {
        let (r, w) = std::io::pipe().map_err(|e| e.to_string())?;
        (w, r)
    };
    let (chrome_writes, from_chrome) = {
        let (r, w) = std::io::pipe().map_err(|e| e.to_string())?;
        (w, r)
    };
    #[cfg(unix)]
    let (read_fd, write_fd) = (chrome_reads.as_raw_fd(), chrome_writes.as_raw_fd());
    let mut command = tokio::process::Command::new(exe);
    command
        .arg("--remote-debugging-pipe")
        .arg(format!("--user-data-dir={}", profile.display()))
        .args([WINDOW, "--no-first-run", "--no-default-browser-check", "--mute-audio"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if !sandboxed {
        command.arg("--no-sandbox");
    }
    // fd 3 is what Chromium reads, fd 4 what it writes. Copied clear of 3 and
    // 4 first, since either end may already sit on one of them; the copies
    // are close-on-exec and the dup2'd pair is not.
    #[cfg(unix)]
    unsafe {
        command.pre_exec(move || {
            let r = libc::fcntl(read_fd, libc::F_DUPFD_CLOEXEC, 10);
            let w = libc::fcntl(write_fd, libc::F_DUPFD_CLOEXEC, 10);
            if r < 0 || w < 0 || libc::dup2(r, 3) < 0 || libc::dup2(w, 4) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    #[cfg(windows)]
    let inherited = windows_pipes(&mut command, &chrome_reads, &chrome_writes)?;
    let mut child = command.spawn().map_err(|e| format!("could not start Chromium: {e}"))?;
    #[cfg(windows)]
    drop(inherited);
    drop((chrome_reads, chrome_writes));

    let stderr = Arc::new(Mutex::new(String::new()));
    if let Some(mut pipe) = child.stderr.take() {
        let stderr = stderr.clone();
        tokio::spawn(async move {
            let mut chunk = [0u8; 2048];
            while let Ok(n @ 1..) = pipe.read(&mut chunk).await {
                let mut said = stderr.lock().unwrap();
                said.push_str(&String::from_utf8_lossy(&chunk[..n]));
                if said.len() > 16384 {
                    let cut = said.len() - 8192;
                    let cut = (cut..said.len()).find(|&i| said.is_char_boundary(i)).unwrap_or(0);
                    said.drain(..cut);
                }
            }
        });
    }

    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
    let (out, outgoing) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut pipe = to_chrome;
        for message in outgoing {
            if pipe.write_all(&message).is_err() {
                break;
            }
        }
    });
    {
        let owner = session.to_string();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(from_chrome);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(0, &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        if buf.last() == Some(&0) {
                            buf.pop();
                        }
                        if let Ok(message) = serde_json::from_slice::<Value>(&buf) {
                            dispatch(&owner, &message);
                        }
                    }
                }
            }
            gone(&owner, generation);
        });
    }
    CHROMES.lock().unwrap().insert(
        session.to_string(),
        Chrome { generation, out, _child: child, seen: Instant::now(), creating: VecDeque::new() },
    );

    let ready = async {
        call(session, None, "Browser.getVersion", json!({})).await?;
        // A page Chromium opened on its own would attach as a tab nobody
        // asked for.
        let targets = call(session, None, "Target.getTargets", json!({})).await?;
        for t in targets["targetInfos"].as_array().into_iter().flatten().filter(|t| t["type"] == "page") {
            call(session, None, "Target.closeTarget", json!({ "targetId": t["targetId"] })).await?;
        }
        call(session, None, "Target.setDiscoverTargets", json!({ "discover": true })).await?;
        call(
            session,
            None,
            "Target.setAutoAttach",
            json!({ "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true }),
        )
        .await
    }
    .await;
    if let Err(e) = ready {
        CHROMES.lock().unwrap().remove(session);
        // The stderr reader may still hold the last chunk.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let said = stderr.lock().unwrap().clone();
        let why = said
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .find(|l| l.contains("FATAL") || l.contains("ERROR") || l.contains("error while loading"))
            .or_else(|| said.lines().map(str::trim).filter(|l| !l.is_empty()).last())
            .map(str::to_string)
            .unwrap_or(e);
        return Err(format!("Chromium did not start: {why}"));
    }
    Ok(())
}

/// Chromium adopts these pipe handles on Windows instead of Unix descriptors 3 and 4.
#[cfg(windows)]
fn windows_pipes(
    command: &mut tokio::process::Command,
    reads: &std::io::PipeReader,
    writes: &std::io::PipeWriter,
) -> Result<InheritedPipes, String> {
    use std::os::windows::io::AsRawHandle;
    let handles = [reads.as_raw_handle() as usize, writes.as_raw_handle() as usize];
    let inherited = InheritedPipes(handles);
    for handle in handles {
        if unsafe { SetHandleInformation(handle as *mut _, 1, 1) } == 0 {
            return Err(format!("could not share Chromium's pipe: {}", std::io::Error::last_os_error()));
        }
    }
    command.arg(format!("--remote-debugging-io-pipes={},{}", handles[0], handles[1]));
    command.creation_flags(0x08000000);
    Ok(inherited)
}

#[cfg(windows)]
struct InheritedPipes([usize; 2]);

#[cfg(windows)]
impl Drop for InheritedPipes {
    fn drop(&mut self) {
        for handle in self.0 {
            unsafe { SetHandleInformation(handle as *mut _, 1, 0); }
        }
    }
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn SetHandleInformation(handle: *mut std::ffi::c_void, mask: u32, flags: u32) -> i32;
}

/// The reader reached the end of the pipe: Chromium exited. Its tabs are kept
/// as discarded, so a crash costs the page state and nothing an agent holds an
/// id to. A process already replaced or closed is left alone.
fn gone(session: &str, generation: u64) {
    let ours = {
        let mut chromes = CHROMES.lock().unwrap();
        let ours = chromes.get(session).is_some_and(|c| c.generation == generation);
        if ours {
            chromes.remove(session);
        }
        ours
    };
    if ours {
        eprintln!("[headless] Chromium for {session} exited");
        discard_tabs(session);
        // As a tab closing would: a recording stops filming a page that is
        // gone and keeps its frames for `record stop`.
        for id in tabs_of(session).iter().map(|t| t.id) {
            automation::forget(id);
        }
    }
    let mut calls = CALLS.lock().unwrap();
    let dead: Vec<i32> = calls.iter().filter(|(_, (g, _))| *g == generation).map(|(id, _)| *id).collect();
    for id in dead {
        if let Some((_, tx)) = calls.remove(&id) {
            let _ = tx.send(Err("Chromium exited".into()));
        }
    }
}

fn discard_tabs(session: &str) {
    for t in TABS.lock().unwrap().iter_mut().filter(|t| t.session == session) {
        t.target = None;
        t.cdp = None;
        t.loading = false;
    }
}

/// One message off the pipe. A reply goes to whoever asked; an event updates
/// the tab it names.
fn dispatch(session: &str, message: &Value) {
    if let Some(id) = message["id"].as_i64() {
        let id = id as i32;
        let reply = match message.get("error") {
            Some(e) => Err(e["message"].as_str().unwrap_or("the page refused the command").to_string()),
            None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
        };
        if id >= OWN {
            if let Some((_, tx)) = CALLS.lock().unwrap().remove(&id) {
                let _ = tx.send(reply);
            } else if let Ok(result) = reply {
                retitle(&result["targetInfo"]);
            }
        } else if let Some(tab) = message["sessionId"].as_str().and_then(tab_by_cdp) {
            automation::answer(tab, id, reply);
        }
        return;
    }
    let params = &message["params"];
    let tab = message["sessionId"].as_str().and_then(tab_by_cdp);
    match message["method"].as_str().unwrap_or_default() {
        "Target.attachedToTarget" => attached(session, params),
        "Target.targetInfoChanged" => retitle(&params["targetInfo"]),
        // The page closed itself: `window.close()`, a popup done with OAuth.
        "Target.targetDestroyed" => {
            let target = params["targetId"].as_str();
            let id = TABS.lock().unwrap().iter().find(|t| t.target.as_deref() == target && t.cdp.is_some()).map(|t| t.id);
            if let Some(id) = id {
                remove_tab(session, id);
            }
        }
        // The main frame's id is its target's.
        "Page.frameStartedLoading" | "Page.frameStoppedLoading" | "Page.loadEventFired" => {
            let started = message["method"] == "Page.frameStartedLoading";
            let frame = params["frameId"].as_str();
            let target = {
                let mut tabs = TABS.lock().unwrap();
                let Some(t) = tabs.iter_mut().find(|t| Some(t.id) == tab) else { return };
                if frame.is_some() && frame != t.target.as_deref() {
                    return;
                }
                t.loading = started;
                t.target.clone()
            };
            // `targetInfoChanged` lands as the navigation commits, before the
            // page has a `<title>`, and nothing announces one later — so it is
            // asked for once the page has loaded, the reply read in the `id`
            // arm above.
            if message["method"] == "Page.loadEventFired" {
                if let Some(target) = target {
                    let id = NEXT_CALL.fetch_add(1, Ordering::Relaxed);
                    let _ = write(session, &json!({ "id": id, "method": "Target.getTargetInfo", "params": { "targetId": target } }));
                }
            }
        }
        "Runtime.consoleAPICalled" => {
            let Some(tab) = tab else { return };
            let text = params["args"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|a| match &a["value"] {
                    Value::String(s) => s.clone(),
                    Value::Null => a["description"].as_str().unwrap_or("undefined").to_string(),
                    v => v.to_string(),
                })
                .collect::<Vec<_>>()
                .join(" ");
            let error = matches!(params["type"].as_str(), Some("error" | "assert"));
            automation::log(tab, error, text);
        }
        "Runtime.exceptionThrown" => {
            let Some(tab) = tab else { return };
            let details = &params["exceptionDetails"];
            let text = details["exception"]["description"]
                .as_str()
                .or_else(|| details["text"].as_str())
                .unwrap_or("uncaught exception");
            automation::log(tab, true, text.to_string());
        }
        // An open dialog blocks every `Runtime.evaluate` until answered, and
        // nobody is there to answer it.
        "Page.javascriptDialogOpening" => {
            let (Some(tab), Some(cdp)) = (tab, message["sessionId"].as_str()) else { return };
            let kind = params["type"].as_str().unwrap_or("dialog");
            automation::log(tab, false, format!("[{kind}] {} (accepted)", params["message"].as_str().unwrap_or("")));
            fire(session, cdp, "Page.handleJavaScriptDialog", json!({ "accept": true, "promptText": params["defaultPrompt"] }));
        }
        _ => {}
    }
}

/// A target's url and title onto the tab showing it.
fn retitle(info: &Value) {
    let Some(target) = info["targetId"].as_str() else { return };
    let Some(mut tabs) = TABS.lock().ok() else { return };
    if let Some(t) = tabs.iter_mut().find(|t| t.target.as_deref() == Some(target)) {
        t.url = info["url"].as_str().unwrap_or_default().to_string();
        t.title = info["title"].as_str().unwrap_or_default().to_string();
        record_visit(t);
        history::describe(&browser_dir(), &t.session, &t.url, Some(&t.title), None);
    }
}

/// Files the tab's current address in its session's history, once per address.
fn record_visit(tab: &mut Tab) {
    if tab.url.is_empty() || tab.recorded == tab.url {
        return;
    }
    tab.recorded = tab.url.clone();
    history::visit(&browser_dir(), &tab.session, &tab.url);
}

fn tab_by_cdp(cdp: &str) -> Option<i32> {
    TABS.lock().unwrap().iter().find(|t| t.cdp.as_deref() == Some(cdp)).map(|t| t.id)
}

/// A target paused on its start: a page is filed as a tab — the one asked for,
/// or a popup of its own — its domains enabled, and it is let go.
fn attached(session: &str, params: &Value) {
    let Some(cdp) = params["sessionId"].as_str() else { return };
    let info = &params["targetInfo"];
    if info["type"] != "page" {
        fire(session, cdp, "Runtime.runIfWaitingForDebugger", json!({}));
        return;
    }
    let target = info["targetId"].as_str().unwrap_or_default().to_string();
    let popup = info["openerId"].as_str().is_some();
    let id = {
        let mut chromes = CHROMES.lock().unwrap();
        let creating = chromes.get_mut(session).map(|c| &mut c.creating);
        let mut tabs = TABS.lock().unwrap();
        let known = tabs.iter().find(|t| t.target.as_deref() == Some(target.as_str())).map(|t| t.id);
        let id = match (known, creating) {
            (Some(id), Some(creating)) => {
                creating.retain(|&c| c != id);
                Some(id)
            }
            (Some(id), None) => Some(id),
            (None, Some(creating)) if !popup => creating.pop_front(),
            _ => None,
        };
        let id = id.unwrap_or_else(|| {
            let id = NEXT_TAB.fetch_add(1, Ordering::SeqCst);
            tabs.push(Tab {
                id,
                session: session.to_string(),
                target: None,
                cdp: None,
                url: String::new(),
                title: String::new(),
                loading: true,
                recorded: String::new(),
            });
            id
        });
        if let Some(t) = tabs.iter_mut().find(|t| t.id == id) {
            t.target = Some(target);
            t.cdp = Some(cdp.to_string());
            t.url = info["url"].as_str().unwrap_or_default().to_string();
            t.title = info["title"].as_str().unwrap_or_default().to_string();
            record_visit(t);
        }
        popup.then_some(id)
    };
    // A popup is the tab the page just opened, as on the Mac.
    if let Some(id) = id {
        set_active(session, Some(id));
    }
    for (method, params) in [
        ("Page.enable", json!({})),
        ("Runtime.enable", json!({})),
        ("Emulation.setFocusEmulationEnabled", json!({ "enabled": true })),
        ("Runtime.runIfWaitingForDebugger", json!({})),
    ] {
        fire(session, cdp, method, params);
    }
}

/// Before the first launch: whether this machine can run Chromium at all, so
/// the agent reads which libraries are missing rather than a crash. `ldd`
/// names every missing library where Chromium's loader names the first; with
/// no fontconfig config Chromium aborts on its first page instead.
async fn preflight(exe: &Path) -> Result<(), String> {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    static PASSED: AtomicBool = AtomicBool::new(false);
    if PASSED.load(Ordering::Relaxed) {
        return Ok(());
    }
    let mut missing: Vec<String> = match tokio::process::Command::new("ldd").arg(exe).output().await {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|l| l.contains("not found"))
            .filter_map(|l| l.split_whitespace().next().map(str::to_string))
            .collect(),
        // No `ldd` to ask: Chromium's own loader error will have to do.
        Err(_) => Vec::new(),
    };
    if !Path::new("/etc/fonts/fonts.conf").exists() {
        missing.push("fontconfig".into());
    }
    if missing.is_empty() {
        PASSED.store(true, Ordering::Relaxed);
        return Ok(());
    }
    Err(format!(
        "Chromium needs system libraries this server lacks ({}). Run `dray setup` there and pick \
         Browser for agents, then try again.",
        missing.join(", ")
    ))
}

/// Every minute, closes the Chromium of each session unused for
/// `DISCARD_AFTER`. Not while recording, being driven or mid-screenshot.
fn start_sweep() {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    crate::spawn(async {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            if automation::capturing() {
                continue;
            }
            let idle: Vec<String> = CHROMES
                .lock()
                .unwrap()
                .iter()
                .filter(|(_, c)| c.seen.elapsed() >= DISCARD_AFTER)
                .map(|(s, _)| s.clone())
                .collect();
            for session in idle {
                let recording = tabs_of(&session).iter().any(|t| automation::parked(t.id).is_some());
                if recording || automation::driving(&session) {
                    continue;
                }
                eprintln!("[headless] closing Chromium for {session}, unused for {}m", DISCARD_AFTER.as_secs() / 60);
                CHROMES.lock().unwrap().remove(&session);
                discard_tabs(&session);
            }
        }
    });
}

/// Closes a session's Chromium and forgets its tabs, for settle and delete.
pub fn close_session(session: &str) {
    automation::drop_recording(session);
    history::forget(&browser_dir(), session);
    CHROMES.lock().unwrap().remove(session);
    let ids: Vec<i32> = TABS.lock().unwrap().iter().filter(|t| t.session == session).map(|t| t.id).collect();
    TABS.lock().unwrap().retain(|t| t.session != session);
    for id in ids {
        automation::forget(id);
    }
    set_active(session, None);
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    /// Exercises inherited Windows handles against Chromium, not a mocked CDP reply.
    #[tokio::test]
    #[ignore = "downloads Chromium and starts a real browser"]
    async fn windows_browser_pipe_and_input() {
        let temp = std::env::temp_dir().join(format!("dray-browser-{}", uuid::Uuid::new_v4()));
        std::env::set_var("DRAY_HOME", &temp);
        let deadline = Instant::now() + Duration::from_secs(180);
        while download::binary().await.is_err() {
            assert!(Instant::now() < deadline, "Chromium download did not finish");
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        let session = uuid::Uuid::new_v4().to_string();
        open_url(&session, "about:blank".into(), true).await.unwrap();
        let tab = active_id(&session).unwrap();
        automation::wait_loaded(tab).await.unwrap();
        automation::cdp(tab, "Runtime.evaluate", json!({"expression": "document.body.innerHTML='<input autofocus>'; document.querySelector('input').focus()"})).await.unwrap();
        browser_input(session.clone(), json!({"action":"text", "text":"Windows pipe works"})).await.unwrap();
        let result = automation::cdp(tab, "Runtime.evaluate", json!({"expression":"document.querySelector('input').value", "returnByValue":true})).await.unwrap();
        assert_eq!(result["result"]["value"], "Windows pipe works");
        let view = browser_view(session.clone()).await.unwrap();
        assert!(!view["image"].as_str().unwrap().is_empty());
        assert_eq!(view["tabs"].as_array().unwrap().len(), 1);
        close_session(&session);
        std::env::remove_var("DRAY_HOME");
        let _ = tokio::fs::remove_dir_all(temp).await;
    }
}
