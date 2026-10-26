# Windows support

miziusLabs/Dray#1. The desktop app, the `dray` CLI and the headless server build
and run on x86_64 Windows. This is the plan of record for what that means, what
landed, what is deliberately different from macOS, and what still has to be
proved on a real machine.

## Status

The Windows work is on `feature/windows-support`. It is a port, not a second
product: the frontend, the Rust core, the event model, the session log and the
`dray-serve` wire are shared. Platform differences sit behind `#[cfg]`, a
transport route, or an NSIS setting rather than forking a module.

The first push failed both PR checks at `actions/checkout@v4` with
`unable to create symlink AGENTS.md: Filename too long`: the two guidance files
were committed as mode `120000` symlinks, which a Windows checkout cannot
create without Developer Mode or elevation. They are now ordinary files. The
Windows job is the authoritative build; the development machine used while
writing this has only a GNU Rust host, so the MSVC link is exercised in CI.

## What runs where

| Process | Binary | Started by | Talks to |
| --- | --- | --- | --- |
| Desktop window | `Dray.exe` | Start menu shortcut | its local background server over `ws://127.0.0.1` |
| App background server | `Dray.exe --serve` | HKCU `Run` entry, and on demand | agents, the orchestration named pipe |
| CLI-installed server | `dray-serve.exe` | Task Scheduler task `Dray server` | agents, the orchestration named pipe |
| `dray` | `dray.exe` | the reader or an agent | orchestration named pipe |
| Agent browser | `chrome-headless-shell.exe` | the server that owns the session | CDP over private stdio pipes |

The app window never owns sessions. On Windows and Linux the core runs in the
separate background server, exactly as `MAC-SERVER-PLAN.md` describes for the
Mac, so closing the window does not end a turn. The window and the server are
the same executable, and `--serve` is read in
[main.rs](src-tauri/src/main.rs) before Tauri is touched.

The CLI and the app find each other through a named pipe. The pipe name is the
data directory's absolute path, lower-cased and hashed, so two `DRAY_HOME`s
cannot collide:
[`dray_proto::local_endpoint`](../../crates/dray-proto/src/lib.rs). The server
creates the first instance with `first_pipe_instance(true)`, which turns a name
already taken into an error instead of a second server.

## Parity

| Surface | Windows | Notes |
| --- | --- | --- |
| Agent sessions, resumes, forks, worktrees | yes | same harness parsers and event model |
| Harnesses: Claude Code, Codex, pi, fx, Grok | yes | same CLIs, `PATHEXT` aware lookup |
| Local background server | yes | HKCU `Run`; no launchd, no Windows service |
| CLI-installed server | yes | per-user scheduled task at logon |
| `dray` CLI, orchestration | yes | named pipe, `ERROR_PIPE_BUSY` retry |
| Remote servers, SSH, tunnels, pairing | yes | system `ssh`; see the SSH gap below |
| In-app browser | screenshot view | headless Chromium in the server, not CEF |
| Browser tabs, URL bar, back/forward, pointer input | yes | strips come from `browser_tabs`/`browser_view` |
| Browser history menu | empty | the headless profile keeps none |
| DevTools, element pick for chat, CEF shutter | no | no embedded DevTools UI; not exposed |
| Editor and terminal hand-off | yes | VS Code forks, Zed, Sublime, Notepad++, JetBrains, Windows Terminal, PowerShell, cmd, Git Bash, Alacritty, WezTerm |
| Desktop notifications | yes | `notify-rust` toast with app id |
| Dictation, microphone, output mute | yes | cpal, WASAPI mute |
| Updater | yes | Tauri NSIS, signed `latest.json` entry |
| Dray Island | no | macOS-only; the command explains itself |
| Embedded CEF | no | Windows uses WebView2 plus headless Chromium |
| Native ARM64 | no | x64 binaries run under Windows ARM64 emulation |

## What landed

### Transport and IPC

- [transport.ts](src/lib/transport.ts) routes Windows `browser_*` and
  `chromium_*` to the **local** server, not the app process. A remote session's
  browser is still the reader's local browser, the same rule the Mac's CEF
  follows; the remote server has no reader-facing tab strip. `APP_COMMANDS`
  still lists the command names because `lib.rs` registers them on a Mac and a
  test holds the two lists together.
- [main.rs](../cli/src/main.rs) retries `ERROR_PIPE_BUSY` for two seconds while
  the server swaps pipe instances between clients.
- [background.rs](src-tauri/src/background.rs) registers the app's login server
  under HKCU `Run` only when `DRAY_HOME` is unset. A custom home is the reader
  saying "this server is mine", and the Run entry carries no environment, so
  registering it would start a second server on the default home.
- The app's server process is spawned detached (`DETACHED_PROCESS |
  CREATE_NEW_PROCESS_GROUP`) with its log appended to `server.log`, so no
  console window flashes and the server outlives the window.

### Sessions and process handling

- [binpath.rs](src-tauri/src/binpath.rs) resolves agent executables from the
  user's real `PATH` instead of assuming an interactive shell's environment.
  Its `command`/`std_command` helpers apply `CREATE_NO_WINDOW` on Windows.
- [local_servers.rs](src-tauri/src/local_servers.rs) lists listeners with
  `Get-NetTCPConnection`, walks children with `Get-CimInstance Win32_Process`,
  and kills trees with `taskkill /T /F`.
- [serve.rs](src-tauri/src/serve.rs) uses `binpath::std_command("taskkill")` so
  stopping a session does not flash a console.
- `dray server start` writes `server.ps1` and registers the per-user scheduled
  task `Dray server`. The launcher exits with the server's own code, so the
  task's restart count sees a crash rather than PowerShell's zero. Start waits
  for the port in `serve-port` before claiming success; status checks the
  socket, the process image and the tunnel; uninstall stops and unregisters the
  task, ends the `dray-serve.exe` whose pid the server wrote, waits for it,
  removes `server.ps1`, and prints parity messages
  ([setup.rs](../cli/src/setup.rs)).
- [updater.rs](src-tauri/src/updater.rs) stops the Windows background server
  before the NSIS installer replaces the executable, and resumes it if the
  install fails. The uninstaller itself calls Tauri's `CheckIfAppIsRunning`
  (Restart Manager) on `Dray.exe`, which covers the windowless `--serve`
  instance too; a pre-uninstall `taskkill` would be redundant.

### Browser

- [headless.rs](src-tauri/src/headless/headless.rs) answers the reader-facing
  verbs over the session's headless Chromium: `browser_open`, `browser_tabs`,
  `browser_activate`, `browser_close`, `browser_move`, `browser_nav`,
  `browser_history`, plus the existing `browser_view`, `browser_input` and
  `chromium_*`. Tabs are serialised in the frontend's `BrowserTab` shape.
  Right and middle mouse buttons are forwarded through CDP.
- [WindowsBrowserPane.tsx](src/components/browser/WindowsBrowserPane.tsx) draws
  the viewport, forwards clicks, wheel and keys, and publishes each polled tab
  list. Its duplicate tab row was removed: the titlebar's `ViewTabs` strip owns
  tabs now, fed by `publishTabs`.
- [browser.ts](src/lib/browser.ts) has one `acceptTabs` path for both the Mac's
  `browser_tabs` event and a Windows pane's poll. `openInBrowser` refreshes tabs
  on Windows because a link from Chat may flip to Browser before any pane is
  mounted to poll.
- [transport.test.ts](src/lib/transport.test.ts) covers the process split,
  including a browser call for a session that lives on a remote server.

### Native integrations

- [apps.rs](src-tauri/src/apps.rs) detects Windows editors and terminals:
  VS Code and Insiders, Cursor, Windsurf, Zed, Sublime Text 2/3, Notepad++,
  JetBrains Toolbox products, Windows Terminal, PowerShell 7, Windows
  PowerShell, Command Prompt, Git Bash, Alacritty and WezTerm. File-at-line
  arguments are supplied for VS Code forks, Zed, Sublime, Notepad++ and
  JetBrains launchers. A file handed to a terminal opens at its parent
  directory, and console hosts get `Set-Location`, `cd /d`, or a working
  directory rather than a file path.
- [notifications.rs](src-tauri/src/notifications.rs) posts Windows toasts with
  `app_id("com.yogesh.dray")`, a one-minute timeout and a click that activates
  the session.
- [transcription/audio.rs](src-tauri/src/transcription/audio.rs) reads and sets
  the default output device's mute through WASAPI instead of `osascript`.
- Clipboard image paste, window state, updater and the custom titlebar use the
  existing shared paths with Windows implementations where the platform needs
  one.

### CLI and setup

- `dray setup` treats Windows as a first-class target: `PATHEXT` decides which
  executable names are tried; `winget` installs git, GitHub CLI, Claude Code,
  Codex and ffmpeg; the three agents winget does not carry (pi, fx, Grok) are a
  manual hand-off with a clear message.
- [install.ps1](../web/public/install.ps1) installs the checksummed
  `dray-x86_64-pc-windows-msvc.zip`, adds `~/.local/bin` to the user `PATH`,
  renames a running binary out of the way rather than failing to overwrite it,
  installs the skill and runs setup. [install.test.ps1](../web/tests/install.test.ps1)
  exercises it in CI without touching the network.
- `dray update` runs `install.ps1` on Windows with `DRAY_UPDATING=1` and
  `DRAY_INSTALL_DIR` set to the running binary's directory.
- The SSH "permission denied" hint no longer suggests `ssh-copy-id`, which
  Windows OpenSSH does not ship; it pipes the public key into the remote
  `authorized_keys` instead.

### Paths and files

- [store.rs](src-tauri/src/store.rs) parses `.claude/worktrees/<name>` paths with
  either separator, including the `\\?\` prefix `canonicalize` adds, so a
  Windows worktree build still gets its own dev home and a session still moves
  to its project root.
- [projects.rs](src-tauri/src/projects.rs) strips the verbatim `\\?\` (and
  converts `\\?\UNC\`) from canonical project paths, since Git Bash and the
  picker do not understand them.
- [filePath.ts](src/lib/filePath.ts), [fileTree.ts](src/lib/fileTree.ts) and the
  transport's path qualification handle drive letters and UNC paths.

### Build, packaging and release

- The desktop is built for `x86_64-pc-windows-msvc`; GNU is not supported. The
  README records the Visual Studio Build Tools, CMake and WebView2
  requirements.
- [tauri.windows.conf.json](src-tauri/tauri.windows.conf.json) overrides the
  window to be opaque and decorated, bundles NSIS with
  `installMode: currentUser` (no elevation), and runs
  [installer-hooks.nsh](src-tauri/windows/installer-hooks.nsh) to remove the
  HKCU `Run` value on uninstall.
- [release.yml](../../.github/workflows/release.yml) builds and publishes the
  NSIS installer on `windows-latest`, signs it through Tauri, and the manifest
  job refuses to publish a `latest.json` without a signed Windows entry.
- [release-cli.yml](../../.github/workflows/release-cli.yml) packages
  `dray.exe` and `dray-serve.exe` as a checksummed zip beside the POSIX
  tarballs.
- [windows-ci.yml](../../.github/workflows/windows-ci.yml) runs frontend tests,
  the PowerShell installer test, `dray-proto`, the CLI, the desktop Rust tests,
  the `dray-serve` check, the ignored real-Chromium pipe/input test, and a
  no-bundle Tauri build.

### Warning cleanup

macOS-only code that Windows compiles but never calls is now behind `#[cfg]`
instead of producing dead-code warnings: bundle detection and icon work in
`apps.rs`, mute parsing in `transcription/audio.rs`, `lsof`/cwd parsing in
`local_servers.rs`, `AboutMetadata` in `quit.rs`, and the launchd/systemd half
of `setup.rs`. The CLI and both desktop feature sets check warning-free apart
from `ts-rs`'s serde-attribute parse notices.

## Decisions

**WebView2, not CEF.** CEF is a macOS dependency in this tree and a large one.
Windows' system WebView2 is already installed on current Windows and the NSIS
default bootstrapper can add it. The app's own React layer is unchanged.

**The browser belongs to the server on Windows.** CEF draws into the Mac
window, so `browser_*` is an app command there. Windows' Chromium is headless
and lives in the server that owns the session, so the commands route there
instead. This is a deliberate inversion of the Mac's rule, made in
`transport.ts` and covered by a test.

**The reader's browser stays local.** Even for a session on a remote server,
Windows routes the browser to its own local server. A remote `dray-serve` has
no reader-facing tab strip; its agent's browser is reached through screenshots
in the transcript, exactly as `HEADLESS-PLAN.md` specifies for the Mac.

**A scheduled task, not a Windows service.** The CLI-installed server runs as
the reader at logon, in their session, with their environment and their agent
logins. A Windows service would run in session 0 with none of those, and would
need elevation to install. The app's own background server is even lighter: an
HKCU `Run` entry.

**Per-user NSIS.** `installMode: currentUser` matches the rest of Dray: data in
the user's home, no elevation, uninstall from Settings. The app binary keeps its
data on uninstall; sessions are the reader's, not the installer's.

**No pre-uninstall `taskkill`.** Tauri's NSIS uninstaller already runs
`CheckIfAppIsRunning` against `$INSTDIR\Dray.exe` through Restart Manager. That
covers both the window and the same executable's `--serve` instance. A second
kill would be ceremony around a solved problem.

**No console windows.** Every background spawn from the GUI applies
`CREATE_NO_WINDOW` through `binpath`; the app's own server is detached; the
updater's installer is run by Tauri with its own flags. A console flash on
session stop or browser launch is a bug, not cosmetic.

**Guidance files are files.** `AGENTS.md` and `apps/desktop/AGENTS.md` were
symlinks in the first commit. A Windows checkout cannot create a symlink
without Developer Mode or elevation, so `actions/checkout` failed before any
build step. They are now ordinary files; a future consolidation should use a
real file and links in prose, not repository symlinks.

## Validation

### Automated

`windows-ci.yml` is the gate. On `windows-latest` it runs:

- `pnpm test` — 918 frontend tests, including the browser routing test.
- `apps/web/tests/install.test.ps1` — the installer's channel, checksum,
  upgrade and `PATH` behaviour with stubbed network calls.
- `cargo test` in `crates/dray-proto` and `apps/cli`.
- `cargo test --locked` in `apps/desktop/src-tauri` — all desktop unit tests on
  MSVC, including the Windows path and worktree cases.
- `cargo check --locked --no-default-features --features serve --bin dray-serve`
  — the headless build used by `dray-serve` and by servers without the app.
- `cargo test --locked --no-default-features --features serve --lib
  windows_browser_pipe_and_input -- --ignored` — downloads the real pinned
  Chromium, opens a page, types through the CDP pipe and captures a screenshot.
- `pnpm tauri build --no-bundle --config src-tauri/tauri.windows.conf.json` — a
  real MSVC link of the desktop binary.

The frontend test above is also what holds `transport.ts`'s `APP_COMMANDS` to
`lib.rs`'s `generate_handler!` list. A Rust-side rename that is not mirrored
fails there rather than at runtime.

### Local

The machine used during development has a GNU Rust host and no MSVC toolchain.
`cargo check` passes for the desktop feature set and for `serve`, and the CLI
tests pass, but the desktop test binary cannot link locally: `transcribe-cpp`'s
GNU sys crate installs `ggml.a` without the `lib` prefix and omits libstdc++.
The MSVC CI job is the authoritative link and test. A local desktop check needs
a space-free `CARGO_TARGET_DIR` because `tauri-winres` mishandles spaces.

### Manual smoke

Run this on a clean Windows 11 user account before merging or tagging.

1. Install the NSIS bundle as a standard user. No UAC prompt. WebView2 present
   or downloaded by the bootstrapper. App launches, window is opaque and
   resizable.
2. Create a session in a repository with a space in its path. Send a prompt.
   The transcript streams, the turn settles, and reopening the app resumes it.
3. Close the window while a turn runs. Reopen: the turn continued in the
   background server. Quit from the app; confirm the server is not left as a
   zombie in Task Manager.
4. `dray server start`, `dray server status`, `dray session list` from
   PowerShell. Start a second session through the CLI and confirm it appears in
   the app.
5. Ask an agent to `dray browser` a page, then open the Browser tab: the
   agent's tab is in the titlebar, the screenshot shows the page, and clicking,
   scrolling and typing reach it.
6. Open a link from Chat. The Browser view flips to it with an active tab. Close
   and reorder tabs from the titlebar; the pane follows.
7. Open a file from the Changes panel in VS Code at a line, and open the
   checkout in Windows Terminal, PowerShell 7 and Git Bash. Each starts in the
   checkout, not in Dray's directory. Repeat with a Notepad++/Sublime install if
   present.
8. Trigger a session notification while the app is in the background. The toast
   names Dray and clicking it brings the session forward.
9. Dictate a prompt; the text lands in the composer. Toggle output mute from
   the dictation control and confirm the system volume icon follows.
10. Add a remote server over SSH with a key; list its sessions. Open its
    Browser tab and confirm the page is served locally while the agent's remote
    screenshots appear in the transcript.
11. `dray update` from PowerShell updates in place and warns that the
    background server still runs the old binary.
12. Uninstall from Settings. The scheduled task, `server.ps1`, `dray-serve.exe`
    and the HKCU `Run` value are gone; `%USERPROFILE%\.dray` is intact.

## Known gaps

### Should be closed before calling Windows at parity

- **Toast identity.** The toast carries `com.yogesh.dray`, but an unpackaged
  Win32 app is normally only delivered if a Start-menu shortcut carries the
  same AUMID. The NSIS template does not set it. Verify on the smoke machine;
  if banners do not arrive, set the shortcut's `System.AppUserModel.ID` in the
  installer hook or register the AUMID at first launch.
- **Installer upgrade.** The release job builds and signs the NSIS installer but
  nothing installs one build over another in CI. Add a Windows job that
  installs `/S`, records a sentinel in `%USERPROFILE%\.dray`, installs the next
  `/S`, and checks both the sentinel and that no `Dray.exe` is left running.
- **Remote Windows servers.** The app's "install on server" path assumes a
  POSIX login and runs `install.sh`; Windows OpenSSH defaults to `cmd.exe`.
  Until that path learns PowerShell, a Windows server has to be prepared by
  hand (`dray server start`) and added by address. Decide whether Windows is a
  supported server target for remote mode or document it as local-only.

### Follow-ups

- **Native ARM64.** The release builds x64 only. ARM64 Windows runs it under
  emulation, and the same emulated x64 `chrome-headless-shell` works, but there
  is no native build, no ARM64 Chromium download, and no ARM64 CI leg.
- **Browser DevTools and element pick.** The Windows pane has no DevTools
  button and no pick-for-chat affordance. If they are wanted, they need CDP
  implementations (`Overlay`/`DOM` for picking) rather than CEF's; until then
  the commands should answer a clear "not available on Windows" instead of
  `unknown command`.
- **Browser history.** `browser_history` returns an empty list; the headless
  profile is per-session and discarded. A visit log in the server would change
  that, and could share the Mac's `history` store shape.
- **Local server discovery.** `cwd_of` on Windows can only read Dray's own
  working directory, so a dev server started by hand in the checkout is not
  listed — only descendants of the agent are. Reading another process's PEB, or
  matching a listener's executable path against the tree, would close it.
- **Named-pipe trust.** The pipe name is a hash of the home directory and the
  server uses `first_pipe_instance`, but the CLI does not verify that the
  server process belongs to the same user. On a multi-user machine another
  account could win the name first. Verify the server SID from the client, or
  put the user SID in the pipe name.
- **Chromium handles.** Rust's `Command` passes only the stdio handles it
  intends to inherit, and the ignored real-browser test exercises the pipe on
  Windows. Keep that test in the Windows job; do not replace the launch with a
  raw `CreateProcess` without carrying the handle list over.
- **`dray setup` coverage.** ffmpeg and Codex now come from winget, but pi, fx
  and Grok remain a manual hand-off. Add winget manifests or vendor installers
  once those projects publish them.
- **Crash logs.** The app has no Windows equivalent of a `.crash` report and no
  Event Log entry. A panic in the windowless server is only in `server.log`.

### Deliberately absent

- Dray Island, CEF and the macOS trackpad/gesture code.
- `osascript`-based notification fallbacks and TCC prompts.
- Launch Services, `open -a`, and the mac-only app picker paths.
- Windows service mode and machine-wide installation.

## Acceptance criteria

- A clean Windows 11 x64 user can install the signed NSIS bundle without
  elevation, launch it, and complete a session end to end.
- `windows-ci.yml` is green: frontend, installer test, `dray-proto`, CLI,
  desktop Rust tests, serve build, real-Chromium pipe test, no-bundle build.
- The manual smoke checklist above passes on the smoke machine.
- The CLI can start, inspect and remove a background server without leaving an
  orphaned `dray-serve.exe`, a scheduled task or an HKCU `Run` value.
- Uninstall removes the app's login entry and leaves `%USERPROFILE%\.dray`
  untouched.
- A remote session's Browser tab opens locally; its agent's browser remains
  visible only through the transcript.
- The release manifest check still refuses a `latest.json` with no signed
  Windows entry.

## Release checklist

1. Merge the PR only after `windows-ci.yml` is green on the merge commit and the
   manual smoke list is signed off.
2. Bump `tauri.conf.json`, `CHANGELOG.md` and the tag together; a stable tag
   needs a matching changelog section.
3. Tag `vX.Y.Z` or `vX.Y.Z-beta.N`. Confirm the `windows` job publishes
   `Dray_<version>_x64-setup.exe` and the manifest job finds a signed entry for
   it.
4. Tag `cli-vX.Y.Z` separately for the CLI; the Windows zip must contain both
   `dray.exe` and `dray-serve.exe` and its `.sha256`.
5. After the first stable release, install it on a machine that has never run
   Dray and repeat the smoke list from the installer step.
