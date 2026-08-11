import { useState } from "react";
import { ThinkingOrb } from "thinking-orbs";

const LABELS = ["Working", "Cooking", "Brewing"];

/// The gap-filler between the user's prompt landing and the turn's first
/// output. Both parts leave together the moment anything streams in — the
/// transcript's own content takes over as the sign that work is happening.
///
/// The label is deliberately not "Thinking": the harness has a real thinking
/// event that streams into `Reasoning`, and this covers the wait before any
/// output at all, which is usually not that.
export default function WorkingIndicator() {
  // Picked once per mount, so it's one word per wait rather than one per render.
  const [label] = useState(() => LABELS[Math.floor(Math.random() * LABELS.length)]);

  return (
    <div className="flex items-center gap-2" aria-live="polite">
      {/* 20 and 64 are separately tuned designs rather than one scaled to the
          other, so 20 is the only inline-with-text option. `theme` is pinned
          because the orb's `auto` looks for `data-theme="dark|light"`, and this
          app stamps a palette name (`neutral`) there instead. */}
      <ThinkingOrb state="listening" size={20} theme="dark" aria-hidden />

      <span className="shimmer-text text-chat">{label}...</span>
    </div>
  );
}
