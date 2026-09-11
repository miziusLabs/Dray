const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp)$/i;

function unquote(value: string): string {
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

function fileUriPath(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return null;

    const pathname = decodeURIComponent(url.pathname);
    if (url.host) return `//${url.host}${pathname}`;
    // file:///C:/... is the Windows form, while Unix paths begin with the
    // slash that URL.pathname already provides.
    return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    return null;
  }
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.test(unquote(path.trim()));
}

function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("~/") ||
    /^\\\\/.test(path) ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

/// Finds a file path copied from Finder/Explorer or a terminal. URI lists are
/// preferred because they preserve paths containing spaces; plain text covers a
/// path copied directly from a shell or file info panel. The caller validates
/// the result before attaching it, so a path-looking piece of ordinary text is
/// still inserted when it does not point to a readable file.
export function pastedFilePath(uriList: string, plainText: string): string | null {
  const uri = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && line.startsWith("file:"));
  const uriPath = uri ? fileUriPath(uri) : null;
  if (uriPath) return uriPath;

  const text = unquote(plainText.trim());
  if (text.startsWith("file:")) return fileUriPath(text);

  return isAbsolutePath(text) ? text : null;
}

/// Finds an image path from the generic pasted-file path while retaining the
/// image-only helper for callers that need to classify a path without reading it.
export function pastedImagePath(uriList: string, plainText: string): string | null {
  const path = pastedFilePath(uriList, plainText);
  return path && isImagePath(path) ? path : null;
}
