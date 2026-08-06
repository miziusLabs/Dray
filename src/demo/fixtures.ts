import type { AgentEvent, AgentEventPayload, Model } from "@/types/events";

/// Hand-built events covering every payload variant the transcript renders.
/// Shapes follow real captured CLI output — notably `title: null` on every tool
/// call, which is why rows derive their own summary from `input`.

let seq = 0;

function event(payload: AgentEventPayload, subagentId?: string, label?: string): AgentEvent {
  return {
    id: `demo-${seq}`,
    sessionId: "demo",
    harness: "claude_code",
    seq: seq++,
    ts: new Date(0).toISOString(),
    turnId: null,
    subagent: subagentId ? { id: subagentId, label: label ?? null } : null,
    payload,
    raw: null,
  };
}

const AGENT_CALL = "toolu_demo_agent";

const MARKDOWN = `Here's what I found in the codebase.

## Blog pipeline

Posts are markdown on disk, parsed at build time:

\`\`\`typescript
export async function getPost(slug: string): Promise<Post> {
  const raw = await fs.readFile(path.join(POSTS, \`\${slug}.md\`), "utf8");
  const { data, content } = matter(raw);
  return { ...data, html: marked(content) } as Post;
}
\`\`\`

| Stage | Location | Cached |
|-------|----------|--------|
| Parse | \`lib/blog.js\` | yes |
| Render | \`app/[blogId]\` | no |

Key points:

1. \`gray-matter\` handles frontmatter
2. \`marked\` renders to HTML
3. Prism highlights server-side

> Highlighting runs at build time, so no client JS ships for it.

See \`lib/blog.js\` for the full [implementation](https://example.com).`;

export const DEMO_EVENTS: AgentEvent[] = [
  event({
    type: "turn_started",
    cwd: "/Users/yogesh/Documents/yogesh",
    model: "claude-opus-4-5",
    harnessVersion: "2.1.201",
    tools: ["Bash", "Read", "Edit", "Task"],
    mcpServers: [{ name: "context7", status: "connected" }],
    subagentTypes: ["Explore", "Plan"],
    settings: null,
  }),

  event({
    type: "user_message",
    text: "How does the blog work? Check the repo and summarize.",
    images: [{ path: "/Users/yogesh/screenshots/blog.png", url: null, mimeType: "image/png" }],
  }),

  event({
    type: "reasoning",
    block: null,
    encrypted: false,
    text: "The user wants an overview of the blog implementation. I should search for blog-related files first, then read the main module to understand how posts are loaded and rendered. A subagent is a good fit for the exploration since it's a broad sweep across many files, and I only need the conclusion rather than every file I touched along the way.",
  }),

  event({
    type: "tool_call_started",
    callId: "call_bash_1",
    name: "Bash",
    toolType: "shell",
    input: { command: 'find . -type f -name "*blog*" | head -20' },
    rawInput: null,
    title: null,
  }),
  event({
    type: "tool_call_completed",
    callId: "call_bash_1",
    result: {
      text: "./lib/blog.js\n./app/[blogId]/page.tsx\n./content/blog/hello-world.md\n./content/blog/second-post.md",
      isError: false,
      structured: null,
      exitCode: 0,
      durationMs: 340,
    },
  }),

  event({
    type: "tool_call_started",
    callId: "call_read_1",
    name: "Read",
    toolType: "file_read",
    input: { file_path: "/Users/yogesh/Documents/yogesh/lib/blog.js" },
    rawInput: null,
    title: null,
  }),
  event({
    type: "tool_call_completed",
    callId: "call_read_1",
    result: {
      text: Array.from({ length: 40 }, (_, i) => `${i + 1}\timport line ${i} from 'somewhere';`).join("\n"),
      isError: false,
      structured: null,
      exitCode: null,
      durationMs: 12,
    },
  }),

  event({
    type: "tool_call_started",
    callId: "call_bash_fail",
    name: "Bash",
    toolType: "shell",
    input: { command: "pnpm test --filter blog" },
    rawInput: null,
    title: null,
  }),
  event({
    type: "tool_call_completed",
    callId: "call_bash_fail",
    result: {
      text: "FAIL  lib/blog.test.js\n  ● getPost › throws on missing slug\n\n    Expected: rejects\n    Received: undefined",
      isError: true,
      structured: null,
      exitCode: 1,
      durationMs: 4200,
    },
  }),

  // The spawn call the subagent envelope correlates against.
  event({
    type: "tool_call_started",
    callId: AGENT_CALL,
    name: "Agent",
    toolType: "subagent_spawn",
    input: {
      description: "Explore blog implementation",
      subagent_type: "Explore",
      prompt: "Search for blog-related files and report how posts are loaded.",
    },
    rawInput: null,
    title: null,
  }),

  event({ type: "subagent_started", agentId: "aa402df", label: "Explore", description: "Explore blog implementation", prompt: "Search for blog-related files…" }, AGENT_CALL, "Explore"),
  event({ type: "tool_call_started", callId: "sub_1", name: "Bash", toolType: "shell", input: { command: "rg -l 'gray-matter'" }, rawInput: null, title: null }, AGENT_CALL, "Explore"),
  event({ type: "tool_call_completed", callId: "sub_1", result: { text: "lib/blog.js\npackage.json", isError: false, structured: null, exitCode: 0, durationMs: 88 } }, AGENT_CALL, "Explore"),
  event({ type: "subagent_progress", agentId: "aa402df", description: "Reading lib/blog.js", lastTool: "Read", usage: null }, AGENT_CALL, "Explore"),
  event({ type: "tool_call_started", callId: "sub_2", name: "Read", toolType: "file_read", input: { file_path: "/Users/yogesh/Documents/yogesh/lib/blog.js" }, rawInput: null, title: null }, AGENT_CALL, "Explore"),
  event({ type: "tool_call_completed", callId: "sub_2", result: { text: "import matter from 'gray-matter';\nimport { marked } from 'marked';", isError: false, structured: null, exitCode: null, durationMs: 9 } }, AGENT_CALL, "Explore"),
  event({ type: "assistant_text", block: null, text: "Posts live in `content/blog` as markdown with frontmatter, parsed by `lib/blog.js`." }, AGENT_CALL, "Explore"),
  event({
    type: "subagent_completed",
    agentId: "aa402df",
    status: "completed",
    summary: "Blog posts are markdown files parsed with gray-matter.",
    usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, reasoningTokens: null, totalTokens: 27160, costUsd: null, contextWindow: null, rateLimit: null, model: null },
  }, AGENT_CALL, "Explore"),

  event({
    type: "tool_call_completed",
    callId: AGENT_CALL,
    result: { text: "Agent completed.", isError: false, structured: null, exitCode: null, durationMs: 18400 },
  }),

  event({
    type: "file_edits",
    callId: null,
    edits: [
      {
        path: "/Users/yogesh/Documents/yogesh/lib/blog.js",
        change: "update",
        unifiedDiff:
          "--- a/lib/blog.js\n+++ b/lib/blog.js\n@@ -12,7 +12,9 @@\n export async function getPost(slug) {\n-  const raw = fs.readFileSync(file, 'utf8');\n+  if (!slug) throw new Error('slug required');\n+  const raw = await fs.promises.readFile(file, 'utf8');\n   const { data, content } = matter(raw);\n   return { ...data, html: marked(content) };\n }",
      },
      { path: "/Users/yogesh/Documents/yogesh/lib/blog.test.js", change: "add", unifiedDiff: null },
    ],
  }),

  event({ type: "assistant_text", block: null, text: MARKDOWN }),

  event({ type: "hook", name: "PostToolUse:format", event: "PostToolUse", phase: "finished", exitCode: 1, outcome: "prettier not found" }),
  event({ type: "context_compacted", message: null, windowNumber: 2 }),
  event({ type: "settings_changed", model: "claude-opus-4-5", approvalPolicy: "acceptEdits", sandbox: null, writableRoots: [], networkAccess: null, fastMode: null }),
  event({ type: "unknown", harnessType: "some_future_event" }),
  event({ type: "error", source: "harness", message: "Rate limit reached. Retrying in 20s.", fatal: false }),

  // `finalText` is a verbatim copy of the turn's last `assistant_text` — the
  // real mapper sets it that way, and the collapsed turn renders it in that
  // message's place rather than alongside it.
  event({
    type: "turn_completed",
    status: "success",
    stopReason: "end_turn",
    finalText: MARKDOWN,
    durationMs: 42_800,
    usage: {
      inputTokens: 3, outputTokens: 1840, cachedInputTokens: 17632, cacheWriteTokens: 12292,
      reasoningTokens: null, totalTokens: 19775, costUsd: 0.2643,
      contextWindow: { usedTokens: 48210, maxTokens: 200000 },
      rateLimit: null, model: "claude-opus-4-5",
    },
  }),

  // A second turn, so the demo shows more than one collapsible block.
  event({ type: "user_message", text: "Add a test for the missing-slug case.", images: [] }),
  event({
    type: "tool_call_started",
    callId: "call_edit_2",
    name: "Edit",
    toolType: "file_edit",
    input: { file_path: "/Users/yogesh/Documents/yogesh/lib/blog.test.js" },
    rawInput: null,
    title: null,
  }),
  event({
    type: "tool_call_completed",
    callId: "call_edit_2",
    result: { text: "Applied 1 edit.", isError: false, structured: null, exitCode: null, durationMs: 22 },
  }),
  event({ type: "assistant_text", block: null, text: "Added the case and re-ran the suite." }),
  event({
    type: "turn_completed",
    status: "success",
    stopReason: "end_turn",
    finalText: "Added the case and re-ran the suite.",
    durationMs: 8_100,
    usage: {
      inputTokens: 2, outputTokens: 210, cachedInputTokens: 19000, cacheWriteTokens: 0,
      reasoningTokens: null, totalTokens: 19212, costUsd: 0.0412,
      contextWindow: null, rateLimit: null, model: "claude-opus-4-5",
    },
  }),
];

export const DEMO_MODELS: Model[] = [
  { id: "opus", label: "Opus 5", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "high" },
  { id: "sonnet", label: "Sonnet 5", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "high" },
  { id: "haiku", label: "Haiku 4.5", efforts: [], defaultEffort: null },
];
