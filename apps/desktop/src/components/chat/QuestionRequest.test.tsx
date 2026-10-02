import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import QuestionRequest from "@/components/chat/QuestionRequest";
import type { Question } from "@/types/events";

const question: Question = {
  question: "Which should I **push**?",
  header: null,
  multiSelect: false,
  options: [
    {
      label: "Push **main** with both commits",
      description: "Keep `main` as-is.",
      preview: null,
    },
    {
      label: "Push only this change",
      description: null,
      preview: null,
    },
  ],
};

describe("QuestionRequest", () => {
  it("renders Markdown in questions, option labels, and descriptions", () => {
    const html = renderToStaticMarkup(
      <QuestionRequest questions={[question]} onAnswer={() => {}} />,
    );

    expect(html).toMatch(/data-streamdown="strong">push<\/span>/);
    expect(html).toMatch(/data-streamdown="strong">main<\/span>/);
    expect(html).toMatch(/data-streamdown="inline-code">main<\/code>/);
  });

  it("centers shortcut numbers in the option row without borders", () => {
    const html = renderToStaticMarkup(
      <QuestionRequest questions={[question]} onAnswer={() => {}} />,
    );
    const shortcuts =
      html.match(/<span(?=[^>]*data-slot="questionnaire-choice-shortcut")[^>]*>/g) ?? [];

    expect(shortcuts).toHaveLength(2);
    for (const shortcut of shortcuts) {
      expect(shortcut).toContain("self-center");
      expect(shortcut).toContain("border-0");
      expect(shortcut).not.toContain("border-input");
      expect(shortcut).not.toContain("translate-y");
    }
  });
});
