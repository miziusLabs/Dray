import { openUrl } from "@tauri-apps/plugin-opener";

/// Opens an inline prompt link through Tauri instead of relying on webview
/// navigation, which is unavailable for the desktop app.
export function openLink(url: string, event?: { preventDefault(): void; stopPropagation(): void }) {
  event?.preventDefault();
  event?.stopPropagation();
  void openUrl(url).catch((error) => console.error("failed to open link", error));
}
