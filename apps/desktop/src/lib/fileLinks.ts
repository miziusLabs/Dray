const FILE_LINK_PROXY = "https://dray.invalid/file";

/// Streamdown's URL hardener blocks `file:` links and bare relative paths even
/// when link safety is enabled. Keep the original URL behind an HTTPS-shaped
/// marker so it can pass the markdown sanitizer and still require the app's
/// confirmation dialog.
export function proxyLocalLink(url: string): string {
  return `${FILE_LINK_PROXY}?url=${encodeURIComponent(url)}`;
}

/// A bare path is how agents usually link to a file in their workspace. URLs
/// with a scheme are left to the normal web-link handling; anchors and query
/// fragments are not file paths.
export function isLocalLink(url: string): boolean {
  return (
    url.toLowerCase().startsWith("file:") ||
    /^[a-z]:[\\/]/i.test(url) ||
    (!/^[a-z][a-z\d+.-]*:/i.test(url) &&
      !url.startsWith("#") &&
      !url.startsWith("?") &&
      !url.startsWith("//"))
  );
}

/// Returns the original local URL for a marker produced by `proxyLocalLink`.
/// Invalid or non-local markers are left alone so a malformed link cannot be
/// accidentally opened as a local file.
export function unwrapLocalLink(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://dray.invalid" || parsed.pathname !== "/file") return url;

    const original = parsed.searchParams.get("url");
    return original && isLocalLink(original) ? original : url;
  } catch {
    return url;
  }
}
