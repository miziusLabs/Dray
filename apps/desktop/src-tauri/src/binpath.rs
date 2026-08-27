//! Finding agent binaries when the app wasn't launched from a shell.
//!
//! A bundled `.app` started from Finder or the Dock inherits `launchd`'s
//! minimal environment rather than the user's PATH. Resolve Pi once and reuse
//! it: the login-shell probe below costs real time, and the answer cannot
//! change while the app runs.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use tokio::process::Command;

static PI_PATH: OnceLock<PathBuf> = OnceLock::new();
static GH_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

/// The absolute path to `pi`, or the bare name as a last resort.
pub async fn pi() -> PathBuf {
    if let Some(path) = PI_PATH.get() {
        return path.clone();
    }

    let resolved = resolve("pi").await.unwrap_or_else(|| PathBuf::from("pi"));
    let _ = PI_PATH.set(resolved);
    PI_PATH
        .get()
        .cloned()
        .unwrap_or_else(|| PathBuf::from("pi"))
}

/// Reconstructs the PATH a child needs when the app was launched by Finder.
///
/// Bundled macOS apps inherit launchd's minimal PATH, which omits user-local
/// binaries used by Pi extensions and their child processes. Existing entries
/// stay first so an explicitly configured binary still wins.
pub fn agent_path() -> String {
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<_> = std::env::split_paths(&inherited).collect();

    for dir in known_dirs() {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }

    std::env::join_paths(dirs)
        .map(|joined| joined.to_string_lossy().into_owned())
        .unwrap_or_else(|_| inherited.to_string_lossy().into_owned())
}

/// The absolute path to `gh`, or `None` where it isn't installed.
///
/// `None` rather than a bare-name fallback: `gh` is optional
/// here, and the caller turns a missing one into a line telling the reader to
/// install it. A spawn error naming the binary would be the same fact worded as
/// a crash.
///
/// The answer is cached including its absence, so installing `gh` while the app
/// runs needs a restart — the same bargain the login-shell probe already makes.
pub async fn gh() -> Option<PathBuf> {
    if let Some(path) = GH_PATH.get() {
        return path.clone();
    }

    let resolved = resolve("gh").await;
    let _ = GH_PATH.set(resolved);
    GH_PATH.get().cloned().flatten()
}

/// Looks for `bin` on the inherited `PATH`, then in the usual install
/// locations, then by asking a login shell. Ordered by cost: the first two are
/// filesystem checks, the last spawns a shell that reads the user's rc files.
async fn resolve(bin: &str) -> Option<PathBuf> {
    if let Some(path) = search_path(bin) {
        return Some(path);
    }

    if let Some(path) = search_known_dirs(bin) {
        return Some(path);
    }

    login_shell_which(bin).await
}

/// Walks the `PATH` this process actually inherited. Covers `tauri dev` and any
/// launch from a terminal, where nothing further is needed.
fn search_path(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        executable_candidates(&dir, bin)
            .into_iter()
            .find(|candidate| is_executable(candidate))
    })
}

/// Where a user-installed CLI tends to land.
///
/// Public because the spawn needs them for the *other* direction: a child
/// inherits this process's `PATH`, and a bundled `.app` launched from Finder
/// inherits launchd's, which holds none of these. So a `dray` the user has
/// installed is invisible to the agent unless these are put back — the same
/// failure this module exists to solve for Pi, one layer out.
pub fn known_dirs() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };

    let mut dirs = vec![
        home.join(".local/bin"),
        home.join(".bun/bin"),
        home.join(".npm-global/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];

    // npm's per-user Windows prefix is where `npm install -g` puts command
    // launchers such as `pi.cmd`. A GUI app may not inherit the shell PATH,
    // so include it in both resolution and the child environment.
    #[cfg(windows)]
    if let Some(data_dir) = dirs::data_dir() {
        dirs.push(data_dir.join("npm"));
    }

    // Pi is commonly installed through npm under nvm. Those directories are
    // not stable enough to list statically, but they must be in a child's PATH
    // as well as in the resolver's search path because Pi is a Node script.
    if let Ok(versions) = std::fs::read_dir(home.join(".nvm/versions/node")) {
        dirs.extend(versions.flatten().map(|entry| entry.path().join("bin")));
    }

    dirs
}

/// The common install directories, checked directly so a bundle launch never
/// pays for a shell spawn. Not exhaustive by design
/// — [`login_shell_which`] is the general answer, this is the fast path.
fn search_known_dirs(bin: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let candidates = known_dirs();

    if let Some(found) = candidates.iter().find_map(|dir| {
        executable_candidates(dir, bin)
            .into_iter()
            .find(|candidate| is_executable(candidate))
    }) {
        return Some(found);
    }

    // nvm keeps one bin directory per installed Node version, so the path
    // depends on which version is current — glob the versions rather than
    // guessing one. `known_dirs` includes these on Unix, but retaining this
    // fallback keeps this lookup correct if that list changes later.
    #[cfg(not(windows))]
    {
        let versions = std::fs::read_dir(home.join(".nvm/versions/node")).ok()?;
        return versions.flatten().find_map(|entry| {
            let dir = entry.path().join("bin");
            executable_candidates(&dir, bin)
                .into_iter()
                .find(|candidate| is_executable(candidate))
        });
    }

    #[cfg(windows)]
    {
        let _ = home;
        None
    }
}

/// Returns paths a native process can launch for a command name.
///
/// Windows npm installs an extensionless shell script, a `.cmd` launcher, and
/// often a `.ps1` launcher together. `Command` cannot execute the shell or
/// PowerShell scripts directly, so the native extensions must be checked first
/// and the unusable files must never win resolution.
fn executable_candidates(dir: &Path, bin: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        [".exe", ".cmd", ".bat", ".com"]
            .into_iter()
            .map(|extension| dir.join(format!("{bin}{extension}")))
            .collect()
    }

    #[cfg(not(windows))]
    {
        vec![dir.join(bin)]
    }
}

/// Asks the user's login shell where `bin` is, which is the only way to see a
/// `PATH` built by rc files the app never sourced.
///
/// `-l` matters more than it looks: without it zsh reads `.zshrc` only, and a
/// `PATH` exported from `.zprofile` — where the installers write it — stays
/// invisible.
async fn login_shell_which(bin: &str) -> Option<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

    let output = Command::new(shell)
        .args(["-l", "-c", &format!("command -v {bin}")])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let line = String::from_utf8(output.stdout).ok()?;
    // `command -v` prints the name unchanged for a shell builtin or function,
    // which is not something we can spawn.
    let path = PathBuf::from(line.trim());
    is_executable(&path).then_some(path)
}

#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(path: &std::path::Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "exe" | "cmd" | "bat" | "com"
                )
            })
}

#[cfg(all(not(unix), not(windows)))]
fn is_executable(path: &std::path::Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pi is a Node entrypoint, so the same resolver must find it before a
    /// bundled app tries to spawn its shebang.
    #[tokio::test]
    async fn finds_the_pi_binary() {
        let Some(found) = resolve("pi").await else {
            eprintln!("pi not installed; skipping");
            return;
        };

        assert!(found.is_absolute(), "got a bare name: {found:?}");
        assert!(is_executable(&found));
    }

    /// A name that exists nowhere must resolve to nothing rather than to a
    /// path that fails only at spawn time.
    #[tokio::test]
    async fn a_missing_binary_resolves_to_none() {
        assert!(resolve("dray-definitely-not-a-real-binary").await.is_none());
    }

    #[test]
    fn a_directory_is_not_executable() {
        assert!(!is_executable(&PathBuf::from("/usr")));
    }
}
