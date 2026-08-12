import { cpSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const url = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/// Stages the Material file icons into `public/` so `/file-icons/<name>.svg`
/// resolves the same way in dev and in a bundle.
///
/// They are ~900 separate SVGs referenced by name at runtime, not imported, so
/// no bundler can see them — copying is the only way they reach the output.
/// `public/file-icons` is generated and gitignored.
///
/// Runs at config load rather than in `buildStart`, and that placement is the
/// point: a dev server started before the directory existed serves 404s for
/// every icon until it is restarted, which reads as "the icons are broken"
/// rather than "the server is stale". Doing it here means merely loading the
/// config is enough. The count check keeps a repeat start near-free.
function fileIcons(): Plugin {
  const from = url("./node_modules/vscode-material-icons/generated/icons");
  const to = url("./public/file-icons");

  const stage = () => {
    try {
      if (readdirSync(to).length === readdirSync(from).length) return;
    } catch {
      // No staged directory yet, which is the case the copy exists for.
    }
    cpSync(from, to, { recursive: true });
  };

  stage();
  return { name: "dray-file-icons", buildStart: stage };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), fileIcons()],

  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
