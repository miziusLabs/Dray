#!/usr/bin/env node
// `pnpm tauri` shim. The Tauri CLI merges an extra config only when it is named
// on the command line, and the name has to be per-subcommand — so `dev` gets the
// dev flavour (its own product name and icon) while `build` stays untouched.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const args = process.argv.slice(2);
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
