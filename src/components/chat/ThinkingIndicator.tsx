import { ThinkingOrb } from "thinking-orbs";

/// The gap-filler between the user's prompt landing and the turn's first
/// output. Both parts leave together the moment anything streams in — the
/// transcript's own content takes over as the sign that work is happening.
export default function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      {/* 20 and 64 are separately tuned designs rather than one scaled to the
          other, so 20 is the only inline-with-text option. `theme` is pinned
          because the orb's `auto` looks for `data-theme="dark|light"`, and this
          app stamps a palette name (`neutral`) there instead. */}
      <ThinkingOrb state="listening" size={20} theme="dark" aria-hidden />

      <span className="animate-shimmer bg-[linear-gradient(90deg,var(--color-muted-foreground)_35%,var(--color-foreground)_50%,var(--color-muted-foreground)_65%)] bg-[length:200%_100%] bg-clip-text text-chat text-transparent">
        Thinking...
      </span>
    </div>
  );
}
