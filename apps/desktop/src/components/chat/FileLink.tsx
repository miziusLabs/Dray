import type { ReactNode, SyntheticEvent } from "react";
import { openPath } from "@tauri-apps/plugin-opener";

import { cn } from "@/lib/utils";

/// A bare path in chat prose, opened with the system's associated application.
export default function FileLink({
  path,
  line,
  title,
  className,
  children,
}: {
  path: string;
  line?: number;
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  const open = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // The current opener API accepts a path but not a line. Keep the locator in
    // the accessible title until an editor-selection opener is available.
    void line;
    void openPath(path).catch((error) => console.error("failed to open file", error));
  };

  return (
    <span
      role="link"
      tabIndex={0}
      title={title ?? path}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open(event);
      }}
      className={cn(
        "cursor-pointer underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current",
        className,
      )}
    >
      {children ?? path}
    </span>
  );
}
