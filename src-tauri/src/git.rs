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
    /// Uncommitted changes, which make a checkout fail. Surfaced so the picker
    /// can say why rather than letting the send die on git's stderr.
    pub dirty: bool,
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
        .is_some_and(|s| !s.trim().is_empty());

    Ok(BranchList {
        current,
        branches: parse_branches(&raw),
        dirty,
    })
}

/// Checks out an existing branch. No `-b`, no `-f`: this only moves between
/// branches that already exist, and never discards work to do it.
///
/// Called once per session creation, before the child spawns — never against a
/// live session, whose child would be reading the tree as it changed.
pub async fn checkout_branch(cwd: &str, branch: &str) -> Result<()> {
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

    let out = Command::new("git")
        .args(["checkout", branch])
        .current_dir(cwd)
        .output()
        .await?;

    if !out.status.success() {
        // git's own message names the conflicting files, which is what the user
        // needs in order to act.
        bail!(
            "{}",
            String::from_utf8_lossy(&out.stderr).trim().to_string()
        );
    }

    Ok(())
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
}
