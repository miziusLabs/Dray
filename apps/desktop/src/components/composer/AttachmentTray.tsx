import { useState } from "react";
import { X } from "lucide-react";

import FileIcon from "@/components/FileIcon";
import ImageLightbox from "@/components/chat/ImageLightbox";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/events";

/// What is pinned to the composer, drawn above the text it will be sent with.
///
/// Two presentations for two things that travel differently. An image goes down
/// the wire as pixels, so it is shown as pixels — a thumbnail is the only label
/// a screenshot has. Anything else is handed to the model as a path, so it gets
/// the row a path deserves: the type glyph, the name, and the size. Only image
/// tiles open, using the in-app lightbox; a file tile is just a description of
/// what will be sent.
///
const MAX_DISPLAY_NAME_LENGTH = 20;

function displayAttachmentName(name: string) {
  if (name.length <= MAX_DISPLAY_NAME_LENGTH) return name;

  return `${name.slice(0, MAX_DISPLAY_NAME_LENGTH - 3)}...`;
}

/// Normal files share a column and stack with a small gap, while additional
/// images stay beside that column.
export default function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (path: string) => void;
}) {
  const [openImage, setOpenImage] = useState<Attachment | null>(null);

  if (!attachments.length) return null;

  const fileAttachments = attachments.filter((attachment) => !attachment.preview);
  const imageAttachments = attachments.filter(
    (attachment): attachment is Attachment & { preview: string } => Boolean(attachment.preview),
  );

  const renderRemoveButton = (attachment: Attachment) => (
    // Hidden until the tile is hovered or the button itself is focused, so a
    // full tray isn't a row of X's — but it stays reachable by keyboard, which
    // `opacity` alone (unlike `hidden`) preserves.
    <button
      type="button"
      onClick={() => onRemove(attachment.path)}
      aria-label={`Remove ${attachment.name}`}
      className={cn(
        "absolute -top-1.5 -right-1.5 rounded-full border-0 bg-secondary p-0.5 text-secondary-foreground opacity-0 transition-opacity",
        "group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none",
      )}
    >
      <X className="size-3" strokeWidth={2.5} />
    </button>
  );

  return (
    // Spacing from the composer is the caller's, which is the only side that
    // knows what sits below it.
    <>
      <ul className="flex flex-wrap items-start gap-1">
        {fileAttachments.length > 0 && (
          <li>
            <ul className="flex flex-col gap-1">
              {fileAttachments.map((attachment) => (
                <li
                  key={attachment.path}
                  // `group` so one hover lights the remove button on this tile alone.
                  // Deliberately no `title`: the path is the one thing the reader
                  // already knows — they picked the file a second ago — so a hover
                  // tooltip is a system popup reporting back what they just did.
                  className="group relative"
                >
                  <div className="flex h-7 max-w-56 items-center gap-1 rounded-lg bg-card pr-1.5 pl-1">
                    <FileIcon path={attachment.path} className="size-5 rounded-lg" />

                    {/* `min-w-0` so the name truncates instead of setting the tile's
                        floor and pushing the rest out of the box. */}
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-ui">{displayAttachmentName(attachment.name)}</span>
                      {/* Hidden rather than deleted. A size is what a file manager
                          owes you before you open something; here the file is already
                          attached and the number changes no decision. Kept wired up
                          because the judgement is about the tile, not the figure. */}
                      <span className="hidden text-ui text-muted-foreground/70">
                        {formatBytes(attachment.size)}
                      </span>
                    </div>
                  </div>
                  {renderRemoveButton(attachment)}
                </li>
              ))}
            </ul>
          </li>
        )}

        {imageAttachments.map((attachment) => (
          <li key={attachment.path} className="group relative">
            <button
              type="button"
              onClick={() => setOpenImage(attachment)}
              aria-label={`Preview ${attachment.name}`}
              className="block cursor-zoom-in rounded-lg border-0 bg-transparent p-0 text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src={attachment.preview}
                alt={attachment.name}
                className="size-[60px] rounded-lg bg-card object-cover"
              />
            </button>
            {renderRemoveButton(attachment)}
          </li>
        ))}
      </ul>

      <ImageLightbox
        images={openImage?.preview ? [{ src: openImage.preview, name: openImage.name }] : []}
        index={openImage?.preview ? 0 : null}
        onIndex={() => {}}
        onClose={() => setOpenImage(null)}
      />
    </>
  );
}
