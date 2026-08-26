import { AppleGlyph } from "@/components/AppleGlyph";
import { Board } from "@/components/Board";
// import { Tweets } from "@/components/Tweets";
import { Wordmark } from "@/components/Wordmark";
import { DOWNLOAD, DOWNLOAD_SIZE, PI_SETUP, REPO } from "@/lib/links";

/// One full-width container for the whole page. The pitch is short enough now
/// that it needs no reading measure of its own, and the board wants every
/// pixel — two widths would have put a seam across a page that is mostly one
/// continuous run of captures. Padding is flat, not responsive: it has to
/// match the board's own gap exactly, and a value that grew with the
/// viewport would drift out of step with one that doesn't.
const SHELL = "mx-auto w-full max-w-[1600px] px-3";

export default function Home() {
  return (
    <main className={SHELL}>
      {/* Left-aligned and deliberately shallow: the board below is what the
          page is actually for, and every line here is a line of it pushed
          off the first screen. The pitch is one sentence because a second
          one said nothing the captures do not show. No separate nav bar —
          the wordmark sits directly above the pitch it belongs to instead
          of a header row repeating it. Top inset is flat `pt-3`, matching
          the shell's own horizontal padding; the bottom one lives on the
          spacer past the board, for the same reason. */}
      <section className="pt-3 pb-6 sm:pb-8">
        <div className="mb-4 flex items-center gap-2.5 sm:mb-6">
          <Wordmark className="h-3.5 w-auto" />
        </div>

        <h1 className="text-nowrap font-mono text-base leading-tight font-medium tracking-tight ">
          Run every coding agent from one app.
        </h1>
        <p className="mt-1 text-nowrap text-sm text-muted-foreground sm:text-base">
          The CLIs you already have, on the subscription you already pay for. ADE with the best f*cking ux.
        </p>

        <div className="mt-5 flex items-center gap-3">
          <a
            href={DOWNLOAD}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            <AppleGlyph className="size-4" />
            Download for macOS
          </a>
          <span className="text-sm text-muted-foreground">{DOWNLOAD_SIZE}</span>
        </div>

        {/* The prerequisite and the licence were a paragraph each and are
            one line now — both are footnotes to the button above them, and
            stacked they read as terms rather than as a caption. "Supports"
            rather than "Requires": the app is built around Pi, and the word
            says so rather than reading as a permanent restriction. The GitHub
            link lives here now, on "open source", instead of repeating itself in a nav bar
            that otherwise held nothing but a wordmark and this same link. */}
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:text-sm">
          <span>
            Supports{" "}
            <a
              href={PI_SETUP}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-current"
            >
              Pi
            </a>
          </span>
          <span aria-hidden>·</span>
          <span>
            Free and{" "}
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-current"
            >
              open source
            </a>
            , Apache 2.0
          </span>
        </p>
      </section>

      <Board />

      {/* Parked, not dropped — two cards under a full-width board read as
          a different site starting. See src/components/Tweets.tsx. */}
      {/* <Tweets className="mx-auto mt-12 max-w-4xl px-6" /> */}

      <div className="h-3" />
    </main>
  );
}
