import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { ApprovalPolicy } from "@/types/events";

/// Listed top-down as the menu renders them, which puts `auto` — the default and
/// the most-used — nearest the trigger at the bottom of the screen.
///
/// Two omissions: `default`, which the CLI reports but its flag rejects, and
/// `dontAsk`, which overlaps `auto` closely enough that offering both only
/// invites picking the wrong one.
const MODES: { id: ApprovalPolicy; label: string }[] = [
  { id: "bypassPermissions", label: "Bypass permissions" },
  { id: "manual", label: "Ask every time" },
  { id: "acceptEdits", label: "Accept edits" },
  { id: "plan", label: "Plan" },
  { id: "auto", label: "Auto" },
];

/// What Shift+Tab cycles through, low to high autonomy. A deliberate subset of
/// [`MODES`]: a blind chord shouldn't be able to land on bypass-permissions, and
/// "ask every time" is a deliberate choice rather than somewhere to pass through.
export const CYCLE: ApprovalPolicy[] = ["plan", "acceptEdits", "auto"];

/// Next mode in the Shift+Tab cycle. A mode outside the cycle enters it at the
/// start rather than being stuck.
export function nextPermissionMode(current: ApprovalPolicy): ApprovalPolicy {
  const i = CYCLE.indexOf(current);
  return i === -1 ? CYCLE[0] : CYCLE[(i + 1) % CYCLE.length];
}

export default function PermissionSelector({
  value,
  onChange,
}: {
  value: ApprovalPolicy;
  onChange: (mode: ApprovalPolicy) => void;
}) {
  const selected = MODES.find((m) => m.id === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-1.5 text-ui text-muted-foreground"
        >
          {selected?.label ?? "Permissions"}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-44">
        {/* In the menu rather than a tooltip on the trigger: the trigger opens
            on hover, so a tooltip there could never be seen without the menu
            covering it. Here the hint appears exactly when the modes do. */}
        <DropdownMenuLabel className="flex py-1 font-normal">
          <KbdGroup>
            <Kbd>⇧</Kbd>
            <Kbd>Tab</Kbd>
          </KbdGroup>
        </DropdownMenuLabel>

        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as ApprovalPolicy)}
        >
          {MODES.map((mode) => (
            <DropdownMenuRadioItem
              key={mode.id}
              value={mode.id}
              className={cn(
                "text-ui",
                // It turns off every permission check; the picker should say so
                // before the click, not after.
                mode.id === "bypassPermissions" && "text-destructive",
              )}
            >
              {mode.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
