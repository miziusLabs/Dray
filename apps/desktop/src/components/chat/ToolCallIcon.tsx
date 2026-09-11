import {
  BookOpen,
  Braces,
  Globe2,
  PenLine,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";

import { toolCategory } from "@/lib/tools";
import type { ToolType } from "@/types/events";

/// One restrained outline icon per normalized tool family. The reference uses
/// icons as category markers rather than statuses, so they never shimmer or
/// change when a call completes.
export default function ToolCallIcon({
  name,
  toolType,
  className = "size-[18px]",
}: {
  name: string;
  toolType: ToolType;
  className?: string;
}) {
  const props = {
    "aria-hidden": true,
    className: `${className} shrink-0 text-muted-foreground`,
    strokeWidth: 1.75,
  } as const;

  switch (toolCategory({ name, toolType })) {
    case "read":
      return <BookOpen {...props} />;
    case "command":
      return <SquareTerminal {...props} />;
    case "edit":
      return <PenLine {...props} />;
    case "search":
      return <Search {...props} />;
    case "web":
      return <Globe2 {...props} />;
    case "other":
      return toolType === "mcp" ? <Braces {...props} /> : <Wrench {...props} />;
  }
}
