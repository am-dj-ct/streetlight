export function formatMarkdownForPlainText(text: string): string {
  return (
    text
      .replace(/```[^\n]*\n?/g, "")
      .replace(
        /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        (_match, label: string, url: string) => {
          const trimmedLabel = label.trim();

          if (!trimmedLabel || trimmedLabel === url) {
            return url;
          }

          return `${trimmedLabel} (${url})`;
        },
      )
      .replace(/`([^`]+)`/g, "$1")
      // Normalize asterisk bullets first so emphasis stripping below cannot
      // pair a bullet asterisk with one on a later line.
      .replace(/^([ \t]*)\*[ \t]+/gm, "$1- ")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "")
      .replace(/^>\s+/gm, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
