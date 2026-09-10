/// Whether to draw ⌘ or Ctrl in a shortcut hint and which primary modifier to
/// track for transient shortcut labels.
export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
