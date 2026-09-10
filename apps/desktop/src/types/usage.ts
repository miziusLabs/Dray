export type UsageDisplayMode = "left" | "used";

export type CodexUsageWindow = {
  percentage: number;
  resetAt: number | null;
};

export type CodexUsage = {
  fiveHour: CodexUsageWindow | null;
  weekly: CodexUsageWindow | null;
};
