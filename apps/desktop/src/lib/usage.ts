import type { UsageDisplayMode } from "@/types/usage";

export function usageBarColorClass(
  displayedPercentage: number | null,
  displayMode: UsageDisplayMode,
): string {
  if (displayedPercentage === null) return "bg-primary";

  const remainingPercentage =
    displayMode === "left" ? displayedPercentage : 100 - displayedPercentage;

  if (remainingPercentage < 15) return "bg-red-500";
  if (remainingPercentage < 25) return "bg-yellow-500";
  return "bg-primary";
}
