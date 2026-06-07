import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
} from "docx";
import type { IParagraphOptions } from "docx";
import type { ClientChatMessage } from "./chat-types";

type ExportLabels = {
  assistantLabel: string;
  entryLabel: string;
  languageExportLabel: string;
  languageLabel: string;
  savedLabel: string;
  startedFromLabel: string;
  userLabel: string;
};

type InlineChild = TextRun | ExternalHyperlink;

const numberedListReference = "streetlight-numbered-list";

function cleanText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\s+$/g, "");
}

function makeTextRun(
  text: string,
  options: { bold?: boolean; break?: number } = {},
) {
  return new TextRun({
    bold: options.bold,
    break: options.break,
    font: "Aptos",
    size: 24,
    text: cleanText(text),
  });
}

function makeTextRuns(text: string, options: { bold?: boolean } = {}) {
  return text.split("\n").map((line, index) =>
    makeTextRun(line, {
      ...options,
      break: index === 0 ? undefined : 1,
    }),
  );
}

function makeLinkRun(text: string, url: string) {
  return new ExternalHyperlink({
    children: [
      new TextRun({
        color: "1f5f43",
        font: "Aptos",
        size: 24,
        style: "Hyperlink",
        text: cleanText(text),
        underline: {
          type: UnderlineType.SINGLE,
        },
      }),
    ],
    link: url,
  });
}

function parseBoldText(text: string): InlineChild[] {
  const children: InlineChild[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text))) {
    if (match.index > cursor) {
      children.push(...makeTextRuns(text.slice(cursor, match.index)));
    }

    children.push(...makeTextRuns(match[1] ?? "", { bold: true }));
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    children.push(...makeTextRuns(text.slice(cursor)));
  }

  return children.length > 0 ? children : [makeTextRun("")];
}

function parseInlineMarkdown(text: string): InlineChild[] {
  const children: InlineChild[] = [];
  const linkPattern = /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(text))) {
    if (match.index > cursor) {
      children.push(...parseBoldText(text.slice(cursor, match.index)));
    }

    const label = match[1] ?? match[3] ?? "";
    let url = match[2] ?? match[3] ?? "";
    let trailing = "";

    while (/[.,;:!?]$/.test(url)) {
      trailing = `${url.at(-1)}${trailing}`;
      url = url.slice(0, -1);
    }

    children.push(makeLinkRun(label, url));

    if (trailing) {
      children.push(makeTextRun(trailing));
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    children.push(...parseBoldText(text.slice(cursor)));
  }

  return children.length > 0 ? children : [makeTextRun("")];
}

function makeParagraph(text: string, options: Partial<IParagraphOptions> = {}) {
  return new Paragraph({
    children: parseInlineMarkdown(text),
    spacing: {
      after: 160,
      before: 0,
      line: 320,
    },
    ...options,
  });
}

function makePlainParagraph(text: string, options: Partial<IParagraphOptions> = {}) {
  return new Paragraph({
    children: [makeTextRun(text)],
    spacing: {
      after: 120,
      before: 0,
      line: 300,
    },
    ...options,
  });
}

function makeTitle(text: string) {
  return new Paragraph({
    children: [
      new TextRun({
        bold: true,
        font: "Aptos",
        size: 36,
        text,
      }),
    ],
    spacing: {
      after: 220,
    },
  });
}

function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const paragraphBuffer: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inCodeBlock = false;

  function flushParagraph() {
    const text = paragraphBuffer.join("\n").trim();
    paragraphBuffer.length = 0;

    if (text) {
      paragraphs.push(makeParagraph(text));
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              font: "Courier New",
              size: 22,
              text: line,
            }),
          ],
          spacing: {
            after: 80,
          },
        }),
      );
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);

    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1]?.length ?? 2;
      paragraphs.push(
        makeParagraph(headingMatch[2] ?? "", {
          heading:
            level === 1
              ? HeadingLevel.HEADING_1
              : level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          spacing: {
            after: 160,
            before: 180,
          },
        }),
      );
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(trimmed);

    if (bulletMatch) {
      flushParagraph();
      paragraphs.push(
        makeParagraph(bulletMatch[1] ?? "", {
          bullet: {
            level: 0,
          },
        }),
      );
      continue;
    }

    const numberedMatch = /^\d+[.)]\s+(.+)$/.exec(trimmed);

    if (numberedMatch) {
      flushParagraph();
      paragraphs.push(
        makeParagraph(numberedMatch[1] ?? "", {
          numbering: {
            level: 0,
            reference: numberedListReference,
          },
        }),
      );
      continue;
    }

    paragraphBuffer.push(trimmed);
  }

  flushParagraph();

  return paragraphs;
}

function buildDocument(title: string, children: Paragraph[]) {
  return new Document({
    creator: "Streetlight",
    description: "Streetlight local export",
    numbering: {
      config: [
        {
          levels: [
            {
              alignment: AlignmentType.LEFT,
              format: LevelFormat.DECIMAL,
              level: 0,
              style: {
                paragraph: {
                  indent: {
                    hanging: 360,
                    left: 720,
                  },
                },
              },
              text: "%1.",
            },
          ],
          reference: numberedListReference,
        },
      ],
    },
    sections: [
      {
        children,
        properties: {},
      },
    ],
    title,
  });
}

function metadataParagraphs(labels: ExportLabels): Paragraph[] {
  const savedAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  return [
    makePlainParagraph(`${labels.savedLabel}: ${savedAt}`),
    makePlainParagraph(`${labels.startedFromLabel}: ${labels.entryLabel}`),
    makePlainParagraph(`${labels.languageExportLabel}: ${labels.languageLabel}`),
    makePlainParagraph(""),
  ];
}

export async function buildAnswerDocxBlob({
  labels,
  text,
  title,
}: {
  labels: ExportLabels;
  text: string;
  title: string;
}) {
  const doc = buildDocument(title, [
    makeTitle(title),
    ...metadataParagraphs(labels),
    ...markdownToDocxParagraphs(text.trim()),
  ]);

  return Packer.toBlob(doc);
}

export async function buildConversationDocxBlob({
  labels,
  messages,
  title,
}: {
  labels: ExportLabels;
  messages: ClientChatMessage[];
  title: string;
}) {
  const children: Paragraph[] = [makeTitle(title), ...metadataParagraphs(labels)];

  for (const message of messages) {
    const text = message.text.trim();

    if (!text) {
      continue;
    }

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            bold: true,
            font: "Aptos",
            size: 26,
            text:
              message.role === "assistant"
                ? labels.assistantLabel
                : labels.userLabel,
          }),
        ],
        spacing: {
          after: 120,
          before: 180,
        },
      }),
    );
    children.push(...markdownToDocxParagraphs(text));
  }

  const doc = buildDocument(title, children);

  return Packer.toBlob(doc);
}
