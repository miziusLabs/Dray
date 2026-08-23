import Image from "next/image";
import { LazyVideo } from "@/components/LazyVideo";
import { MEDIA, mediaKey } from "@/lib/media";

/// The board: every capture of the app, in one masonry run.
///
/// CSS columns rather than a grid. Every capture today is 1.6:1, so a grid
/// would look identical — but the moment a portrait shot or a cropped detail
/// lands in `MEDIA`, columns absorb it at its own height where a fixed-row
/// grid would have to letterbox or crop it. The layout is the part that
/// should not need editing when the board grows.
export function Board({ className }: { className?: string }) {
  if (MEDIA.length === 0) return null;

  return (
    <section className={className}>
      {/* Two columns, not three. A capture of a desktop app is only legible
          at a certain size, and at three columns each tile was ~450px wide —
          the transcript inside it unreadable, so the tile said nothing. Two
          also sidesteps the balancing artefact three has at small counts:
          CSS columns minimises height, so four items across three columns
          resolves to 2+2+0 and leaves a visibly empty column. */}
      <div className="columns-1 gap-3 sm:columns-2 sm:gap-4">
        {MEDIA.map((item, i) => (
          <div
            key={mediaKey(item)}
            // `bg-card` under everything so a tile occupies its space as a
            // surface while the poster or image decodes, rather than as a hole.
            className="mb-3 break-inside-avoid overflow-hidden rounded-xl border border-border bg-card sm:mb-4"
          >
            {item.kind === "video" ? (
              <LazyVideo
                src={item.src}
                poster={item.poster}
                alt={item.alt}
                className="block w-full"
              />
            ) : (
              <Image
                src={item.src}
                alt={item.alt}
                // The lead tile is what the page is judged on before anything
                // else has loaded, so it skips lazy loading. Keyed off position
                // rather than a flag in the data: whatever leads should get
                // this, and one less thing to remember when the board grows.
                priority={i === 0}
                // Has to describe the tile, not the viewport, or the
                // preload `priority` emits picks one srcset candidate and
                // layout then picks another — the lead image downloads
                // twice. One column inside `px-4` below 640px, two inside
                // `px-6` with a 16px gutter above it, capped by the shell.
                sizes="(max-width: 639px) calc(100vw - 32px), (max-width: 1600px) calc((100vw - 64px) / 2), 768px"
                className="block h-auto w-full"
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
