import { ThinkingOrb } from "thinking-orbs";

/// Encrypted reasoning carries no readable text, so it renders nothing rather
/// than an empty block. Active reasoning shows a non-interactive status orb;
/// settled reasoning is omitted so it does not leave an empty transcript row.
export default function Reasoning({
  text,
  encrypted,
  streaming = false,
}: {
  text: string;
  encrypted: boolean;
  streaming?: boolean;
}) {
  if (encrypted || !text.trim()) return null;

  if (streaming) {
    return (
      <div className="flex items-center gap-1.5 text-chat text-muted-foreground">
        <ThinkingOrb state="composing" size={20} theme="dark" aria-hidden />
        <span>Thinking</span>
      </div>
    );
  }

  // Settled reasoning is intentionally not rendered. Returning null here avoids
  // leaving a blank row behind once the live orb is replaced by the final answer.
  return null;
}
