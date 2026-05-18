export const BRAND_NAME = 'Das Auss.Zeit';

// Matches case-insensitive variants with or without "Das":
//   auszeit, Auszeit, das auszeit, Das Auszeit, auss.zeit, Auss.Zeit, das auss.zeit, …
const BRAND_RE = /\b(?:das\s+)?auss?\.?\s*zeit\b/gi;

export function fixBrandName(text) {
  if (!text) return text;
  BRAND_RE.lastIndex = 0;
  return text.replace(BRAND_RE, BRAND_NAME);
}

export function hasBrandIssue(text) {
  if (!text) return false;
  const fixed = fixBrandName(text);
  return fixed !== text;
}

// Replace space-dash-space variants ( - , – , — ) with " | "
export function normalizeTitleSeparator(title) {
  if (!title) return title;
  return title.replace(/\s+[-–—]\s+/g, ' | ');
}

// Apply all normalizations to a title string
export function normalizeTitle(title) {
  return normalizeTitleSeparator(fixBrandName(title));
}

// Apply all normalizations to body text (no separator fix — only relevant for titles)
export function normalizeText(text) {
  return fixBrandName(text);
}
