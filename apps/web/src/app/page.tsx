import { AppleGlyph } from "@/components/AppleGlyph";
import { Board } from "@/components/Board";
import { ClaudeGlyph } from "@/components/ClaudeGlyph";
// import { Tweets } from "@/components/Tweets";
import { Wordmark } from "@/components/Wordmark";
import { CLAUDE_SETUP, DOWNLOAD, REPO } from "@/lib/links";

/// One full-width container for the whole page. The pitch is short enough now
/// that it needs no reading measure of its own, and the board wants every
/// pixel — two widths would have put a seam across a page that is mostly one
/// continuous run of captures.
const SHELL = "mx-auto w-full max-w-[1600px] px-4 sm:px-6";

export default function Home() {
  return (
    <>
      <div className={SHELL}>
        <nav className="flex h-12 items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Wordmark className="h-3.5 w-auto" />
            <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              Experimental
            </span>
          </div>
          <a
            href={REPO}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </nav>
      </div>

      <main className={SHELL}>
        {/* Centred and deliberately shallow: the board below is what the
            page is actually for, and every line here is a line of it pushed
            off the first screen. The pitch is one sentence because a second
            one said nothing the captures do not show. */}
        <section className="mx-auto max-w-2xl pt-6 pb-6 text-center sm:pt-10 sm:pb-8">
          <h1 className="font-mono text-base leading-tight font-medium tracking-tight text-balance sm:text-xl">
            Run every coding agent from one app.
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-pretty text-muted-foreground sm:text-base">
            The CLIs you already have, on the subscription you already pay for.
          </p>

          <a
            href={DOWNLOAD}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            <AppleGlyph className="size-4" />
            Download for macOS
          </a>

          {/* The prerequisite and the licence were a paragraph each and are
              one line now — both are footnotes to the button above them, and
              stacked they read as terms rather than as a caption. */}
          <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:text-sm">
            <ClaudeGlyph className="size-3.5 shrink-0" />
            <span>
              Requires{" "}
              <a
                href={CLAUDE_SETUP}
                className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-current"
              >
                Claude Code
              </a>
            </span>
            <span aria-hidden>·</span>
            <span>Free and open source, Apache 2.0</span>
          </p>
        </section>

        <Board />

        {/* Parked, not dropped — two cards under a full-width board read as
            a different site starting. See src/components/Tweets.tsx. */}
        {/* <Tweets className="mx-auto mt-12 max-w-4xl px-6" /> */}

        <div className="h-12 sm:h-16" />
      </main>
    </>
  );
}
