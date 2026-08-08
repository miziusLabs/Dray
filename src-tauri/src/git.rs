use anyhow::{bail, Result};
use serde::Serialize;
use tokio::process::Command;
use ts_rs::TS;

/// What the composer's branch picker needs to render and guard itself.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    /// `None` on a detached HEAD, and for a directory that isn't a repo.
    pub current: Option<String>,
    pub branches: Vec<String>,
    /// What a `-w` worktree forks from, resolved the way the CLI resolves it.
    /// Shown in place of the branch picker in worktree mode, where the picked
    /// branch has no effect. `None` when the repo has no remote.
    pub default_base: Option<String>,
    /// Uncommitted changes, counted for the switch dialog's "you have N
    /// changes". Zero switches without asking.
    pub dirty: u32,
}

/// Runs git in `cwd` and returns stdout, or `None` on any non-zero exit.
/// A missing binary or a non-repo directory is a normal outcome here, not an
/// error worth propagating — see [`list_branches`].
async fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        // A branch poll shouldn't contend with a background index refresh.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .await
        .ok()?;

    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Local branches, the current one, and whether the tree is dirty.
///
/// A directory that isn't a repo reads as an empty list rather than an error:
/// the user is allowed to attach any folder, and the picker hides itself when
/// there are no branches.
pub async fn list_branches(cwd: &str) -> Result<BranchList> {
    // `for-each-ref` is plumbing; `git branch` decorates the current entry with
    // `* ` and can paginate or colorize depending on the user's config.
    let Some(raw) = git(
        cwd,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )
    .await
    else {
        return Ok(BranchList::default());
    };

    let current = git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .map(|s| s.trim().to_string())
        // Detached HEAD reports the literal string rather than a branch name.
        .filter(|s| !s.is_empty() && s != "HEAD");

    let dirty = git(cwd, &["status", "--porcelain"])
        .await
        .map_or(0, |s| count_changes(&s));

    Ok(BranchList {
        current,
        branches: parse_branches(&raw),
        default_base: default_base(cwd).await,
        dirty,
    })
}

/// The ref a `-w` worktree forks from. Mirrors the CLI's own resolution, which
/// reads `origin/HEAD` and falls back through `origin/main` then `origin/master`
/// — so the composer names the same commit the CLI will actually use.
///
/// A repo with no remote returns `None`: the CLI's last resort is the literal
/// string `main`, which it then fails to `rev-parse`, and claiming a base that
/// can't resolve would be worse than saying nothing.
async fn default_base(cwd: &str) -> Option<String> {
    if let Some(head) = git(cwd, &["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"])
        .await
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        return Some(head);
    }

    for candidate in ["origin/main", "origin/master"] {
        if git(cwd, &["rev-parse", "--verify", "-q", candidate])
            .await
            .is_some()
        {
            return Some(candidate.to_string());
        }
    }

    None
}

/// Checks out an existing branch. No `-b`, no `-f`: this only moves between
/// branches that already exist, and never discards work to do it.
///
/// `stash` shelves uncommitted changes first and does **not** pop them on the
/// far side — the entry stays in `git stash list` for the user to apply when
/// they choose. Popping automatically would surprise whoever switches back.
///
/// Called from the composer's branch picker, never with a child running: only
/// a new session can pick a branch, so nothing is reading the tree as it moves.
pub async fn checkout_branch(cwd: &str, branch: &str, stash: bool) -> Result<()> {
    let list = list_branches(cwd).await?;

    // Membership is also the injection guard: no shell is involved, but a name
    // beginning with `-` would be read as a flag. Checking against the branches
    // git just reported is simpler than escaping rules and closes the same hole.
    if !list.branches.iter().any(|b| b == branch) {
        bail!("no such branch: {branch}");
    }

    if list.current.as_deref() == Some(branch) {
        return Ok(());
    }

    if stash {
        // Named so the entry is recognizable in `git stash list` weeks later,
        // next to whatever the user stashed by hand.
        let msg = format!("automedon: switching to {branch}");
        run(cwd, &["stash", "push", "--include-untracked", "-m", &msg]).await?;
    }

    // Bare `checkout` carries uncommitted changes across when the file is
    // identical on both branches, and refuses when it isn't. That refusal is
    // the whole safety story here, so it must not be forced away.
    run(cwd, &["checkout", branch]).await
}

/// Runs git and turns a non-zero exit into an error carrying git's own stderr,
/// which names the conflicting files — the part the user needs to act on.
async fn run(cwd: &str, args: &[&str]) -> Result<()> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        bail!(if err.is_empty() {
            format!("git {} failed", args[0])
        } else {
            err
        });
    }

    Ok(())
}

/// Porcelain prints one line per changed path, so the count is the line count.
fn count_changes(raw: &str) -> u32 {
    raw.lines().filter(|l| !l.trim().is_empty()).count() as u32
}

fn parse_branches(raw: &str) -> Vec<String> {
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_lines_and_drops_blanks() {
        let raw = "main\nfeat/one\n\n  spaced  \n";

        assert_eq!(parse_branches(raw), vec!["main", "feat/one", "spaced"],);
    }

    #[test]
    fn empty_output_is_no_branches() {
        assert!(parse_branches("").is_empty());
        assert!(parse_branches("\n\n").is_empty());
    }

    #[test]
    fn counts_one_change_per_porcelain_line() {
        // Staged, unstaged, and untracked all count — the dialog is asking
        // whether the tree is safe to move, not what kind of dirt it holds.
        let raw = " M src/a.rs\n?? src/b.rs\nA  src/c.rs\n";

        assert_eq!(count_changes(raw), 3);
        assert_eq!(count_changes(""), 0);
        assert_eq!(count_changes("\n"), 0);
    }
}
