import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { compactTokens } from "@/lib/format";
import { cn } from "@/lib/utils";

/// Where the ring stops being informational and starts being a warning. A
/// context this full is minutes from compacting, and a compaction costs a turn
/// and drops detail the user may still want — so it is worth reading before it
/// happens, not after.
const TIGHT = 0.8;
const METER_ANIMATION_MS = 500;

/// Animates tooltip values so a fresh context reading doesn't replace the old
/// number in one frame. A ref lets a new reading continue from the current
/// animation rather than jumping back to the previous target.
function useAnimatedNumber(target: number) {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const start = current.current;
    if (start === target) return;

    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / METER_ANIMATION_MS, 1);
      // Ease out so the value settles gently instead of stopping abruptly.
      const eased = 1 - (1 - progress) ** 3;
      const next = start + (target - start) * eased;
      current.current = next;
      setValue(next);

      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
}

/// How full the model's context is, as a ring in the composer's control row.
///
/// A ring rather than a number because the exact count is never what's wanted at
/// a glance — the question is "how much room is left", which is a proportion.
/// The count lives in the tooltip for when it is wanted.
export default function ContextMeter({ used, max }: { used: number; max: number }) {
  // A window can be exceeded on paper — the count includes the reply, which is
  // written after the prompt was admitted — and an arc past 100% wraps back to
  // looking empty.
  const fraction = max > 0 ? Math.min(used / max, 1) : 0;
  const percent = Math.round(fraction * 100);
  const tight = fraction >= TIGHT;
  const animatedUsed = useAnimatedNumber(used);
  const animatedMax = useAnimatedNumber(max);
  const animatedPercent = Math.round(
    (animatedMax > 0 ? Math.min(animatedUsed / animatedMax, 1) : 0) * 100,
  );

  // Geometry is in a 24-unit box scaled down by the SVG's own size, so the
  // stroke stays crisp at any display size and the numbers stay readable.
  const r = 9;
  const circumference = 2 * Math.PI * r;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Focusable so the count is reachable without a pointer, but not a
            button — there is nothing to press. */}
        <span
          tabIndex={0}
          role="img"
          aria-label={`Context ${percent}% full`}
          className="flex shrink-0 items-center px-1.5 focus:outline-none"
        >
          <svg
            viewBox="0 0 24 24"
            className={cn("size-3.5", tight ? "text-destructive" : "text-muted-foreground")}
            aria-hidden
          >
            <circle
              cx="12"
              cy="12"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              opacity="0.25"
            />
            {/* Rotated so the arc starts at twelve o'clock; SVG's own zero angle
                is three o'clock, which reads as a gauge that begins a quarter
                turn in. */}
            <circle
              cx="12"
              cy="12"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - fraction)}
              className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
              transform="rotate(-90 12 12)"
            />
          </svg>
        </span>
      </TooltipTrigger>

      <TooltipContent side="top" className="h-8 max-w-none whitespace-nowrap">
        {animatedPercent}% used · {compactTokens(Math.round(animatedUsed))} / {compactTokens(Math.round(animatedMax))} tokens
      </TooltipContent>
    </Tooltip>
  );
}
