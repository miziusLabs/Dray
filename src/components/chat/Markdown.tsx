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

// Copy is the only control worth keeping. Table actions and code download are
// off entirely rather than hidden with CSS, so they can't be tabbed to either.
const CONTROLS = { table: false, code: { copy: true, download: false } };

/// Streamdown is built on the same shadcn tokens as the rest of the app, so it
/// inherits the palette; only typography scale is ours to set.
function MarkdownImpl({ children, streaming = false, className }: MarkdownProps) {
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      plugins={PLUGINS}
      controls={CONTROLS}
      shikiTheme={SHIKI_THEME}
      lineNumbers={false}
      className={cn(
        // `group/md` so the copy control can fade in on hover of the message —
        // Streamdown leaves it visible at rest otherwise.
        "group/md text-chat",

        // One size for every element in the message. Streamdown's prose styles
        // scale headings and small print off their own scale, so each is pinned
        // back to `text-chat`; `font-bold`/`italic` still apply, which is what
        // carries hierarchy now that size no longer does.
        "[&_h1]:text-chat [&_h2]:text-chat [&_h3]:text-chat [&_h4]:text-chat [&_h5]:text-chat [&_h6]:text-chat",
        "[&_p]:text-chat [&_li]:text-chat [&_blockquote]:text-chat [&_td]:text-chat [&_th]:text-chat",
        "[&_small]:text-chat [&_figcaption]:text-chat",
        // Headings keep their weight but lose the size jump, so the vertical
        // rhythm has to shrink or they read as isolated lines.
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:mt-3 [&_h3]:mb-1.5",

        // Code is the one thing that scales independently.
        "[&_code]:font-mono [&_code]:text-code [&_pre]:font-mono [&_pre_code]:text-code",
        // Streamdown only puts layout classes on a line span when `lineNumbers`
        // is on, and they carry the block display along with the gutter. Turning
        // numbering off leaves the spans inline, so the whole block collapses
        // onto one line — restore just the display, not the gutter.
        "[&_pre_code>span]:block",

        // Code: Streamdown nests a bordered card around another bordered box.
        // Strip the outer chrome and let the inner `pre` be the block.
        "[&_[data-streamdown=code-block]]:gap-0",
        "[&_[data-streamdown=code-block]]:bg-transparent [&_[data-streamdown=code-block]]:p-0",
        "[&_[data-streamdown=code-block-header]]:hidden",
        // The action bar already floats via `sticky` + `-mt-10`, which pulls it
        // up into the header's row. With the header hidden that space is gone
        // and the bar lands above the block, so the negative margin is dropped
        // and the bar overlays the first line instead. It's an unnamed wrapper,
        // hence the positional selector.
        "[&_[data-streamdown=code-block]>div:has([data-streamdown=code-block-actions])]:mt-2",
        "[&_[data-streamdown=code-block]>div:has([data-streamdown=code-block-actions])]:-mb-10",
        // The code block's border, radius, and scroll containment live in
        // App.css — they have to outrank Streamdown's own utilities, which these
        // arbitrary variants can't do at equal specificity.
        // Copy control: no chrome at rest, a subtle fill only under the cursor.
        "[&_[data-streamdown=code-block-actions]]:border-0 [&_[data-streamdown=code-block-actions]]:bg-transparent",
        "[&_[data-streamdown=code-block-actions]]:supports-[backdrop-filter]:bg-transparent",
        "[&_[data-streamdown=code-block-actions]]:p-0",
        "[&_[data-streamdown=code-block-copy-button]]:rounded-md [&_[data-streamdown=code-block-copy-button]]:p-1.5",
        "[&_[data-streamdown=code-block-copy-button]]:hover:bg-muted/60",
        "[&_[data-streamdown=code-block-copy-button]_svg]:size-3.5",
        // The copy control's reveal-on-hover lives in App.css too — it keys off
        // the code block itself, not this whole message.

        // Table: no enclosing box. The outline lives on an unnamed div between
        // the wrapper and the table, so all three layers have to be cleared.
        "[&_[data-streamdown=table-wrapper]]:border-0 [&_[data-streamdown=table-wrapper]]:bg-transparent [&_[data-streamdown=table-wrapper]]:p-0",
        "[&_[data-streamdown=table-wrapper]]:rounded-none",
        "[&_[data-streamdown=table-wrapper]>div]:rounded-none [&_[data-streamdown=table-wrapper]>div]:border-0",
        "[&_[data-streamdown=table-header]]:bg-transparent",
        "[&_table]:rounded-none [&_table]:border-0",
        // Cells carry no rules of their own, so removing the outline would leave
        // the table with no structure at all — put it back on the rows.
        "[&_th]:border-b [&_th]:border-border/60",
        "[&_tbody_tr]:border-b [&_tbody_tr]:border-border/30",

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
