import type { ReactNode } from "react";

type AppShellProps = {
  sidebar: ReactNode;
  header?: ReactNode;
  footer: ReactNode;
  /// Right-hand inspector, when open. Sits outside the chat column so the
  /// composer stays scoped to the conversation rather than spanning both.
  panel?: ReactNode;
  children: ReactNode;
};

/// Owns every bit of app geometry: the viewport lock, which panes scroll, and where
/// the composer sits. Panes below this get height from their parent and never set
/// their own margins, so there is one place to change the layout.
export default function AppShell({
  sidebar,
  header,
  footer,
  panel,
  children,
}: AppShellProps) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      {sidebar}

      {/* `min-w-0` is load-bearing: without it a wide code block in the transcript
          sets the flex item's floor and pushes the sidebar off-screen. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {header}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        <div className="shrink-0">{footer}</div>
      </div>

      {panel}
    </div>
  );
}
