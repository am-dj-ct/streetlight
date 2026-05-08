export const appTitle = "Access Tool";

export const defaultDescription =
  "A free mobile web tool for getting unstuck with letters, forms, hard conversations, and next steps.";

export function makeTitle(pageTitle?: string) {
  return pageTitle ? `${pageTitle} · ${appTitle}` : appTitle;
}
