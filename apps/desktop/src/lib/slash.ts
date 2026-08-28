/// Where the composer's slash-command picker opens, what it filters to, and how
/// a pick lands back in the text.
///
/// Pure and separated from the component for the same reason [streaming.ts]
/// is: the caret arithmetic is the part that can be wrong in ways a glance at
/// the UI won't catch, and it is cheap to pin.
///
/// [streaming.ts]: ./streaming.ts
import type { SlashCommand } from "@/types/events";

type InvocationSpan = {
  start: number;
  end: number;
  prefix: "/" | "$";
};

function invocationSpan(text: string, caret: number): InvocationSpan | null {
  if (caret < 1 || caret > text.length) return null;

  let start = caret - 1;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;

  const prefix = text[start];
  // Commands remain a whole-prompt construct. Skills can be referenced at the
  // start of any word, which mirrors how @file mentions work in prose.
  if (prefix !== "$" && !(prefix === "/" && start === 0)) return null;

  let end = start + 1;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  if (caret > end) return null;

  return { start, end, prefix };
}

/// The command or skill name being typed, or `null` when the caret isn't in one.
///
/// Slash commands must lead the prompt, while `$skills` can open at any word.
/// This keeps slashes in paths inert without limiting skills to command syntax.
export function slashQuery(text: string, caret: number): string | null {
  const span = invocationSpan(text, caret);
  return span ? text.slice(span.start + 1, span.end) : null;
}

export function slashPrefix(text: string, caret: number): "/" | "$" | null {
  return invocationSpan(text, caret)?.prefix ?? null;
}

/// Commands matching `query`, best first.
///
/// Ranked rather than filtered so a typed prefix beats a chance mention in some
/// other command's description. The sort is stable and an empty query scores
/// every command alike, so "just opened" shows the CLI's own ordering — which
/// groups user commands ahead of built-ins — rather than a re-alphabetized list.
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();

  return commands
    .map((command) => ({ command, score: score(command, q) }))
    .filter((match) => match.score !== null)
    .sort((a, b) => a.score! - b.score!)
    .map((match) => match.command);
}

/// Keeps the two invocation menus disjoint: `/` is for commands and `$` is for
/// skills. The same composer serves new sessions and follow-ups, so this must
/// be based on the typed prefix rather than on the composer's state.
export function filterCommandsByPrefix(
  commands: SlashCommand[],
  prefix: "/" | "$",
): SlashCommand[] {
  return commands.filter((command) => command.isSkill === (prefix === "$"));
}

/// `null` when the command doesn't match at all. Lower is better.
function score(command: SlashCommand, query: string): number | null {
  const name = command.name.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (command.aliases.some((alias) => alias.toLowerCase().startsWith(query))) return 1;

  // A namespaced command should still be findable by its bare half, so
  // `railway:deploy` matches "deploy" ahead of anything that only mentions it.
  if (name.slice(name.indexOf(":") + 1).startsWith(query)) return 2;
  if (name.includes(query)) return 3;
  if (command.description.toLowerCase().includes(query)) return 4;

  return null;
}

/// Replaces the command or skill being typed with its user-facing prefix.
export function applyCommand(
  text: string,
  name: string,
  isSkill = false,
  caret = text.length,
): { text: string; caret: number } {
  const span = invocationSpan(text, caret);
  const start = span?.start ?? 0;
  const end = span?.end ?? (text.search(/\s/) === -1 ? text.length : text.search(/\s/));
  const head = `${isSkill ? "$" : "/"}${name}`;
  const suffix = text.slice(end);
  const separator = suffix ? "" : " ";
  const caretOffset = separator || /^\s/.test(suffix) ? 1 : 0;

  return {
    text: text.slice(0, start) + head + separator + suffix,
    caret: start + head.length + caretOffset,
  };
}

/// Where a command came from, as far as the CLI will tell us.
///
/// The `initialize` payload carries no scope field — only `name`, `description`,
/// `argumentHint` and `aliases` — so this reads the signals recoverable from
/// the command and its description.
///
/// Skills are kept distinct so their `$` prefix survives every picker and
/// transcript surface. `harness` means a built-in command.
///
/// The description test is the fragile half, since it reads display text rather
/// than a field. It fails benignly — a reworded suffix files a command under the
/// wrong heading and changes nothing else — so it is not worth a sturdier scheme
/// that the wire doesn't support.
export type CommandSource = "harness" | "plugin" | "skill" | "user";

const SCOPE_SUFFIX = /\((?:user|project)\)\s*$/;

export function commandSource(command: SlashCommand): CommandSource {
  if (command.isSkill) return "skill";
  if (command.name.includes(":")) return "plugin";
  return SCOPE_SUFFIX.test(command.description) ? "user" : "harness";
}

/// A run of commands drawn together. `label` is set only where the grouping
/// isn't self-evident from the contents.
///
/// Structurally a `PickerGroup<SlashCommand>` — the field is `items` rather than
/// `commands` so it can be handed to the shared menu without a mapping step
/// whose only job would be renaming it.
export type CommandGroup = {
  label: string | null;
  items: SlashCommand[];
};

/// Kept short on purpose: the list shows seven rows at a time, so a longer
/// recents run would fill the window and leave nothing else visible — at which
/// point it stops being a shortcut and becomes the whole list.
const RECENT_LIMIT = 4;

/// The browse ordering: what you just used, then what came with the harness,
/// then everything installed.
///
/// A partition rather than an overlay — a command promoted into recents leaves
/// its own group. Showing it twice would spend two of seven visible rows saying
/// the same thing, and the groups below stay complete in the only sense that
/// matters, which is that every command is reachable exactly once.
///
/// Only used with no query. A search is ranked flat by
/// [`filterCommands`](#filterCommands): headers while filtering hide matches
/// behind section chrome, which turns "is my match on screen" into a scan.
export function groupCommands(commands: SlashCommand[], recent: string[]): CommandGroup[] {
  const byName = new Map(commands.map((command) => [command.name, command]));

  // Driven off the stored order, so recency ranks these; a name whose command
  // has since been uninstalled simply drops out.
  const recentCommands = recent
    .map((name) => byName.get(name))
    .filter((command): command is SlashCommand => command !== undefined)
    .slice(0, RECENT_LIMIT);

  const promoted = new Set(recentCommands.map((command) => command.name));
  const rest = commands.filter((command) => !promoted.has(command.name));

  return [
    { label: "Recently used", items: recentCommands },
    { label: null, items: rest.filter((c) => commandSource(c) === "harness") },
    { label: null, items: rest.filter((c) => commandSource(c) !== "harness") },
  ].filter((group) => group.items.length > 0);
}

/// Splits a sent leading command or skill into its name and arguments.
export function parseSlashCommand(text: string): { name: string; args: string } | null {
  const match = /^([/$])([^\s/]\S*)(.*)$/s.exec(text);
  if (!match) return null;

  return { name: match[2], args: match[3].trim() };
}

/// Finds the first skill reference in prose, for recents and transcript styling.
export function findSkillInvocation(
  text: string,
): { name: string; start: number; end: number } | null {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "$" || (start > 0 && !/\s/.test(text[start - 1]))) continue;

    let end = start + 1;
    while (end < text.length && !/\s/.test(text[end])) end += 1;
    if (end > start + 1) return { name: text.slice(start + 1, end), start, end };
  }

  return null;
}
