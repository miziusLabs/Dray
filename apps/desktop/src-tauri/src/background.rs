//! A detached local server on platforms without launchd.
use anyhow::{Context, Result};
use std::sync::atomic::{AtomicBool, Ordering};
static STOPPED: AtomicBool = AtomicBool::new(false);

/// Starts a server independently of the app window. The server refuses duplicate instances.
pub async fn ensure() -> Result<()> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    if STOPPED.load(Ordering::Relaxed) {
        return Ok(());
    }
    let home = crate::store::get_home_app_dir().await?;
    if available(&home).await {
        return Ok(());
    }
    #[cfg(windows)]
    // The Run entry carries no `DRAY_HOME`, so it would start a server on the
    // default home while this app serves a custom one. Skip it there rather
    // than start two servers, one of which nothing connects to.
    if !crate::is_dev() && !cfg!(debug_assertions) && std::env::var_os("DRAY_HOME").is_none_or(|v| v.is_empty()) {
        if let Err(error) = register_login().await {
            eprintln!("[background] could not register login startup: {error:#}");
        }
    }
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if STOPPED.load(Ordering::Relaxed) || last.is_some_and(|at| at.elapsed() < Duration::from_secs(5)) {
        return Ok(());
    }
    *last = Some(Instant::now());
    let out = std::fs::OpenOptions::new().create(true).append(true).open(home.join(crate::serve::SERVER_LOG))?;
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command.arg("--serve").stdin(std::process::Stdio::null()).stdout(out.try_clone()?).stderr(out);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x00000008 | 0x00000200);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command.spawn().context("could not start the background server")?;
    Ok(())
}

pub fn reload_pending() -> bool { false }
pub async fn reload_if_pending() -> Result<()> { Ok(()) }

/// Lets a failed Windows updater restore the server it stopped before installing.
#[cfg(windows)]
pub async fn resume() -> Result<()> {
    STOPPED.store(false, Ordering::Relaxed);
    ensure().await
}

#[cfg(windows)]
async fn register_login() -> Result<()> {
    let exe = std::env::current_exe()?;
    let mut command = tokio::process::Command::new("reg.exe");
    command.args(["add", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", "Dray Server", "/t", "REG_SZ", "/d", &format!("\"{}\" --serve", exe.display()), "/f"]);
    command.creation_flags(0x08000000);
    let result = command.output().await?;
    anyhow::ensure!(result.status.success(), "could not register the background server for login");
    Ok(())
}

/// Stops the local server when the user also chooses to stop their sessions.
pub async fn stop() -> Result<()> {
    STOPPED.store(true, Ordering::Relaxed);
    let home = crate::store::get_home_app_dir().await?;
    if !available(&home).await {
        return Ok(());
    }
    crate::servers::server_invoke(crate::servers::LOCAL.into(), "stop_server".into(), serde_json::json!({}))
        .await.map_err(|e| anyhow::anyhow!("could not stop the background server: {e}"))?;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while available(&home).await {
        anyhow::ensure!(tokio::time::Instant::now() < deadline, "the background server did not stop");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    Ok(())
}

async fn available(home: &std::path::Path) -> bool {
    use futures_util::{SinkExt, StreamExt};
    let attempt = async {
        let written = tokio::fs::read_to_string(home.join(crate::serve::PORT_FILE)).await.ok()?;
        let port = written.lines().next()?.parse::<u16>().ok()?;
        let token = tokio::fs::read_to_string(home.join("serve-token")).await.ok()?;
        let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}")).await.ok()?;
        socket.send(tokio_tungstenite::tungstenite::Message::text(serde_json::json!({"v": 1, "token": token.trim()}).to_string())).await.ok()?;
        let response = socket.next().await?.ok()?;
        let hello: serde_json::Value = serde_json::from_str(response.to_text().ok()?).ok()?;
        let _ = socket.close(None).await;
        hello.get("err").is_none().then_some(())
    };
    matches!(tokio::time::timeout(std::time::Duration::from_secs(1), attempt).await, Ok(Some(())))
}
