# Dray

A desktop home for your coding agents. Dray wraps coding-agent CLIs (Claude
Code, Codex, fx, pi) in a native chat UI. Run many sessions at once. Each gets
its own worktree, diff view, PR panel, issue panel and embedded browser.

Source code lives at [github.com/miziusLabs/Dray](https://github.com/miziusLabs/Dray).

## Sponsors

- [Guillermo Rauch](https://x.com/rauchg), Vercel CEO, through his
  [OSS Grants](https://rauchg-oss-grants.vercel.app/) programme.
- [Greptile](https://www.greptile.com/), AI code reviews, free for open source.

[![Greptile: The War on Bugs](https://www.greptile.com/badge.svg)](https://www.greptile.com/?utm_source=oss_badge&utm_medium=readme&utm_campaign=greptile_for_open_source)

Want to sponsor Dray? [patreon.com/yogesharc](https://patreon.com/yogesharc)

## Layout

| Path | What |
| --- | --- |
| `apps/desktop` | Tauri app with a React frontend and Rust backend |
| `apps/cli` | Standalone `dray` command line client |
| `crates/dray-proto` | Wire types shared by the CLI and the app |
| `apps/web` | Next.js marketing site and install scripts |
| `apps/docs` | Public docs at drayhq.com/docs |
| `apps/ios` | SwiftUI client for `dray-serve` |

## Getting started

You need Node with pnpm and a Rust toolchain. Some native dependencies also use CMake.

For a Windows desktop build, use the `x86_64-pc-windows-msvc` Rust target. Install Visual Studio Build Tools with the Desktop development with C++ workload, CMake, and the Microsoft Edge WebView2 Runtime.

```bash
pnpm install
pnpm app    # desktop app
pnpm web    # marketing site on :3000
pnpm test   # frontend tests
```

Everything else runs from the package's own directory:

```bash
cd apps/desktop && pnpm tauri build
cd apps/desktop/src-tauri && cargo test
```

`cargo test` regenerates `apps/desktop/src/types/events.ts`. After a filtered
Rust test run, run the full `cargo test` command.

On Windows, the browser uses a shared headless Chromium screenshot view instead of the embedded CEF view. Dray Island is available on macOS only.

## The `dray` CLI

A standalone binary. It talks to the running app over a local Unix socket on
macOS and Linux or a Windows named pipe. An agent in one session can create,
list and message others.

```bash
curl -fsSL https://www.drayhq.com/install.sh | sh
```

On Windows PowerShell, install the CLI with:

```powershell
irm https://www.drayhq.com/install.ps1 | iex
```

On Linux, the shell command makes the machine a Dray server too. See
[drayhq.com/docs/server](https://www.drayhq.com/docs/server).

## Releasing

**App:** tag `vX.Y.Z` (stable) or `vX.Y.Z-beta.N` (beta). The tag must match
`apps/desktop/src-tauri/tauri.conf.json`, and a stable release needs a
matching section in `apps/desktop/CHANGELOG.md`.

**CLI:** tag `cli-vX.Y.Z` (stable) or `cli-vX.Y.Z-beta.N` (beta), matching the
version in `apps/cli/Cargo.toml` exactly. Cut one beside every app release, beta
included, so a server can run the core that release expects.

## Credits

Full licence texts are in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).

**Themes.** Four palettes are MIT ports, colours theirs and token names ours:
[Catppuccin](https://github.com/catppuccin/catppuccin),
[Cobalt2](https://github.com/wesbos/cobalt2-vscode) (Wes Bos, Roberto Achar),
[One Dark Pro](https://github.com/Binaryify/OneDark-Pro) (Binaryify) and
[gruvbox](https://github.com/morhetz/gruvbox) (Pavel Pertsev).

**Marks.** The [pi](https://pi.dev) mark is MIT, © Earendil Inc. &
Contributors. Claude's and OpenAI's are their owners' trademarks and only name
the agent a session runs on.

**Transcription.** Dictation runs locally on
[transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) (MIT).
Models are `handy-computer`'s GGUF conversions from Hugging Face, CC-BY-4.0
with their base models' terms. The dictation sounds are
[Handy](https://github.com/cjpais/Handy)'s marimba pair, by CJ Pais, MIT.
Handy's name and brand assets are not used here.
