/// The user's own text, echoed from the event log rather than local state — the
/// backend synthesizes and persists it, so this renders the same live or replayed.
export default function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-xl bg-card px-3 py-2 text-chat whitespace-pre-wrap text-card-foreground">
        {text}
      </div>
    </div>
  );
}
