import GitBranchIcon from "@/components/icons/GitBranchIcon";
import { basename } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SessionSnapshot } from "@/types/events";

type SessionHeaderProps = {
  session: SessionSnapshot | null;
  className?: string;
};

/// Title over project · branch. The sidebar clips titles at 240px, so this is
/// the one place the full one is legible — hence the tooltip, and hence the
/// title getting the whole width while the metadata sits under it.
export default function SessionHeader({ session, className }: SessionHeaderProps) {
  if (!session) {
    return (
      <div className={cn("min-w-0 text-center", className)} data-tauri-drag-region>
        <span className="text-ui text-muted-foreground">New session</span>
      </div>
    );
  }

  // A worktree session's `cwd` is the tree, not the repo, so the project name
  // has to come off `projectPath` or every worktree reads as its own project.
  const project = basename(session.projectPath);
  const branch = session.worktreeName
    ? `worktree-${session.worktreeName}`
    : session.branch;

  return (
    <div
      className="flex min-w-0 flex-1 flex-col items-center justify-center leading-tight"
      data-tauri-drag-region
    >
      {/* Title is held back until it's worth the vertical space — the metadata
          line below carries the header on its own for now.
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="max-w-full truncate text-ui font-medium text-foreground">
            {session.title}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-80 text-balance">
          {session.title}
        </TooltipContent>
      </Tooltip>
      */}

      <span className="flex max-w-full items-center gap-1.5 text-ui text-muted-foreground">
        <span className="truncate">{project}</span>

        {branch && (
          <>
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
            <span className="flex min-w-0 items-center gap-1">
              <GitBranchIcon className="size-3 shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          </>
        )}
      </span>
    </div>
  );
}
