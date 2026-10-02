#!/usr/bin/env node
// `pnpm tauri` shim. The Tauri CLI merges an extra config only when it is named
// on the command line, and the name has to be per-subcommand — so `dev` gets the
// dev flavour (its own product name and icon) while `build` stays untouched.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const require = createRequire(import.meta.url);
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const args = process.argv.slice(2);

// A terminal opened before Scoop installed MinGW still has the old PATH.
// Both windres and Cargo's GNU linker need the installed compiler toolchain.
if (process.platform === "win32") {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const directories = (process.env[pathKey] ?? "").split(delimiter);
  const mingw = join(process.env.SCOOP ?? join(homedir(), "scoop"), "apps", "mingw", "current", "bin");
  if (!directories.some((dir) => existsSync(join(dir, "gcc.exe"))) && existsSync(join(mingw, "gcc.exe"))) {
    process.env[pathKey] = [...directories, mingw].join(delimiter);
  }
}

// Running the workspace `tauri` script without a subcommand is the convenient
// way to start the app. Keep explicit CLI commands (including `--help`) intact.
if (args.length === 0) args.push("dev");

const noWatch = args.includes("--no-watch");
if (noWatch) process.env.DRAY_NO_WATCH = "1";
if (args[0] === "dev" && !args.some((a) => a === "-c" || a === "--config")) {
  args.push("--config", "src-tauri/tauri.dev.conf.json");
}

// Run the CLI through Node instead of spawning pnpm's platform-specific bin
// shim. On Windows, the shim is a `.CMD` file, which Node cannot spawn directly.
const child = spawn(process.execPath, [tauriCli, ...args], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
