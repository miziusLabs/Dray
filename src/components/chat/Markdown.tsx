import { memo } from "react";
import { code } from "@streamdown/code";
import { Streamdown, type ThemeInput } from "streamdown";

import { cn } from "@/lib/utils";

type MarkdownProps = {
  children: string;
  /// True while deltas are still arriving, so incomplete blocks render as
  /// prose instead of flickering through half-parsed markdown.
  streaming?: boolean;
  className?: string;
};

// Shiki takes a [light, dark] pair and picks by the `.dark` class our theme
// already sets, so switching palettes needs nothing here.
const SHIKI_THEME: [ThemeInput, ThemeInput] = ["github-light", "github-dark"];

const PLUGINS = { code };

/// Streamdown is built on the same shadcn tokens as the rest of the app, so it
/// inherits the palette; only typography scale is ours to set.
function MarkdownImpl({ children, streaming = false, className }: MarkdownProps) {
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      plugins={PLUGINS}
      shikiTheme={SHIKI_THEME}
      lineNumbers={false}
      className={cn(
        "text-chat [&_code]:font-mono [&_code]:text-code [&_pre]:font-mono",
        // Streamdown only puts layout classes on a line span when `lineNumbers`
        // is on, and they carry the block display along with the gutter. Turning
        // numbering off leaves the spans inline, so the whole block collapses
        // onto one line — restore just the display, not the gutter.
        "[&_pre_code>span]:block",
        // Streamdown sets its own vertical rhythm; strip the leading and
        // trailing margin so a message sits flush in the transcript's gap.
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      {children}
    </Streamdown>
  );
}

// Every delta re-renders the transcript, so identical text must not re-parse.
export const Markdown = memo(MarkdownImpl);
