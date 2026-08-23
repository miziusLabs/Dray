import type { StaticImageData } from "next/image";
import screenshot from "../../public/screenshot.png";

/// A tile on the board.
///
/// Images are static imports so the build reads their dimensions and the tile
/// reserves its space before the file arrives. Videos carry a plain `/public`
/// path instead — Next has no loader for mp4, so only the poster goes through
/// the image pipeline.
export type MediaItem =
  | { kind: "video"; src: string; poster: string; alt: string }
  | { kind: "image"; src: StaticImageData; alt: string };

/// The board, in the order it flows into the masonry columns.
///
/// Adding a capture is one entry here and nothing else. Images want a static
/// import at the top of this file; videos want a poster generated first, by
/// `./scripts/posters.sh`.
///
/// Order is the only priority signal there is: the first entry is the one the
/// page loads eagerly, so it should stay something that paints fast and shows
/// the whole app at once. That is why the screenshot leads and the videos,
/// which are fetched lazily, follow it.
export const MEDIA: MediaItem[] = [
  {
    kind: "image",
    src: screenshot,
    alt: "Dray showing a session transcript beside a per-turn diff of the files that turn changed",
  },
  {
    kind: "video",
    src: "/tag-files-dray.mp4",
    poster: "/posters/tag-files-dray.jpg",
    alt: "Typing @ in the composer to attach files from the repo",
  },
  {
    kind: "video",
    src: "/user-message-list-dray.mp4",
    poster: "/posters/user-message-list-dray.jpg",
    alt: "Stepping back through earlier messages in a session",
  },
  {
    kind: "video",
    src: "/project-switch-dray.mp4",
    poster: "/posters/project-switch-dray.jpg",
    alt: "Switching between attached projects from the sidebar",
  },
];

/// Stable per-tile key. An image's `src` is an object after the static import,
/// so it cannot be used as a React key the way a video's path can.
export function mediaKey(item: MediaItem): string {
  return item.kind === "image" ? item.src.src : item.src;
}
