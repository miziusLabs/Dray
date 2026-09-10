import { Markdown } from "@/components/chat/Markdown";

/// Full-width and unbubbled assistant output. Bare paths in agent prose are
/// resolved against the session that produced the message.
export default function AssistantMessage({
  text,
  streaming = false,
  cwd = null,
}: {
  text: string;
  streaming?: boolean;
  cwd?: string | null;
}) {
  return <Markdown streaming={streaming} cwd={cwd} linkFilePaths>{text}</Markdown>;
}
