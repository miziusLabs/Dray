import { describe, expect, it } from "vitest";

import { walk } from "./markdownPlugins";

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

describe("rehype file paths", () => {
  it("marks bare paths and carries their line locator", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          children: [{ type: "text", value: "see src/lib/a.ts:12 now" }],
        },
      ],
    };

    walk(tree);

    const children = tree.children?.[0].children ?? [];
    expect(children[1].properties).toMatchObject({
      className: ["dray-file-path"],
      title: "src/lib/a.ts",
      dataLine: "12",
    });
    expect(children[1].children).toEqual([{ type: "text", value: "src/lib/a.ts:12" }]);
  });

  it("converts a markdown path link and keeps its locator", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          children: [
            {
              type: "element",
              tagName: "a",
              properties: { href: "src/a.ts:L2" },
              children: [{ type: "text", value: "a.ts:2" }],
            },
          ],
        },
      ],
    };

    walk(tree);

    expect(tree.children?.[0].children?.[0].properties).toMatchObject({
      title: "src/a.ts",
      dataLine: "2",
    });
  });

  it("does not search inside existing links or code", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          children: [
            { type: "element", tagName: "a", children: [{ type: "text", value: "src/a.ts" }] },
            { type: "text", value: " and " },
            { type: "element", tagName: "pre", children: [{ type: "text", value: "src/b.ts" }] },
          ],
        },
      ],
    };

    walk(tree);

    expect(tree.children?.[0].children?.[0].tagName).toBe("a");
    expect(tree.children?.[0].children?.[2].tagName).toBe("pre");
  });
});
