#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const image = process.env.DRAY_CLOUD_IMAGE?.trim() || "dray-cloud:latest";
const piPackage = process.env.PI_PACKAGE?.trim() || "@earendil-works/pi-coding-agent";

console.log(`Building Dray Cloud sandbox image ${image}`);
const child = spawn(
  "docker",
  ["build", "--build-arg", `PI_PACKAGE=${piPackage}`, "--tag", image, resolve(root, "sandbox")],
  { stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
