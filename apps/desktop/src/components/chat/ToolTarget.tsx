import { cn } from "@/lib/utils";

type ToolTargetProps = {
  target: string;
  inBackground?: boolean;
  targetClassName?: string;
  suffixClassName?: string;
};

/// Keeps a background-command suffix visible while the command itself takes
/// whatever width remains in the transcript row.
export default function ToolTarget({
  target,
  inBackground = false,
  targetClassName,
  suffixClassName,
}: ToolTargetProps) {
  return (
    <span className="flex min-w-0 max-w-fit items-baseline gap-1.5">
      <span className={cn("min-w-0 truncate font-mono", targetClassName)}>{target}</span>
      {inBackground && (
        <span className={cn("shrink-0 font-sans", suffixClassName)}>in the background</span>
      )}
    </span>
  );
}
