import { Archive, TriangleAlert } from "lucide-react";

import AssistantMessage from "@/components/chat/AssistantMessage";
import Reasoning from "@/components/chat/Reasoning";
import ToolCall from "@/components/chat/ToolCall";
import UserMessage from "@/components/chat/UserMessage";
import FileEdits from "@/components/chat/FileEdits";
import { cn } from "@/lib/utils";
import type { AgentEvent, ToolResult } from "@/types/events";

/// A quiet single line for the events that are context rather than content.
function Notice({
  icon: Icon,
  children,
  tone = "muted",
}: {
  icon: typeof Archive;
  children: React.ReactNode;
  tone?: "muted" | "destructive";
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-chat",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground/70",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </p>
  );
}

/// The one place event payloads become UI. Every variant is handled; the default
/// arm exists for a payload kind from a newer backend than this build.
export default function EventRow({
  event,
  resultByCallId,
  hideToolLabel = false,
}: {
  event: AgentEvent;
  /// Results keyed by call id, so a started call renders its own outcome without
  /// searching the event list itself.
  resultByCallId: Map<string, ToolResult>;
  /// Passed down by `ToolGroupRow`, whose header already names the tool.
  hideToolLabel?: boolean;
}) {
  const { payload } = event;

  switch (payload.type) {
    case "user_message":
      return <UserMessage text={payload.text} images={payload.images} />;

    case "assistant_text":
      return <AssistantMessage text={payload.text} />;

    case "reasoning":
      return <Reasoning text={payload.text} encrypted={payload.encrypted} />;

    case "tool_call_started":
      return (
        <ToolCall
          name={payload.name}
          toolType={payload.toolType}
          title={payload.title}
          input={payload.input}
          rawInput={payload.rawInput}
          result={resultByCallId.get(payload.callId)}
          hideLabel={hideToolLabel}
        />
      );

    // Rendered by the `tool_call_started` row it completes, via `resultByCallId`.
    case "tool_call_completed":
      return null;

    case "file_edits":
      return <FileEdits edits={payload.edits} />;

    case "error":
      return (
        <div className="flex items-start gap-2 text-chat text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 whitespace-pre-wrap">{payload.message}</span>
        </div>
      );

    case "turn_completed":
      // Only a failure earns a line. Cost and token counts are accounting, not
      // conversation, and belong in a session-level surface rather than after
      // every message.
      if (payload.status !== "error") return null;
      // A user abort ends the turn as an error on the wire (`aborted_streaming`
      // mid-response, `aborted_tools` mid-call), but the user did it on
      // purpose — reporting their own stop back as a failure is noise.
      if (payload.stopReason?.startsWith("aborted")) return null;
      return (
        <Notice icon={TriangleAlert} tone="destructive">
          Turn failed{payload.stopReason ? ` — ${payload.stopReason}` : ""}
        </Notice>
      );

    case "context_compacted":
      return (
        <Notice icon={Archive}>
          {payload.message ??
            `Context compacted${payload.windowNumber != null ? ` (window ${payload.windowNumber})` : ""}`}
        </Notice>
      );

    // Deliberately unrendered. Hooks, settings changes, and unrecognized event
    // kinds are harness plumbing the reader never acts on; session setup, token
    // counts, subagent lifecycle, and stream previews drive UI elsewhere (the
    // header, the subagent panel, the live block).
    case "hook":
    case "settings_changed":
    case "unknown":
    case "turn_started":
    case "usage_update":
    case "subagent_started":
    case "subagent_progress":
    case "subagent_completed":
    case "background_tasks_changed":
    case "delta":
      return null;

    default:
      return null;
  }
}
