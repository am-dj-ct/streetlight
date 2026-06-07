import * as pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type {
  Content,
  ContentText,
  TDocumentDefinitions,
} from "pdfmake/interfaces";
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

type PdfTextRun = string | ContentText;

type ListState = {
  items: Content[];
  kind: "ol" | "ul";
  start?: number;
};

function cleanText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000b-\u001f\u007f]/g, "");
}

function makeTextRun(
  text: string,
  options: { bold?: boolean; link?: string } = {},
): PdfTextRun {
  const cleanedText = cleanText(text);

  if (!options.bold && !options.link) {
    return cleanedText;
  }

  return {
    bold: options.bold,
    color: options.link ? "#1f5f43" : undefined,
    decoration: options.link ? "underline" : undefined,
    link: options.link,
    text: cleanedText,
  };
}

function parseBoldText(text: string): PdfTextRun[] {
  const children: PdfTextRun[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text))) {
    if (match.index > cursor) {
      children.push(makeTextRun(text.slice(cursor, match.index)));
    }

    children.push(makeTextRun(match[1] ?? "", { bold: true }));
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    children.push(makeTextRun(text.slice(cursor)));
  }

  return children.length > 0 ? children : [""];
}

function parseInlineMarkdown(text: string): PdfTextRun[] {
  const children: PdfTextRun[] = [];
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

    children.push(makeTextRun(label, { link: url }));

    if (trailing) {
      children.push(makeTextRun(trailing));
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    children.push(...parseBoldText(text.slice(cursor)));
  }

  return children.length > 0 ? children : [""];
}

function makeParagraph(
  text: string,
  options: Partial<ContentText> = {},
): ContentText {
  return {
    lineHeight: 1.35,
    margin: [0, 0, 0, 8],
    preserveTrailingSpaces: true,
    text: parseInlineMarkdown(text),
    ...options,
  };
}

function makePlainParagraph(text: string, options: Partial<ContentText> = {}) {
  return makeParagraph(text, {
    margin: [0, 0, 0, 5],
    text: cleanText(text),
    ...options,
  });
}

function makeHeading(text: string, level: number): ContentText {
  return makeParagraph(text, {
    bold: true,
    fontSize: level === 1 ? 18 : level === 2 ? 15 : 13,
    margin: [0, 8, 0, 6],
  });
}

function makeCodeLine(text: string): ContentText {
  return {
    color: "#27352e",
    fontSize: 10,
    lineHeight: 1.25,
    margin: [0, 0, 0, 4],
    preserveLeadingSpaces: true,
    text: cleanText(text),
  };
}

function makeList(state: ListState): Content {
  const margin: [number, number, number, number] = [12, 0, 0, 8];
  const listContent =
    state.kind === "ul"
      ? {
          margin,
          ul: state.items,
        }
      : {
          margin,
          ol: state.items,
          start: state.start,
        };

  return listContent;
}

function markdownToPdfContent(markdown: string): Content[] {
  const content: Content[] = [];
  const paragraphBuffer: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inCodeBlock = false;
  let listState: ListState | null = null;

  function flushParagraph() {
    const text = paragraphBuffer.join("\n").trim();
    paragraphBuffer.length = 0;

    if (text) {
      content.push(makeParagraph(text));
    }
  }

  function flushList() {
    if (!listState) {
      return;
    }

    content.push(makeList(listState));
    listState = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      content.push(makeCodeLine(line));
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);

    if (headingMatch) {
      flushParagraph();
      flushList();
      content.push(makeHeading(headingMatch[2] ?? "", headingMatch[1]?.length ?? 2));
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(trimmed);

    if (bulletMatch) {
      flushParagraph();

      if (listState?.kind !== "ul") {
        flushList();
        listState = { items: [], kind: "ul" };
      }

      listState.items.push({
        lineHeight: 1.35,
        margin: [0, 0, 0, 3],
        text: parseInlineMarkdown(bulletMatch[1] ?? ""),
      });
      continue;
    }

    const numberedMatch = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);

    if (numberedMatch) {
      flushParagraph();

      if (listState?.kind !== "ol") {
        flushList();
        listState = {
          items: [],
          kind: "ol",
          start: Number(numberedMatch[1] ?? "1"),
        };
      }

      listState.items.push({
        lineHeight: 1.35,
        margin: [0, 0, 0, 3],
        text: parseInlineMarkdown(numberedMatch[2] ?? ""),
      });
      continue;
    }

    flushList();
    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  flushList();

  return content;
}

function makeTitle(text: string): ContentText {
  return {
    bold: true,
    fontSize: 20,
    margin: [0, 0, 0, 12],
    text: cleanText(text),
  };
}

function metadataContent(labels: ExportLabels): Content[] {
  const savedAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  return [
    makePlainParagraph(`${labels.savedLabel}: ${savedAt}`),
    makePlainParagraph(`${labels.startedFromLabel}: ${labels.entryLabel}`),
    makePlainParagraph(`${labels.languageExportLabel}: ${labels.languageLabel}`, {
      margin: [0, 0, 0, 14],
    }),
  ];
}

function buildDocument(title: string, content: Content[]): TDocumentDefinitions {
  return {
    content,
    defaultStyle: {
      color: "#1f2923",
      font: "Roboto",
      fontSize: 11,
      lineHeight: 1.35,
    },
    info: {
      author: "Streetlight",
      creator: "Streetlight",
      subject: "Streetlight local export",
      title,
    },
    pageMargins: [54, 54, 54, 54],
    pageSize: "LETTER",
    styles: {},
  };
}

function buildPdfBlob(documentDefinition: TDocumentDefinitions) {
  return new Promise<Blob>((resolve) => {
    pdfMake
      .createPdf(documentDefinition, undefined, undefined, pdfFonts)
      .getBlob((blob) => resolve(blob));
  });
}

export async function buildAnswerPdfBlob({
  labels,
  text,
  title,
}: {
  labels: ExportLabels;
  text: string;
  title: string;
}) {
  return buildPdfBlob(
    buildDocument(title, [
      makeTitle(title),
      ...metadataContent(labels),
      ...markdownToPdfContent(text.trim()),
    ]),
  );
}

export async function buildConversationPdfBlob({
  labels,
  messages,
  title,
}: {
  labels: ExportLabels;
  messages: ClientChatMessage[];
  title: string;
}) {
  const content: Content[] = [makeTitle(title), ...metadataContent(labels)];

  for (const message of messages) {
    const text = message.text.trim();

    if (!text) {
      continue;
    }

    content.push(
      makePlainParagraph(
        message.role === "assistant" ? labels.assistantLabel : labels.userLabel,
        {
          bold: true,
          fontSize: 12,
          margin: [0, 8, 0, 5],
        },
      ),
    );
    content.push(...markdownToPdfContent(text));
  }

  return buildPdfBlob(buildDocument(title, content));
}
