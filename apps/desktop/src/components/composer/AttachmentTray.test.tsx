import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import AttachmentTray from "@/components/composer/AttachmentTray";
import type { Attachment } from "@/types/events";

const file = (path: string, name: string): Attachment => ({
  path,
  name,
  mimeType: "text/plain",
  size: 100,
  isImage: false,
  preview: null,
});

const image: Attachment = {
  path: "/tmp/preview.png",
  name: "preview.png",
  mimeType: "image/png",
  size: 100,
  isImage: true,
  preview: "data:image/png;base64,preview",
};

describe("AttachmentTray", () => {
  it("stacks normal files to match the height of an image tile", () => {
    const html = renderToStaticMarkup(
      <AttachmentTray
        attachments={[
          file("/tmp/first.txt", "first.txt"),
          file("/tmp/second.txt", "second.txt"),
          image,
        ]}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain('class="flex flex-wrap items-start gap-1"');
    expect(html).toContain('class="flex flex-col gap-1"');
    expect(html.match(/h-7/g)).toHaveLength(2);
    expect(html).toContain('class="size-[60px] rounded-lg bg-card object-cover"');
    expect(html.indexOf("first.txt")).toBeLessThan(html.indexOf("second.txt"));
  });

  it("shortens long file names to 20 characters", () => {
    const html = renderToStaticMarkup(
      <AttachmentTray
        attachments={[file("/tmp/long-name.txt", "abcdefghijklmnopqrs.txt")]}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain(">abcdefghijklmnopq...</span>");
    expect(html).not.toContain(">abcdefghijklmnopqrs.txt</span>");
  });
});
