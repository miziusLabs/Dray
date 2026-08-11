import { ThinkingOrb } from "thinking-orbs";

/// Standing notice that async subagents are still working — driven by the
/// latest `background_tasks_changed` set, so it outlives the turn that spawned
/// the tasks and leaves when the set drains. Info-only for now; opening the
/// task list from here comes later.
export default function BackgroundTasksIndicator({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      {/* Same 20px inline design as WorkingIndicator, `weaving` so the two
          read as different activities at a glance. Theme pinned for the same
          reason as there: the orb's `auto` expects `data-theme="dark|light"`
          and this app stamps a palette name instead. */}
      <ThinkingOrb state="weaving" size={20} theme="dark" aria-hidden />

      <span className="shimmer-text text-chat">
        {count} Background Task{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}
